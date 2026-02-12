import {
  describe,
  it,
  expect,
  beforeEach,
  mock,
} from "bun:test";
import { ForemanState, type ForemanConfig } from "../types.js";
import { DEFAULT_CONFIG } from "../config.js";

const mockResolveStoryPath = mock(
  (_dir: string, id: string) => `/mock/stories/${id}-story.md`
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

import { Foreman, type PluginClient } from "../foreman.js";

interface PromptCapture {
  sessionId: string;
  text: string;
  agent: string;
}

function buildClient(
  foremanRef: { current: Foreman | null },
  verdictSequence: string[]
): {
  client: PluginClient;
  createCalls: ReturnType<typeof mock>;
  messagesCalls: ReturnType<typeof mock>;
  capturedPrompts: PromptCapture[];
  capturedTitles: string[];
} {
  let sessionCounter = 0;
  let arbiterCallIdx = 0;
  const capturedPrompts: PromptCapture[] = [];
  const capturedTitles: string[] = [];

  const createCalls = mock(
    (opts?: { body?: { title?: string } }) => {
      sessionCounter++;
      if (opts?.body?.title) {
        capturedTitles.push(opts.body.title);
      }
      return Promise.resolve({
        data: { id: `s-${sessionCounter}` },
      });
    }
  );

  const messagesCalls = mock(() => {
    const verdict =
      verdictSequence[arbiterCallIdx] ?? "NEEDS_WORK";
    arbiterCallIdx++;
    return Promise.resolve({
      data: [
        {
          info: { role: "assistant" },
          parts: [{ type: "text", text: verdict }],
        },
      ],
    });
  });

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
        setTimeout(() => {
          foremanRef.current?.handleEvent({
            type: "session.idle",
            properties: { sessionID: opts.path.id },
          });
        }, 1);
        return undefined;
      },
      messages: messagesCalls,
      abort: async () => undefined,
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
    const ref: { current: Foreman | null } = { current: null };
    const { client, createCalls, messagesCalls } =
      buildClient(ref, ["PASS"]);

    const foreman = new Foreman(testConfig, client);
    ref.current = foreman;

    const result = await foreman.run("1-3", "/workspace");

    expect(result).toBe("Story 1-3 completed successfully");
    expect(createCalls).toHaveBeenCalledTimes(3);
    expect(messagesCalls).toHaveBeenCalledTimes(1);
  });

  it("NEEDS_WORK then PASS: 2 full iterations", async () => {
    const ref: { current: Foreman | null } = { current: null };
    const { client, createCalls, messagesCalls } =
      buildClient(ref, ["NEEDS_WORK", "PASS"]);

    const foreman = new Foreman(testConfig, client);
    ref.current = foreman;

    const result = await foreman.run("2-1", "/workspace");

    expect(result).toBe("Story 2-1 completed successfully");
    expect(createCalls).toHaveBeenCalledTimes(6);
    expect(messagesCalls).toHaveBeenCalledTimes(2);
  });

  it("stops after max_iterations with NEEDS_WORK", async () => {
    const config: ForemanConfig = {
      ...DEFAULT_CONFIG,
      max_iterations: 2,
      role_timeout_ms: 30000,
    };

    const ref: { current: Foreman | null } = { current: null };
    const { client, createCalls, messagesCalls } =
      buildClient(ref, ["NEEDS_WORK", "NEEDS_WORK", "NEEDS_WORK"]);

    const foreman = new Foreman(config, client);
    ref.current = foreman;

    const result = await foreman.run("3-1", "/workspace");

    expect(result).toBe("Story 3-1 completed successfully");
    expect(createCalls).toHaveBeenCalledTimes(6);
    expect(messagesCalls).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent run while first is active", async () => {
    let rejectStory: ((err: Error) => void) | undefined;
    mockReadAndParseStory.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStory = reject;
        })
    );

    const foreman = new Foreman(testConfig, {
      session: {
        create: async () => ({ data: { id: "block-1" } }),
        promptAsync: async () => undefined,
        messages: async () => ({ data: [] }),
        abort: async () => undefined,
      },
    });

    const firstRun = foreman.run("1-3", "/workspace");

    await expect(foreman.run("2-1", "/workspace")).rejects.toThrow(
      "Foreman busy with story 1-3"
    );

    rejectStory?.(new Error("cancelled"));
    await firstRun.catch(() => {});
  });

  it("getStatus reflects state before and after run", async () => {
    const ref: { current: Foreman | null } = { current: null };
    const { client } = buildClient(ref, ["PASS"]);
    const foreman = new Foreman(testConfig, client);
    ref.current = foreman;

    const before = foreman.getStatus();
    expect(before.state).toBe(ForemanState.Idle);
    expect(before.storyId).toBeNull();
    expect(before.iteration).toBe(1);

    await foreman.run("4-1", "/workspace");

    const after = foreman.getStatus();
    expect(after.storyId).toBe("4-1");
    expect(after.iteration).toBe(1);
  });

  it("sends correct prompts to each role", async () => {
    const ref: { current: Foreman | null } = { current: null };
    const { client, capturedPrompts } = buildClient(ref, ["PASS"]);
    const foreman = new Foreman(testConfig, client);
    ref.current = foreman;

    await foreman.run("5-1", "/workspace");

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
    const ref: { current: Foreman | null } = { current: null };
    const { client, capturedTitles } = buildClient(ref, ["PASS"]);
    const foreman = new Foreman(testConfig, client);
    ref.current = foreman;

    await foreman.run("6-2", "/workspace");

    expect(capturedTitles).toEqual([
      "foreman:developer:6-2:iter1",
      "foreman:reviewer:6-2:iter1",
      "foreman:arbiter:6-2:iter1",
    ]);
  });
});
