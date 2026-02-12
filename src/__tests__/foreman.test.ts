import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
  afterEach,
} from "bun:test";
import {
  ForemanState,
  ArbiterVerdict,
  Role,
  type ForemanConfig,
  type SessionInfo,
} from "../types.js";
import { DEFAULT_CONFIG } from "../config.js";

const mockResolveStoryPath = mock(
  (dir: string, id: string) => `/mock/stories/${id}-test-story.md`
);
const mockReadAndParseStory = mock(() =>
  Promise.resolve({
    status: "ready-for-dev",
    hasReviewSection: false,
    hasUnresolvedItems: false,
    taskStats: { total: 3, completed: 0 },
  })
);

mock.module("../story-parser.js", () => ({
  resolveStoryPath: mockResolveStoryPath,
  readAndParseStory: mockReadAndParseStory,
}));

import {
  nextState,
  parseArbiterVerdict,
  Foreman,
  type PluginClient,
  type ForemanStatus,
} from "../foreman.js";

// ============================================================================
// Mock PluginClient
// ============================================================================

interface MockSessionMethods {
  create: ReturnType<typeof mock>;
  promptAsync: ReturnType<typeof mock>;
  messages: ReturnType<typeof mock>;
  abort: ReturnType<typeof mock>;
}

function createMockClient(): { client: PluginClient; mocks: MockSessionMethods } {
  const mocks: MockSessionMethods = {
    create: mock(() => Promise.resolve({ data: { id: "session-test-123" } })),
    promptAsync: mock(() => Promise.resolve(undefined)),
    messages: mock(() =>
      Promise.resolve({
        data: [
          { info: { role: "assistant" }, parts: [{ type: "text", text: "Done" }] },
        ],
      })
    ),
    abort: mock(() => Promise.resolve(undefined)),
  };

  const client: PluginClient = {
    session: {
      create: mocks.create,
      promptAsync: mocks.promptAsync,
      messages: mocks.messages,
      abort: mocks.abort,
    },
  };

  return { client, mocks };
}

// ============================================================================
// nextState Pure Function Tests
// ============================================================================

describe("nextState pure function", () => {
  const maxIterations = 3;

  describe("Valid transitions", () => {
    it("Idle + startDeveloping -> Developing", () => {
      const result = nextState(
        ForemanState.Idle,
        "startDeveloping",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Developing);
    });

    it("Developing + developmentComplete -> Reviewing", () => {
      const result = nextState(
        ForemanState.Developing,
        "developmentComplete",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Reviewing);
    });

    it("Reviewing + reviewComplete -> Arbitrating", () => {
      const result = nextState(
        ForemanState.Reviewing,
        "reviewComplete",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Arbitrating);
    });

    it("Arbitrating + verdict(Pass) -> Complete", () => {
      const result = nextState(
        ForemanState.Arbitrating,
        "verdict",
        ArbiterVerdict.Pass,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Complete);
    });

    it("Arbitrating + verdict(NeedsWork) + iteration < max -> Developing", () => {
      const result = nextState(
        ForemanState.Arbitrating,
        "verdict",
        ArbiterVerdict.NeedsWork,
        2,
        maxIterations
      );
      expect(result).toBe(ForemanState.Developing);
    });

    it("Arbitrating + verdict(NeedsWork) + iteration >= max -> Complete (max reached)", () => {
      const result = nextState(
        ForemanState.Arbitrating,
        "verdict",
        ArbiterVerdict.NeedsWork,
        3,
        maxIterations
      );
      expect(result).toBe(ForemanState.Complete);
    });

    it("Any state + error -> Failed", () => {
      const result = nextState(
        ForemanState.Developing,
        "error",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Failed);
    });

    it("Failed + error -> Failed (idempotent)", () => {
      const result = nextState(
        ForemanState.Failed,
        "error",
        undefined,
        1,
        maxIterations
      );
      expect(result).toBe(ForemanState.Failed);
    });
  });

  describe("Invalid transitions", () => {
    it("throws error for Idle + developmentComplete (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Idle, "developmentComplete", undefined, 1, maxIterations)
      ).toThrow();
    });

    it("throws error for Complete + startDeveloping (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Complete, "startDeveloping", undefined, 1, maxIterations)
      ).toThrow();
    });

    it("throws error for Developing + verdict (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Developing, "verdict", ArbiterVerdict.Pass, 1, maxIterations)
      ).toThrow();
    });

    it("throws error for Reviewing + startDeveloping (invalid)", () => {
      expect(() =>
        nextState(ForemanState.Reviewing, "startDeveloping", undefined, 1, maxIterations)
      ).toThrow();
    });
  });
});

// ============================================================================
// parseArbiterVerdict Tests
// ============================================================================

describe("parseArbiterVerdict", () => {
  it('returns Pass for text containing "PASS" (case-insensitive)', () => {
    expect(parseArbiterVerdict("The implementation is pass")).toBe(ArbiterVerdict.Pass);
    expect(parseArbiterVerdict("PASS - all tests pass")).toBe(ArbiterVerdict.Pass);
    expect(parseArbiterVerdict("I say Pass here")).toBe(ArbiterVerdict.Pass);
  });

  it('returns NeedsWork for text containing "NEEDS_WORK" (case-insensitive)', () => {
    expect(parseArbiterVerdict("needs_work - more fixes needed")).toBe(
      ArbiterVerdict.NeedsWork
    );
    expect(parseArbiterVerdict("NEEDS_WORK")).toBe(ArbiterVerdict.NeedsWork);
    expect(parseArbiterVerdict("I think Needs_Work is the verdict")).toBe(
      ArbiterVerdict.NeedsWork
    );
  });

  it('returns NeedsWork when both PASS and NEEDS_WORK are present (conservative)', () => {
    expect(parseArbiterVerdict("PASS or NEEDS_WORK? I say NEEDS_WORK")).toBe(
      ArbiterVerdict.NeedsWork
    );
    expect(parseArbiterVerdict("The tests pass but I think needs_work is better")).toBe(
      ArbiterVerdict.NeedsWork
    );
  });

  it("returns NeedsWork when neither keyword is present (fallback)", () => {
    expect(parseArbiterVerdict("The implementation looks good")).toBe(
      ArbiterVerdict.NeedsWork
    );
    expect(parseArbiterVerdict("")).toBe(ArbiterVerdict.NeedsWork);
    expect(parseArbiterVerdict("Maybe okay")).toBe(ArbiterVerdict.NeedsWork);
  });
});

// ============================================================================
// Foreman Class Tests
// ============================================================================

describe("Foreman class", () => {
  let foreman: Foreman;
  let mockClient: PluginClient;
  let mocks: MockSessionMethods;

  const testConfig: ForemanConfig = {
    ...DEFAULT_CONFIG,
    max_iterations: 2,
    role_timeout_ms: 60000,
  };

  beforeEach(() => {
    const { client, mocks: m } = createMockClient();
    mockClient = client;
    mocks = m;
    foreman = new Foreman(testConfig, mockClient);
    mockResolveStoryPath.mockClear();
    mockReadAndParseStory.mockClear();
  });

  describe("getStatus()", () => {
    it("returns initial status with Idle state and null storyId", () => {
      const status = foreman.getStatus();
      expect(status.state).toBe(ForemanState.Idle);
      expect(status.storyId).toBeNull();
      expect(status.iteration).toBe(1);
      expect(status.maxIterations).toBe(testConfig.max_iterations);
    });
  });

  describe("run() - concurrent rejection", () => {
    it("rejects concurrent run when already running", async () => {
      const { client: blockingClient } = createMockClient();

      let resolveRead: (() => void) | undefined;
      const blockingReadAndParseStory = mock(
        () =>
          new Promise<void>((resolve) => {
            resolveRead = () => resolve();
          })
      );

      mock.module("../story-parser.js", () => ({
        resolveStoryPath: mockResolveStoryPath,
        readAndParseStory: blockingReadAndParseStory,
      }));

      const { Foreman: BlockingForeman } = await import("../foreman.js");
      const blockingForeman = new BlockingForeman(testConfig, blockingClient);

      const firstRunPromise = blockingForeman.run("1-3", "/workspace");

      await expect(blockingForeman.run("2-1", "/workspace")).rejects.toThrow(
        /Foreman busy with story/
      );

      resolveRead?.();
      await firstRunPromise.catch(() => {});

      mock.module("../story-parser.js", () => ({
        resolveStoryPath: mockResolveStoryPath,
        readAndParseStory: mockReadAndParseStory,
      }));
    });
  });

  describe("handleEvent()", () => {
    it("ignores events for non-foreman sessions", () => {
      const event = {
        type: "session.idle",
        properties: { sessionID: "some-random-session-id" },
      };

      expect(() => foreman.handleEvent(event)).not.toThrow();
    });

    it("handles session.idle event for managed session", async () => {
      const sessionId = "managed-session-123";
      const { client: customClient } = createMockClient();
      customClient.session.create = mock(() =>
        Promise.resolve({ data: { id: sessionId } })
      );

      const customForeman = new Foreman(testConfig, customClient);

      const runPromise = customForeman.run("1-3", "/workspace");

      setTimeout(() => {
        customForeman.handleEvent({
          type: "session.idle",
          properties: { sessionID: sessionId },
        });
      }, 10);

      await runPromise.catch(() => {});
    });

    it("handles session.error event for managed session", async () => {
      const sessionId = "managed-session-error";
      const { client: customClient } = createMockClient();
      customClient.session.create = mock(() =>
        Promise.resolve({ data: { id: sessionId } })
      );

      const customForeman = new Foreman(testConfig, customClient);

      const runPromise = customForeman.run("1-3", "/workspace");

      setTimeout(() => {
        customForeman.handleEvent({
          type: "session.error",
          properties: { sessionID: sessionId, error: "Test error" },
        });
      }, 10);

      await runPromise.catch(() => {});
    });
  });
});

// ============================================================================
// ForemanStatus Type Tests
// ============================================================================

describe("ForemanStatus type", () => {
  it("accepts valid status object", () => {
    const status: ForemanStatus = {
      state: ForemanState.Developing,
      storyId: "1-3",
      iteration: 2,
      maxIterations: 3,
    };
    expect(status.state).toBe(ForemanState.Developing);
    expect(status.storyId).toBe("1-3");
  });

  it("allows null storyId", () => {
    const status: ForemanStatus = {
      state: ForemanState.Idle,
      storyId: null,
      iteration: 1,
      maxIterations: 3,
    };
    expect(status.storyId).toBeNull();
  });
});

// ============================================================================
// PluginClient Type Tests
// ============================================================================

describe("PluginClient type", () => {
  it("accepts valid client object", () => {
    const client: PluginClient = {
      session: {
        create: async () => ({ data: { id: "test" } }),
        promptAsync: async () => undefined,
        messages: async () => ({ data: [] }),
        abort: async () => undefined,
      },
    };
    expect(client.session).toBeDefined();
  });
});
