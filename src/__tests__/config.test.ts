import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  RoleConfigSchema,
  ForemanConfigSchema,
  DEFAULT_CONFIG,
  loadConfig,
} from "../config";
import type { ForemanConfig, RoleConfig } from "../types";

describe("RoleConfigSchema", () => {
  it("parses valid role config", () => {
    const input = {
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      agent: "sisyphus",
    };
    const result = RoleConfigSchema.parse(input);
    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.agent).toBe("sisyphus");
  });

  it("rejects missing provider", () => {
    const input = {
      model: "claude-sonnet-4-20250514",
      agent: "sisyphus",
    };
    expect(() => RoleConfigSchema.parse(input)).toThrow();
  });

  it("rejects non-string provider", () => {
    const input = {
      provider: 123,
      model: "claude-sonnet-4-20250514",
      agent: "sisyphus",
    };
    expect(() => RoleConfigSchema.parse(input)).toThrow();
  });
});

describe("ForemanConfigSchema", () => {
  it("parses valid full config with all fields", () => {
    const input = {
      stories_dir: "docs/stories",
      sprint_status: "docs/sprint-status.yaml",
      max_iterations: 5,
      contexts: ["docs/epics.md", "docs/architecture.md"],
      roles: {
        developer: { provider: "anthropic", model: "claude-sonnet-4", agent: "sisyphus" },
        reviewer: { provider: "anthropic", model: "claude-sonnet-4", agent: "sisyphus" },
        arbiter: { provider: "anthropic", model: "claude-opus-4", agent: "sisyphus" },
      },
      role_timeout_ms: 600000,
    };
    const result = ForemanConfigSchema.parse(input);
    expect(result.stories_dir).toBe("docs/stories");
    expect(result.max_iterations).toBe(5);
    expect(result.contexts).toHaveLength(2);
    expect(result.role_timeout_ms).toBe(600000);
  });

  it("applies defaults for missing optional fields", () => {
    const input = {
      stories_dir: "custom/stories",
    };
    const result = ForemanConfigSchema.parse(input);
    expect(result.stories_dir).toBe("custom/stories");
    expect(result.max_iterations).toBe(3);
    expect(result.role_timeout_ms).toBe(1800000);
  });

  it("partial config merges correctly with defaults", () => {
    const input = {
      max_iterations: 10,
      contexts: ["docs/readme.md"],
    };
    const result = ForemanConfigSchema.parse(input);
    expect(result.max_iterations).toBe(10);
    expect(result.contexts).toEqual(["docs/readme.md"]);
    // Defaults applied
    expect(result.stories_dir).toBe("docs/stories");
    expect(result.sprint_status).toBe("docs/sprint-status.yaml");
    expect(result.role_timeout_ms).toBe(1800000);
  });

  it("rejects max_iterations less than 1", () => {
    const input = {
      max_iterations: 0,
    };
    expect(() => ForemanConfigSchema.parse(input)).toThrow();
  });

  it("rejects negative max_iterations", () => {
    const input = {
      max_iterations: -5,
    };
    expect(() => ForemanConfigSchema.parse(input)).toThrow();
  });

  it("empty object returns full DEFAULT_CONFIG", () => {
    const result = ForemanConfigSchema.parse({});
    expect(result.stories_dir).toBe("docs/stories");
    expect(result.sprint_status).toBe("docs/sprint-status.yaml");
    expect(result.max_iterations).toBe(3);
    expect(result.contexts).toEqual([]);
    expect(result.role_timeout_ms).toBe(1800000);
    expect(result.roles.developer.provider).toBe("anthropic");
    expect(result.roles.developer.model).toBe("claude-sonnet-4-20250514");
    expect(result.roles.developer.agent).toBe("sisyphus");
    expect(result.roles.reviewer.provider).toBe("anthropic");
    expect(result.roles.arbiter.model).toBe("claude-opus-4-20250514");
  });

  it("rejects invalid JSON types for max_iterations", () => {
    const input = {
      max_iterations: "three",
    };
    expect(() => ForemanConfigSchema.parse(input)).toThrow();
  });

  it("rejects invalid JSON types for contexts", () => {
    const input = {
      contexts: "not-an-array",
    };
    expect(() => ForemanConfigSchema.parse(input)).toThrow();
  });
});

describe("DEFAULT_CONFIG constant", () => {
  it("has all expected field values", () => {
    expect(DEFAULT_CONFIG.stories_dir).toBe("docs/stories");
    expect(DEFAULT_CONFIG.sprint_status).toBe("docs/sprint-status.yaml");
    expect(DEFAULT_CONFIG.max_iterations).toBe(3);
    expect(DEFAULT_CONFIG.contexts).toEqual([]);
    expect(DEFAULT_CONFIG.role_timeout_ms).toBe(1800000);
  });

  it("has correct default role configurations", () => {
    expect(DEFAULT_CONFIG.roles.developer.provider).toBe("anthropic");
    expect(DEFAULT_CONFIG.roles.developer.model).toBe("claude-sonnet-4-20250514");
    expect(DEFAULT_CONFIG.roles.developer.agent).toBe("sisyphus");

    expect(DEFAULT_CONFIG.roles.reviewer.provider).toBe("anthropic");
    expect(DEFAULT_CONFIG.roles.reviewer.model).toBe("claude-sonnet-4-20250514");
    expect(DEFAULT_CONFIG.roles.reviewer.agent).toBe("sisyphus");

    expect(DEFAULT_CONFIG.roles.arbiter.provider).toBe("anthropic");
    expect(DEFAULT_CONFIG.roles.arbiter.model).toBe("claude-opus-4-20250514");
    expect(DEFAULT_CONFIG.roles.arbiter.agent).toBe("sisyphus");
  });

  it("satisfies ForemanConfig type", () => {
    const config: ForemanConfig = DEFAULT_CONFIG;
    expect(config.stories_dir).toBe("docs/stories");
  });
});

describe("loadConfig", () => {
  const testConfigDir = path.join(os.tmpdir(), "foreman-test-config");
  const testConfigPath = path.join(testConfigDir, ".config", "opencode", "foreman.json");

  beforeEach(() => {
    // Create test directory structure
    const configDir = path.dirname(testConfigPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Cleanup test directory
    if (fs.existsSync(testConfigDir)) {
      fs.rmSync(testConfigDir, { recursive: true, force: true });
    }
  });

  it("returns DEFAULT_CONFIG when config file missing", () => {
    // Use a non-existent path
    const nonexistentPath = path.join(os.tmpdir(), "nonexistent-config-dir-xyz123");
    const config = loadConfig(nonexistentPath);
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  it("returns DEFAULT_CONFIG when directory param is undefined", () => {
    // This will try to read from ~/.config/opencode/foreman.json which likely doesn't exist
    // We test that it gracefully returns defaults
    const originalHome = process.env.HOME;
    process.env.HOME = "/nonexistent/home/path/xyz123";
    
    try {
      const config = loadConfig();
      expect(config).toEqual(DEFAULT_CONFIG);
    } finally {
      process.env.HOME = originalHome;
    }
  });

  it("loads and parses valid config file", () => {
    const configContent = {
      max_iterations: 7,
      contexts: ["docs/custom.md"],
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(configContent));

    const config = loadConfig(testConfigDir);
    expect(config.max_iterations).toBe(7);
    expect(config.contexts).toEqual(["docs/custom.md"]);
    // Defaults still applied
    expect(config.stories_dir).toBe("docs/stories");
  });

  it("throws clear error for invalid JSON", () => {
    fs.writeFileSync(testConfigPath, "{ invalid json }");

    expect(() => loadConfig(testConfigDir)).toThrow(/JSON/);
  });

  it("throws clear error for invalid config schema", () => {
    const configContent = {
      max_iterations: "not-a-number",
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(configContent));

    expect(() => loadConfig(testConfigDir)).toThrow();
  });

  it("merges partial config with defaults", () => {
    const configContent = {
      roles: {
        developer: {
          provider: "openai",
          model: "gpt-4",
          agent: "custom-agent",
        },
      },
    };
    fs.writeFileSync(testConfigPath, JSON.stringify(configContent));

    const config = loadConfig(testConfigDir);
    expect(config.roles.developer.provider).toBe("openai");
    expect(config.roles.developer.model).toBe("gpt-4");
    expect(config.roles.developer.agent).toBe("custom-agent");
    // Other roles keep defaults
    expect(config.roles.reviewer.provider).toBe("anthropic");
    expect(config.roles.arbiter.provider).toBe("anthropic");
    // Other fields keep defaults
    expect(config.max_iterations).toBe(3);
    expect(config.stories_dir).toBe("docs/stories");
  });
});
