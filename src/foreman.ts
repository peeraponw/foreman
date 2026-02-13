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
    status: (opts?: {
      query?: { directory?: string };
    }) => Promise<{
      data?: {
        [key: string]:
          | { type: "idle" }
          | { type: "busy" }
          | { type: "retry"; attempt: number; message: string; next: number };
      };
    }>;
  };
  tui: {
    showToast: (opts: {
      body: {
        message: string;
        variant: "info" | "success" | "warning" | "error";
        title?: string;
        duration?: number;
      };
    }) => Promise<unknown>;
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

  async run(storyId: string): Promise<string> {
    if (this.isRunning) {
      throw new Error(`Foreman busy with story ${this.currentStoryId}`);
    }

    this.isRunning = true;
    this.currentStoryId = storyId;
    this.iteration = 1;

    try {
      this.storyPath = resolveStoryPath(
        this.config.stories_dir,
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

  private parseModel(model: string): { providerID: string; modelID: string } {
    const slashIndex = model.indexOf("/");
    if (slashIndex === -1) {
      throw new Error(`Invalid model format "${model}": expected "provider/model"`);
    }
    return {
      providerID: model.slice(0, slashIndex),
      modelID: model.slice(slashIndex + 1),
    };
  }

  private async sendPrompt(
    sessionId: string,
    promptText: string,
    roleConfig: { model: string; agent: string }
  ): Promise<void> {
    await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        model: this.parseModel(roleConfig.model),
        agent: roleConfig.agent,
        parts: [{ type: "text", text: promptText }],
      },
    });
  }

  private async waitForSession(sessionId: string): Promise<void> {
    const pollIntervalMs = 2000;
    const startTime = Date.now();

    while (Date.now() - startTime < this.config.role_timeout_ms) {
      await this.sleep(pollIntervalMs);
      const statusResponse = await this.client.session.status();
      const sessionStatus = statusResponse.data?.[sessionId];

      if (!sessionStatus || sessionStatus.type === "idle") {
        return; // Session completed
      }

      if (sessionStatus.type === "retry") {
        continue; // Session is retrying — continue polling
      }

      // sessionStatus.type === "busy" — still running
    }

    // Timeout reached
    await this.client.session.abort({ path: { id: sessionId } });
    throw new Error(
      `Session ${sessionId} timed out after ${this.config.role_timeout_ms}ms`
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
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
    this.managedSessions.clear();
    this.isRunning = false;
    this.storyPath = null;
  }
}
