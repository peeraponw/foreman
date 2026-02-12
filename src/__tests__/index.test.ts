import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { Plugin, PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { z } from "zod";
import type { ForemanConfig } from "../types.js";
import type { PluginClient, ForemanStatus } from "../foreman.js";

type MockForeman = {
  run: ReturnType<typeof mock>;
  getStatus: ReturnType<typeof mock>;
  handleEvent: ReturnType<typeof mock>;
};

let mockConfig: ForemanConfig;
let mockForemanInstance: MockForeman;

const mockLoadConfig = mock((_directory?: string) => mockConfig);
const mockForemanConstructor = mock(
  (_config: ForemanConfig, _client: PluginClient) => mockForemanInstance
);

const mockTool = Object.assign(
  mock((input: {
    description: string;
    args: Record<string, unknown>;
    execute: (
      args: Record<string, unknown>,
      context: ToolContext
    ) => Promise<string>;
  }) => input),
  { schema: z }
);

mock.module("@opencode-ai/plugin", () => ({
  tool: mockTool,
  ToolContext: {} as unknown as { prototype: ToolContext },
}));

mock.module("../config.js", () => ({
  loadConfig: mockLoadConfig,
}));

mock.module("../foreman.js", () => ({
  Foreman: mockForemanConstructor,
}));

const { loadConfig } = await import("../config.js");
const { Foreman } = await import("../foreman.js");
const pluginModule = await import("../index.js");
const plugin = pluginModule.default as Plugin;

describe("plugin entry point", () => {
  const createMockInput = (): PluginInput => ({
    client: {
      session: {
        create: mock(),
        promptAsync: mock(),
        messages: mock(),
        abort: mock(),
      },
    } as unknown as PluginInput["client"],
    project: {
      id: "test-project",
      name: "Test Project",
      worktree: "/test/project",
      time: { created: Date.now(), updated: Date.now() },
    } as PluginInput["project"],
    directory: "/test/project",
    worktree: "/test/project",
    serverUrl: new URL("http://localhost:3000"),
    $: {} as PluginInput["$"],
  });

  beforeEach(() => {
    mockConfig = {
      stories_dir: "docs/stories",
      sprint_status: "docs/sprint-status.yaml",
      max_iterations: 3,
      contexts: [],
      roles: {
        developer: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          agent: "sisyphus",
        },
        reviewer: {
          provider: "anthropic",
          model: "claude-sonnet-4-20250514",
          agent: "sisyphus",
        },
        arbiter: {
          provider: "anthropic",
          model: "claude-opus-4-20250514",
          agent: "sisyphus",
        },
      },
      role_timeout_ms: 1800000,
    };

    mockForemanInstance = {
      run: mock(() =>
        Promise.resolve("Story 1-1 completed successfully")
      ),
      getStatus: mock(
        () =>
          ({
            state: "Idle",
            storyId: null,
            iteration: 1,
            maxIterations: 3,
          }) as ForemanStatus
      ),
      handleEvent: mock(),
    };

    mockLoadConfig.mockClear();
    mockForemanConstructor.mockClear();
  });

  it("default export is a function (Plugin type)", () => {
    expect(plugin).toBeTypeOf("function");
  });

  it("returns Hooks with tool and event properties", async () => {
    const input = createMockInput();
    const hooks = await plugin(input);

    expect(hooks).toHaveProperty("tool");
    expect(hooks).toHaveProperty("event");
    expect(hooks.tool).toBeTypeOf("object");
    expect(hooks.event).toBeTypeOf("function");
  });

  it("tool has foreman_run key", async () => {
    const input = createMockInput();
    const hooks = (await plugin(input)) as Required<Hooks>;

    expect(hooks.tool).toHaveProperty("foreman_run");
    expect(hooks.tool?.foreman_run).toBeDefined();
  });

  it("tool has foreman_status key", async () => {
    const input = createMockInput();
    const hooks = (await plugin(input)) as Required<Hooks>;

    expect(hooks.tool).toHaveProperty("foreman_status");
    expect(hooks.tool?.foreman_status).toBeDefined();
  });

  it("foreman_run has correct structure with story_id arg", async () => {
    const input = createMockInput();
    const hooks = (await plugin(input)) as Required<Hooks>;

    const foremanRunTool = hooks.tool?.foreman_run;
    expect(foremanRunTool).toBeDefined();
    expect(foremanRunTool?.description).toBeTypeOf("string");
    expect(foremanRunTool?.description.length).toBeGreaterThan(0);
    expect(foremanRunTool?.args).toHaveProperty("story_id");
  });

  it("event handler is a function", async () => {
    const input = createMockInput();
    const hooks = await plugin(input);
    expect(hooks.event).toBeTypeOf("function");
  });

  it("event handler calls foreman.handleEvent", async () => {
    const input = createMockInput();
    const hooks = await plugin(input);

    const testEvent = { type: "test", properties: {} };
    await hooks.event?.({
      event: testEvent as unknown as Parameters<
        NonNullable<Hooks["event"]>
      >[0]["event"],
    });

    expect(mockForemanInstance.handleEvent).toHaveBeenCalledTimes(1);
    expect(mockForemanInstance.handleEvent).toHaveBeenCalledWith(
      testEvent
    );
  });

  it("loads config with correct directory", async () => {
    const input = createMockInput();
    await plugin(input);
    expect(loadConfig).toHaveBeenCalledWith(input.directory);
  });

  it("creates Foreman with config and client", async () => {
    const input = createMockInput();
    await plugin(input);
    expect(Foreman).toHaveBeenCalledWith(mockConfig, input.client);
  });
});
