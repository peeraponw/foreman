import {
  ForemanState,
  ArbiterVerdict,
  Role,
  type ForemanConfig,
  type SessionInfo,
} from "./types.js";
import { resolveStoryPath, readAndParseStory } from "./story-parser.js";
import { buildDeveloperPrompt } from "./prompts/developer.js";
import { buildReviewerPrompt } from "./prompts/reviewer.js";
import { buildArbiterPrompt } from "./prompts/arbiter.js";

export interface PluginClient {
  session: {
    create: (opts?: { body?: { title?: string } }) => Promise<{
      data?: { id?: string };
    }>;
    promptAsync: (opts: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        agent?: string;
        parts: Array<{ type: "text"; text: string }>;
      };
    }) => Promise<unknown>;
    messages: (opts: { path: { id: string } }) => Promise<{
      data?: Array<{
        info?: { role?: string };
        parts?: Array<{ type?: string; text?: string }>;
      }>;
    }>;
    abort: (opts: { path: { id: string } }) => Promise<unknown>;
  };
}

export interface ForemanStatus {
  state: ForemanState;
  storyId: string | null;
  iteration: number;
  maxIterations: number;
}

type ForemanEvent =
  | "startDeveloping"
  | "developmentComplete"
  | "reviewComplete"
  | "verdict"
  | "error";

interface SessionWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

export function nextState(
  current: ForemanState,
  event: ForemanEvent,
  verdict?: ArbiterVerdict,
  iteration?: number,
  maxIterations?: number
): ForemanState {
  switch (current) {
    case ForemanState.Idle:
      if (event === "startDeveloping") {
        return ForemanState.Developing;
      }
      break;

    case ForemanState.Developing:
      if (event === "developmentComplete") {
        return ForemanState.Reviewing;
      }
      if (event === "error") {
        return ForemanState.Failed;
      }
      break;

    case ForemanState.Reviewing:
      if (event === "reviewComplete") {
        return ForemanState.Arbitrating;
      }
      if (event === "error") {
        return ForemanState.Failed;
      }
      break;

    case ForemanState.Arbitrating:
      if (event === "verdict") {
        if (verdict === ArbiterVerdict.Pass) {
          return ForemanState.Complete;
        }
        if (verdict === ArbiterVerdict.NeedsWork) {
          const iter = iteration ?? 1;
          const max = maxIterations ?? 3;
          if (iter >= max) {
            return ForemanState.Complete;
          }
          return ForemanState.Developing;
        }
      }
      if (event === "error") {
        return ForemanState.Failed;
      }
      break;

    case ForemanState.Complete:
      break;

    case ForemanState.Failed:
      if (event === "error") {
        return ForemanState.Failed;
      }
      break;
  }

  throw new Error(
    `Invalid state transition: ${current} + ${event}${verdict ? ` (${verdict})` : ""}`
  );
}

export function parseArbiterVerdict(lastAssistantText: string): ArbiterVerdict {
  const upper = lastAssistantText.toUpperCase();

  if (upper.includes("NEEDS_WORK")) {
    return ArbiterVerdict.NeedsWork;
  }

  if (upper.includes("PASS")) {
    return ArbiterVerdict.Pass;
  }

  return ArbiterVerdict.NeedsWork;
}

export class Foreman {
  private config: ForemanConfig;
  private client: PluginClient;
  private state: ForemanState = ForemanState.Idle;
  private currentStoryId: string | null = null;
  private iteration: number = 1;
  private isRunning: boolean = false;
  private managedSessions: Map<string, SessionInfo> = new Map();
  private sessionWaiters: Map<string, SessionWaiter> = new Map();
  private storyPath: string | null = null;

  constructor(config: ForemanConfig, client: PluginClient) {
    this.config = config;
    this.client = client;
  }

  getStatus(): ForemanStatus {
    return {
      state: this.state,
      storyId: this.currentStoryId,
      iteration: this.iteration,
      maxIterations: this.config.max_iterations,
    };
  }

  async run(storyId: string, directory: string): Promise<string> {
    if (this.isRunning) {
      throw new Error(`Foreman busy with story ${this.currentStoryId}`);
    }

    this.isRunning = true;
    this.currentStoryId = storyId;
    this.iteration = 1;

    try {
      this.storyPath = resolveStoryPath(
        `${directory}/${this.config.stories_dir}`,
        storyId
      );

      const storyState = await readAndParseStory(this.storyPath);
      this.state = this.determineInitialState(storyState.status);

      while (
        this.state !== ForemanState.Complete &&
        this.state !== ForemanState.Failed
      ) {
        switch (this.state) {
          case ForemanState.Idle:
            this.state = nextState(this.state, "startDeveloping");
            break;

          case ForemanState.Developing:
            await this.runDeveloperSession(this.iteration > 1);
            break;

          case ForemanState.Reviewing:
            await this.runReviewerSession();
            break;

          case ForemanState.Arbitrating:
            await this.runArbiterSession();
            break;
        }
      }

      return this.state === ForemanState.Complete
        ? `Story ${storyId} completed successfully`
        : `Story ${storyId} failed`;
    } finally {
      this.cleanup();
    }
  }

  handleEvent(event: unknown): void {
    if (!this.isObject(event)) {
      return;
    }

    const evt = event as Record<string, unknown>;
    const eventType = evt.type;
    const properties = evt.properties;

    if (!this.isObject(properties)) {
      return;
    }

    const props = properties as Record<string, unknown>;
    const sessionID = props.sessionID;

    if (typeof sessionID !== "string") {
      return;
    }

    if (!this.managedSessions.has(sessionID)) {
      return;
    }

    const waiter = this.sessionWaiters.get(sessionID);
    if (!waiter) {
      return;
    }

    if (eventType === "session.idle") {
      clearTimeout(waiter.timeoutId);
      this.sessionWaiters.delete(sessionID);
      waiter.resolve();
    } else if (eventType === "session.error") {
      clearTimeout(waiter.timeoutId);
      this.sessionWaiters.delete(sessionID);
      const errorMsg =
        typeof props.error === "string" ? props.error : "Session error";
      waiter.reject(new Error(errorMsg));
    }
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private determineInitialState(status: string): ForemanState {
    switch (status) {
      case "ready-for-dev":
        return ForemanState.Idle;
      case "in-progress":
        return ForemanState.Developing;
      case "review":
        return ForemanState.Reviewing;
      case "done":
        return ForemanState.Complete;
      default:
        return ForemanState.Idle;
    }
  }

  private async runDeveloperSession(isFollowUp: boolean): Promise<void> {
    const title = `foreman:developer:${this.currentStoryId}:iter${this.iteration}`;
    const sessionId = await this.createSession(title, Role.Developer);

    const prompt = buildDeveloperPrompt(this.storyPath!, isFollowUp);
    await this.sendPrompt(sessionId, prompt, this.config.roles.developer);

    await this.waitForSession(sessionId);

    this.state = nextState(
      this.state,
      "developmentComplete",
      undefined,
      this.iteration,
      this.config.max_iterations
    );
  }

  private async runReviewerSession(): Promise<void> {
    const title = `foreman:reviewer:${this.currentStoryId}:iter${this.iteration}`;
    const sessionId = await this.createSession(title, Role.Reviewer);

    const prompt = buildReviewerPrompt(this.storyPath!);
    await this.sendPrompt(sessionId, prompt, this.config.roles.reviewer);

    await this.waitForSession(sessionId);

    this.state = nextState(
      this.state,
      "reviewComplete",
      undefined,
      this.iteration,
      this.config.max_iterations
    );
  }

  private async runArbiterSession(): Promise<void> {
    const title = `foreman:arbiter:${this.currentStoryId}:iter${this.iteration}`;
    const sessionId = await this.createSession(title, Role.Arbiter);

    const prompt = buildArbiterPrompt(
      this.storyPath!,
      this.config.contexts,
      this.iteration,
      this.config.max_iterations
    );
    await this.sendPrompt(sessionId, prompt, this.config.roles.arbiter);

    await this.waitForSession(sessionId);

    const lastAssistantText = await this.getLastAssistantMessage(sessionId);
    const verdict = parseArbiterVerdict(lastAssistantText);

    this.state = nextState(
      this.state,
      "verdict",
      verdict,
      this.iteration,
      this.config.max_iterations
    );

    if (verdict === ArbiterVerdict.NeedsWork && this.state === ForemanState.Developing) {
      this.iteration++;
    }
  }

  private async createSession(title: string, role: Role): Promise<string> {
    const response = await this.client.session.create({
      body: { title },
    });

    const sessionId = response.data?.id;
    if (!sessionId) {
      throw new Error(`Failed to create ${role} session: no session ID returned`);
    }

    this.managedSessions.set(sessionId, {
      sessionId,
      role,
      storyId: this.currentStoryId!,
      startedAt: new Date(),
    });

    return sessionId;
  }

  private async sendPrompt(
    sessionId: string,
    promptText: string,
    roleConfig: { provider: string; model: string; agent: string }
  ): Promise<void> {
    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        model: {
          providerID: roleConfig.provider,
          modelID: roleConfig.model,
        },
        agent: roleConfig.agent,
        parts: [{ type: "text", text: promptText }],
      },
    });
  }

  private async waitForSession(sessionId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        this.sessionWaiters.delete(sessionId);
        await this.client.session.abort({ path: { id: sessionId } });
        reject(new Error(`Session ${sessionId} timed out`));
      }, this.config.role_timeout_ms);

      this.sessionWaiters.set(sessionId, {
        resolve: () => resolve(),
        reject,
        timeoutId,
      });
    });
  }

  private async getLastAssistantMessage(sessionId: string): Promise<string> {
    const response = await this.client.session.messages({
      path: { id: sessionId },
    });

    const messages = response.data ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.info?.role === "assistant") {
        const parts = msg.parts ?? [];
        const textParts = parts
          .filter((p) => p.type === "text" && typeof p.text === "string")
          .map((p) => p.text as string);
        if (textParts.length > 0) {
          return textParts.join("\n");
        }
      }
    }

    return "";
  }

  private cleanup(): void {
    for (const waiter of this.sessionWaiters.values()) {
      clearTimeout(waiter.timeoutId);
    }
    this.sessionWaiters.clear();
    this.managedSessions.clear();
    this.isRunning = false;
    this.storyPath = null;
  }
}
