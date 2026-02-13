import { describe, it, expect, mock, beforeEach, afterAll } from "bun:test";
import type {
  Plugin,
  PluginInput,
  Hooks,
  ToolContext,
} from "@opencode-ai/plugin";
import { z } from "zod";
import type { ForemanConfig } from "../types.js";
import type { PluginClient, ForemanStatus } from "../foreman.js";

type MockForeman = {
  run: ReturnType<typeof mock>;
  getStatus: ReturnType<typeof mock>;
  isManagedSession: ReturnType<typeof mock>;
};

let mockConfig: ForemanConfig;
let mockForemanInstance: MockForeman;

const mockLoadConfig = mock(
  (_directory?: string) => mockConfig
);
const mockForemanConstructor = mock(
  (_config: ForemanConfig, _client: PluginClient) =>
    mockForemanInstance
);

const mockTool = Object.assign(
  mock(
    (input: {
      description: string;
      args: Record<string, unknown>;
      execute: (
        args: Record<string, unknown>,
        context: ToolContext
      ) => Promise<string>;
    }) => input
  ),
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
        status: mock(),
      },
      tui: {
        showToast: mock(),
      },
    } as unknown as PluginInput["client"],
    project: {
      id: "test-project",
      name: "Test Project",
      worktree: "/test/project",
      time: {
        created: Date.now(),
        updated: Date.now(),
      },
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
            currentRole: null,
            sessionDurationMs: null,
            taskStats: null,
          }) as ForemanStatus
      ),
      isManagedSession: mock(() => false),
    };

    mockLoadConfig.mockClear();
    mockForemanConstructor.mockClear();
  });

  it("default export is a function (Plugin type)", () => {
    expect(plugin).toBeTypeOf("function");
  });

  it("returns Hooks with tool and permission.ask", async () => {
    const input = createMockInput();
    const hooks = await plugin(input);

    expect(hooks).toHaveProperty("tool");
    expect(hooks.tool).toBeTypeOf("object");
    const hooksRecord = hooks as Record<string, unknown>;
    expect(hooksRecord["permission.ask"]).toBeTypeOf("function");
  });

  it("does not return event hook", async () => {
    const input = createMockInput();
    const hooks = await plugin(input);
    const hooksRecord = hooks as Record<string, unknown>;

    expect(hooksRecord["event"]).toBeUndefined();
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

  it("permission.ask hook is a function", async () => {
    const input = createMockInput();
    const hooks = await plugin(input);
    const hooksRecord = hooks as Record<string, unknown>;

    const permHook = hooksRecord["permission.ask"] as (
      input: Record<string, unknown>,
      output: Record<string, unknown>
    ) => Promise<void>;
    expect(permHook).toBeTypeOf("function");
  });

  it("permission.ask auto-allows managed sessions", async () => {
    mockForemanInstance.isManagedSession.mockImplementation(
      () => true
    );

    const input = createMockInput();
    const hooks = await plugin(input);
    const hooksRecord = hooks as Record<string, unknown>;

    const permHook = hooksRecord["permission.ask"] as (
      input: { sessionID?: string; type?: string },
      output: { status?: string }
    ) => Promise<void>;

    const hookInput = {
      sessionID: "test-session",
      type: "file.write",
    };
    const hookOutput: { status?: string } = {};

    await permHook(hookInput, hookOutput);

    expect(hookOutput.status).toBe("allow");
  });

  it(
    "permission.ask does not modify output for unmanaged sessions",
    async () => {
      mockForemanInstance.isManagedSession.mockImplementation(
        () => false
      );

      const input = createMockInput();
      const hooks = await plugin(input);
      const hooksRecord = hooks as Record<string, unknown>;

      const permHook = hooksRecord["permission.ask"] as (
        input: { sessionID?: string; type?: string },
        output: { status?: string }
      ) => Promise<void>;

      const hookInput = {
        sessionID: "unknown-session",
        type: "file.write",
      };
      const hookOutput: { status?: string } = {};

      await permHook(hookInput, hookOutput);

      expect(hookOutput.status).toBeUndefined();
    }
  );

  it("foreman_status returns enriched pipe-separated format", async () => {
    mockForemanInstance.getStatus.mockImplementation(
      () =>
        ({
          state: "Developing",
          storyId: "1-3",
          iteration: 2,
          maxIterations: 3,
          currentRole: "Developer",
          sessionDurationMs: 5000,
          taskStats: { total: 5, completed: 2 },
        }) as ForemanStatus
    );

    const input = createMockInput();
    const hooks = (await plugin(input)) as Required<Hooks>;

    const statusTool = hooks.tool?.foreman_status;
    const mockContext = {
      metadata: mock(() => undefined),
    } as unknown as ToolContext;

    const result = await statusTool?.execute(
      {} as Record<string, never>,
      mockContext
    );

    expect(result).toContain("State: Developing");
    expect(result).toContain("Story: 1-3");
    expect(result).toContain("Iteration: 2/3");
    expect(result).toContain("Role: Developer");
    expect(result).toContain("Duration:");
    expect(result).toContain("Tasks: 2/5");
    expect(result).toContain("|");
  });

  it("loads config with correct directory", async () => {
    const input = createMockInput();
    await plugin(input);
    expect(loadConfig).toHaveBeenCalledWith(input.directory);
  });

  it("creates Foreman with config and client", async () => {
    const input = createMockInput();
    await plugin(input);
    expect(Foreman).toHaveBeenCalledWith(
      mockConfig,
      input.client
    );
  });

  afterAll(() => {
    mock.restore();
  });
});
