import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  mock,
  setDefaultTimeout,
} from "bun:test";

setDefaultTimeout(30_000);

import {
  ForemanState,
  type ForemanConfig,
} from "../types.js";

const mockResolveStoryPath = mock(
  (_dir: string, id: string) =>
    `/mock/stories/${id}-story.md`
);

const mockReadAndParseStory = mock(() =>
  Promise.resolve({
    status: "in-progress",
    hasReviewSection: false,
    hasUnresolvedItems: false,
    taskStats: { total: 5, completed: 0 },
  })
);

mock.module("../story-parser.js", () => ({
  resolveStoryPath: mockResolveStoryPath,
  readAndParseStory: mockReadAndParseStory,
}));

const { Foreman } = await import("../foreman.js");

type PluginClient = import("../foreman.js").PluginClient;
type ForemanStatus = import("../foreman.js").ForemanStatus;
type ProgressCallback = import("../foreman.js").ProgressCallback;

const DEFAULT_CONFIG: ForemanConfig = {
  stories_dir: "docs/stories",
  sprint_status: "docs/sprint-status.yaml",
  max_iterations: 3,
  contexts: [],
  roles: {
    developer: {
      model: "anthropic/claude-sonnet-4-20250514",
      agent: "sisyphus",
    },
    reviewer: {
      model: "anthropic/claude-sonnet-4-20250514",
      agent: "sisyphus",
    },
    arbiter: {
      model: "anthropic/claude-opus-4-20250514",
      agent: "sisyphus",
    },
  },
  role_timeout_ms: 1800000,
};

interface PromptCapture {
  sessionId: string;
  text: string;
  agent: string;
}

function buildClient(verdictSequence: string[]): {
  client: PluginClient;
  createCalls: ReturnType<typeof mock>;
  messagesCalls: ReturnType<typeof mock>;
  capturedPrompts: PromptCapture[];
  capturedTitles: string[];
} {
  let sessionCounter = 0;
  const capturedPrompts: PromptCapture[] = [];
  const capturedTitles: string[] = [];
  const sessionStates = new Map<string, "busy" | "idle">();
  const sessionPrompts = new Map<string, string>();
  const arbiterVerdicts = new Map<string, string>();
  let arbiterIdx = 0;

  const createCalls = mock(
    (opts?: { body?: { title?: string } }) => {
      sessionCounter++;
      const id = `s-${sessionCounter}`;
      sessionStates.set(id, "idle");
      if (opts?.body?.title) {
        capturedTitles.push(opts.body.title);
      }
      return Promise.resolve({ data: { id } });
    }
  );

  const messagesCalls = mock(
    (opts: { path: { id: string } }) => {
      const prompt = sessionPrompts.get(opts.path.id) ?? "";
      const isArbiter = prompt.includes("Review the story");
      if (isArbiter) {
        if (!arbiterVerdicts.has(opts.path.id)) {
          const v =
            verdictSequence[arbiterIdx] ?? "NEEDS_WORK";
          arbiterVerdicts.set(opts.path.id, v);
          arbiterIdx++;
        }
        const verdict = arbiterVerdicts.get(opts.path.id)!;
        return Promise.resolve({
          data: [
            {
              info: { role: "assistant" },
              parts: [{ type: "text", text: verdict }],
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          {
            info: { role: "assistant" },
            parts: [
              { type: "text", text: "Task completed." },
            ],
          },
        ],
      });
    }
  );

  const client: PluginClient = {
    session: {
      create: createCalls,
      promptAsync: async (opts: {
        path: { id: string };
        body: {
          agent?: string;
          parts: Array<{ type: string; text: string }>;
        };
      }) => {
        capturedPrompts.push({
          sessionId: opts.path.id,
          text: opts.body.parts[0].text,
          agent: opts.body.agent ?? "",
        });
        sessionPrompts.set(
          opts.path.id,
          opts.body.parts[0].text
        );
        sessionStates.set(opts.path.id, "busy");
        setTimeout(
          () => sessionStates.set(opts.path.id, "idle"),
          10
        );
        return undefined;
      },
      messages: messagesCalls,
      abort: async () => undefined,
      status: async () => {
        const data: Record<
          string,
          { type: "idle" } | { type: "busy" }
        > = {};
        for (const [id, state] of sessionStates) {
          data[id] = { type: state };
        }
        return { data };
      },
    },
    tui: {
      showToast: async () => undefined,
    },
  };

  return {
    client,
    createCalls,
    messagesCalls,
    capturedPrompts,
    capturedTitles,
  };
}

const testConfig: ForemanConfig = {
  ...DEFAULT_CONFIG,
  max_iterations: 3,
  role_timeout_ms: 30000,
};

function defaultStoryState() {
  return {
    status: "in-progress",
    hasReviewSection: false,
    hasUnresolvedItems: false,
    taskStats: { total: 5, completed: 0 },
  };
}

describe("Integration: full plugin lifecycle", () => {
  beforeEach(() => {
    mockResolveStoryPath.mockClear();
    mockReadAndParseStory.mockClear();
    mockReadAndParseStory.mockImplementation(() =>
      Promise.resolve(defaultStoryState())
    );
  });

  it("Dev → Review → Arbitrate → PASS → Complete", async () => {
    const { client, createCalls } =
      buildClient(["PASS"]);

    const foreman = new Foreman(testConfig, client);
    const result = await foreman.run("1-3");

    expect(result).toBe("Story 1-3 completed successfully");
    expect(createCalls).toHaveBeenCalledTimes(3);
  });

  it("NEEDS_WORK then PASS: 2 full iterations", async () => {
    const { client, createCalls } =
      buildClient(["NEEDS_WORK", "PASS"]);

    const foreman = new Foreman(testConfig, client);
    const result = await foreman.run("2-1");

    expect(result).toBe("Story 2-1 completed successfully");
    expect(createCalls).toHaveBeenCalledTimes(6);
  });

  it("stops after max_iterations with NEEDS_WORK", async () => {
    const config: ForemanConfig = {
      ...DEFAULT_CONFIG,
      max_iterations: 2,
      role_timeout_ms: 30000,
    };

    const { client, createCalls } = buildClient([
      "NEEDS_WORK",
      "NEEDS_WORK",
      "NEEDS_WORK",
    ]);

    const foreman = new Foreman(config, client);
    const result = await foreman.run("3-1");

    expect(result).toBe("Story 3-1 completed successfully");
    expect(createCalls).toHaveBeenCalledTimes(6);
  });

  it("rejects concurrent run while first is active", async () => {
    let rejectStory: ((err: Error) => void) | undefined;
    mockReadAndParseStory.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStory = reject;
        })
    );

    const client: PluginClient = {
      session: {
        create: async () => ({ data: { id: "block-1" } }),
        promptAsync: async () => undefined,
        messages: async () => ({ data: [] }),
        abort: async () => undefined,
        status: async () => ({ data: {} }),
      },
      tui: {
        showToast: async () => undefined,
      },
    };

    const foreman = new Foreman(testConfig, client);
    const firstRun = foreman.run("1-3");
    await new Promise((r) => setTimeout(r, 10));

    await expect(foreman.run("2-1")).rejects.toThrow(
      "Foreman busy with story 1-3"
    );

    rejectStory?.(new Error("cancelled"));
    await firstRun.catch(() => {});
  });

  it("getStatus reflects idle state before run", () => {
    const { client } = buildClient(["PASS"]);
    const foreman = new Foreman(testConfig, client);

    const before = foreman.getStatus();
    expect(before.state).toBe(ForemanState.Idle);
    expect(before.storyId).toBeNull();
    expect(before.iteration).toBe(1);
    expect(before.currentRole).toBeNull();
    expect(before.taskStats).toBeNull();
  });

  it("getStatus after run shows storyId cleared by cleanup", async () => {
    const { client } = buildClient(["PASS"]);
    const foreman = new Foreman(testConfig, client);

    await foreman.run("4-1");

    const after = foreman.getStatus();
    expect(after.currentRole).toBeNull();
    expect(after.taskStats).toBeNull();
  });

  it("sends correct prompts to each role", async () => {
    const { client, capturedPrompts } =
      buildClient(["PASS"]);
    const foreman = new Foreman(testConfig, client);

    await foreman.run("5-1");

    expect(capturedPrompts).toHaveLength(3);

    expect(capturedPrompts[0].text).toContain("dev-story");
    expect(capturedPrompts[0].text).toContain(
      "/mock/stories/5-1-story.md"
    );

    expect(capturedPrompts[1].text).toContain("code-review");
    expect(capturedPrompts[1].text).toContain(
      "/mock/stories/5-1-story.md"
    );

    expect(capturedPrompts[2].text).toContain(
      "Review the story file"
    );
    expect(capturedPrompts[2].text).toContain("PASS");
    expect(capturedPrompts[2].text).toContain("NEEDS_WORK");
  });

  it("creates sessions with correct title format", async () => {
    const { client, capturedTitles } =
      buildClient(["PASS"]);
    const foreman = new Foreman(testConfig, client);

    await foreman.run("6-2");

    expect(capturedTitles).toEqual([
      "foreman:developer:6-2:iter1",
      "foreman:reviewer:6-2:iter1",
      "foreman:arbiter:6-2:iter1",
    ]);
  });

  it("isManagedSession returns false for unknown IDs", () => {
    const { client } = buildClient(["PASS"]);
    const foreman = new Foreman(testConfig, client);

    expect(foreman.isManagedSession("unknown")).toBe(false);
  });

  it("calls onProgress callback during run", async () => {
    const { client } = buildClient(["PASS"]);
    const foreman = new Foreman(testConfig, client);

    const progressUpdates: Array<{
      title: string;
      metadata: Record<string, unknown>;
    }> = [];
    const onProgress: ProgressCallback = (update) => {
      progressUpdates.push(update);
    };

    await foreman.run("7-1", onProgress);

    expect(progressUpdates.length).toBeGreaterThanOrEqual(4);
    expect(progressUpdates[0].title).toContain("Developing");
    expect(progressUpdates[1].title).toContain("Reviewing");
    expect(progressUpdates[2].title).toContain("Arbitrating");
    expect(
      progressUpdates[progressUpdates.length - 1].title
    ).toContain("Complete");
  });
});
