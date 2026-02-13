import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "bun:test";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import {
  RoleConfigSchema,
  ForemanConfigSchema,
  DEFAULT_CONFIG,
  loadConfig,
  findConfigFile,
  parseConfigFile,
  mergeConfigs,
} from "../config";
import type { ForemanConfig } from "../types";

describe("RoleConfigSchema", () => {
  it("parses valid role config", () => {
    const input = {
      model: "anthropic/claude-sonnet-4-20250514",
      agent: "sisyphus",
    };
    const result = RoleConfigSchema.parse(input);
    expect(result.model).toBe(
      "anthropic/claude-sonnet-4-20250514"
    );
    expect(result.agent).toBe("sisyphus");
  });

  it("rejects missing model", () => {
    expect(() =>
      RoleConfigSchema.parse({ agent: "sisyphus" })
    ).toThrow();
  });

  it("rejects non-string model", () => {
    expect(() =>
      RoleConfigSchema.parse({
        model: 123,
        agent: "sisyphus",
      })
    ).toThrow();
  });
});

describe("ForemanConfigSchema", () => {
  it("parses valid full config", () => {
    const input = {
      stories_dir: "docs/stories",
      sprint_status: "docs/sprint-status.yaml",
      max_iterations: 5,
      contexts: ["docs/epics.md", "docs/architecture.md"],
      roles: {
        developer: {
          model: "anthropic/claude-sonnet-4",
          agent: "sisyphus",
        },
        reviewer: {
          model: "anthropic/claude-sonnet-4",
          agent: "sisyphus",
        },
        arbiter: {
          model: "anthropic/claude-opus-4",
          agent: "sisyphus",
        },
      },
      role_timeout_ms: 600000,
    };
    const result = ForemanConfigSchema.parse(input);
    expect(result.stories_dir).toBe("docs/stories");
    expect(result.max_iterations).toBe(5);
    expect(result.contexts).toHaveLength(2);
    expect(result.role_timeout_ms).toBe(600000);
  });

  it("applies defaults for missing fields", () => {
    const result = ForemanConfigSchema.parse({
      stories_dir: "custom/stories",
    });
    expect(result.stories_dir).toBe("custom/stories");
    expect(result.max_iterations).toBe(3);
    expect(result.role_timeout_ms).toBe(1800000);
  });

  it("partial config merges with defaults", () => {
    const result = ForemanConfigSchema.parse({
      max_iterations: 10,
      contexts: ["docs/readme.md"],
    });
    expect(result.max_iterations).toBe(10);
    expect(result.contexts).toEqual(["docs/readme.md"]);
    expect(result.stories_dir).toBe("docs/stories");
    expect(result.sprint_status).toBe(
      "docs/sprint-status.yaml"
    );
    expect(result.role_timeout_ms).toBe(1800000);
  });

  it("rejects max_iterations less than 1", () => {
    expect(() =>
      ForemanConfigSchema.parse({ max_iterations: 0 })
    ).toThrow();
  });

  it("rejects negative max_iterations", () => {
    expect(() =>
      ForemanConfigSchema.parse({ max_iterations: -5 })
    ).toThrow();
  });

  it("empty object returns full defaults", () => {
    const result = ForemanConfigSchema.parse({});
    expect(result.stories_dir).toBe("docs/stories");
    expect(result.sprint_status).toBe(
      "docs/sprint-status.yaml"
    );
    expect(result.max_iterations).toBe(3);
    expect(result.contexts).toEqual([]);
    expect(result.role_timeout_ms).toBe(1800000);
    expect(result.roles.developer.model).toBe(
      "anthropic/claude-sonnet-4-20250514"
    );
    expect(result.roles.developer.agent).toBe("sisyphus");
    expect(result.roles.reviewer.model).toBe(
      "anthropic/claude-sonnet-4-20250514"
    );
    expect(result.roles.arbiter.model).toBe(
      "anthropic/claude-opus-4-20250514"
    );
  });

  it("rejects invalid types for max_iterations", () => {
    expect(() =>
      ForemanConfigSchema.parse({
        max_iterations: "three",
      })
    ).toThrow();
  });

  it("rejects non-array contexts", () => {
    expect(() =>
      ForemanConfigSchema.parse({
        contexts: "not-an-array",
      })
    ).toThrow();
  });
});

describe("DEFAULT_CONFIG constant", () => {
  it("has all expected field values", () => {
    expect(DEFAULT_CONFIG.stories_dir).toBe("docs/stories");
    expect(DEFAULT_CONFIG.sprint_status).toBe(
      "docs/sprint-status.yaml"
    );
    expect(DEFAULT_CONFIG.max_iterations).toBe(3);
    expect(DEFAULT_CONFIG.contexts).toEqual([]);
    expect(DEFAULT_CONFIG.role_timeout_ms).toBe(1800000);
  });

  it("has correct default role configurations", () => {
    expect(DEFAULT_CONFIG.roles.developer.model).toBe(
      "anthropic/claude-sonnet-4-20250514"
    );
    expect(DEFAULT_CONFIG.roles.developer.agent).toBe(
      "sisyphus"
    );
    expect(DEFAULT_CONFIG.roles.reviewer.model).toBe(
      "anthropic/claude-sonnet-4-20250514"
    );
    expect(DEFAULT_CONFIG.roles.reviewer.agent).toBe(
      "sisyphus"
    );
    expect(DEFAULT_CONFIG.roles.arbiter.model).toBe(
      "anthropic/claude-opus-4-20250514"
    );
    expect(DEFAULT_CONFIG.roles.arbiter.agent).toBe(
      "sisyphus"
    );
  });

  it("satisfies ForemanConfig type", () => {
    const config: ForemanConfig = DEFAULT_CONFIG;
    expect(config.stories_dir).toBe("docs/stories");
  });
});

describe("findConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "foreman-find-")
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns undefined when no config exists", () => {
    expect(findConfigFile(tmpDir)).toBeUndefined();
  });

  it("finds foreman.yaml", () => {
    fs.writeFileSync(
      path.join(tmpDir, "foreman.yaml"),
      "max_iterations: 1"
    );
    expect(findConfigFile(tmpDir)).toBe(
      path.join(tmpDir, "foreman.yaml")
    );
  });

  it("finds foreman.yml", () => {
    fs.writeFileSync(
      path.join(tmpDir, "foreman.yml"),
      "max_iterations: 1"
    );
    expect(findConfigFile(tmpDir)).toBe(
      path.join(tmpDir, "foreman.yml")
    );
  });

  it("finds foreman.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "foreman.json"),
      '{"max_iterations": 1}'
    );
    expect(findConfigFile(tmpDir)).toBe(
      path.join(tmpDir, "foreman.json")
    );
  });

  it("prefers .yaml over .yml over .json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "foreman.json"),
      "{}"
    );
    fs.writeFileSync(
      path.join(tmpDir, "foreman.yml"),
      ""
    );
    fs.writeFileSync(
      path.join(tmpDir, "foreman.yaml"),
      ""
    );
    expect(findConfigFile(tmpDir)).toBe(
      path.join(tmpDir, "foreman.yaml")
    );
  });
});

describe("parseConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "foreman-parse-")
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses valid YAML", () => {
    const filePath = path.join(tmpDir, "foreman.yaml");
    fs.writeFileSync(
      filePath,
      yaml.dump({ max_iterations: 7 })
    );
    const result = parseConfigFile(filePath);
    expect(result).toEqual({ max_iterations: 7 });
  });

  it("parses valid JSON", () => {
    const filePath = path.join(tmpDir, "foreman.json");
    fs.writeFileSync(
      filePath,
      JSON.stringify({ max_iterations: 12 })
    );
    const result = parseConfigFile(filePath);
    expect(result).toEqual({ max_iterations: 12 });
  });

  it("throws on invalid YAML", () => {
    const filePath = path.join(tmpDir, "foreman.yaml");
    fs.writeFileSync(filePath, "max_iterations: [\n{bad");
    expect(() => parseConfigFile(filePath)).toThrow(/YAML/);
  });

  it("throws on invalid JSON", () => {
    const filePath = path.join(tmpDir, "foreman.json");
    fs.writeFileSync(filePath, "{ invalid json }");
    expect(() => parseConfigFile(filePath)).toThrow(/JSON/);
  });
});

describe("mergeConfigs", () => {
  it("override replaces primitive values", () => {
    const base = { max_iterations: 3 };
    const override = { max_iterations: 10 };
    expect(mergeConfigs(base, override)).toEqual({
      max_iterations: 10,
    });
  });

  it("override adds new keys", () => {
    const base = { a: 1 };
    const override = { b: 2 };
    expect(mergeConfigs(base, override)).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("override replaces arrays entirely", () => {
    const base = { contexts: ["a.md", "b.md"] };
    const override = { contexts: ["c.md"] };
    expect(mergeConfigs(base, override)).toEqual({
      contexts: ["c.md"],
    });
  });

  it("deep-merges nested objects", () => {
    const base = {
      roles: {
        developer: { model: "old", agent: "sisyphus" },
        reviewer: { model: "old", agent: "sisyphus" },
      },
    };
    const override = {
      roles: {
        developer: { model: "new", agent: "custom" },
      },
    };
    const result = mergeConfigs(base, override);
    expect(result).toEqual({
      roles: {
        developer: { model: "new", agent: "custom" },
        reviewer: { model: "old", agent: "sisyphus" },
      },
    });
  });

  it("empty override returns base", () => {
    const base = { a: 1, b: 2 };
    expect(mergeConfigs(base, {})).toEqual({ a: 1, b: 2 });
  });

  it("empty base returns override", () => {
    const override = { a: 1 };
    expect(mergeConfigs({}, override)).toEqual({ a: 1 });
  });
});

describe("loadConfig", () => {
  let projectDir: string;
  let fakeHome: string;
  let userConfigDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "foreman-proj-")
    );
    fakeHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "foreman-home-")
    );
    userConfigDir = path.join(
      fakeHome,
      ".config",
      "opencode"
    );
    fs.mkdirSync(userConfigDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectDir, {
      recursive: true,
      force: true,
    });
    fs.rmSync(fakeHome, {
      recursive: true,
      force: true,
    });
  });

  it("returns defaults with resolved paths when no config", () => {
    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(3);
    expect(config.stories_dir).toBe(
      path.join(projectDir, "docs/stories")
    );
    expect(config.sprint_status).toBe(
      path.join(projectDir, "docs/sprint-status.yaml")
    );
  });

  it("loads user config from ~/.config/opencode/", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yaml"),
      yaml.dump({ max_iterations: 7 })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(7);
  });

  it("loads project config from .opencode/", () => {
    const dir = path.join(projectDir, ".opencode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "foreman.yaml"),
      yaml.dump({ max_iterations: 5 })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(5);
  });

  it("loads project config from .claude/", () => {
    const dir = path.join(projectDir, ".claude");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "foreman.yaml"),
      yaml.dump({ max_iterations: 4 })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(4);
  });

  it("prefers .opencode/ over .claude/", () => {
    const ocDir = path.join(projectDir, ".opencode");
    const clDir = path.join(projectDir, ".claude");
    fs.mkdirSync(ocDir, { recursive: true });
    fs.mkdirSync(clDir, { recursive: true });
    fs.writeFileSync(
      path.join(ocDir, "foreman.yaml"),
      yaml.dump({ max_iterations: 10 })
    );
    fs.writeFileSync(
      path.join(clDir, "foreman.yaml"),
      yaml.dump({ max_iterations: 20 })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(10);
  });

  it("project config overrides user config", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yaml"),
      yaml.dump({
        max_iterations: 7,
        contexts: ["user.md"],
      })
    );

    const dir = path.join(projectDir, ".opencode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "foreman.yaml"),
      yaml.dump({ max_iterations: 2 })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(2);
    expect(config.contexts).toEqual([
      path.join(projectDir, "user.md"),
    ]);
  });

  it("deep-merges roles across user and project", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yaml"),
      yaml.dump({
        roles: {
          developer: {
            model: "openai/gpt-4",
            agent: "custom",
          },
        },
      })
    );

    const dir = path.join(projectDir, ".opencode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "foreman.yaml"),
      yaml.dump({
        roles: {
          developer: {
            model: "anthropic/claude-sonnet-4",
            agent: "custom",
          },
        },
      })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.roles.developer.model).toBe(
      "anthropic/claude-sonnet-4"
    );
    expect(config.roles.reviewer.model).toBe(
      "anthropic/claude-sonnet-4-20250514"
    );
  });

  it("resolves relative paths against projectDir", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yaml"),
      yaml.dump({
        stories_dir: "custom/stories",
        sprint_status: "custom/sprint.yaml",
        contexts: ["docs/a.md", "docs/b.md"],
      })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.stories_dir).toBe(
      path.join(projectDir, "custom/stories")
    );
    expect(config.sprint_status).toBe(
      path.join(projectDir, "custom/sprint.yaml")
    );
    expect(config.contexts).toEqual([
      path.join(projectDir, "docs/a.md"),
      path.join(projectDir, "docs/b.md"),
    ]);
  });

  it("leaves absolute paths untouched", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yaml"),
      yaml.dump({
        stories_dir: "/absolute/stories",
        contexts: ["/absolute/a.md"],
      })
    );

    const config = loadConfig(projectDir, fakeHome);
    expect(config.stories_dir).toBe("/absolute/stories");
    expect(config.contexts).toEqual(["/absolute/a.md"]);
  });

  it("throws on invalid YAML in user config", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yaml"),
      "max_iterations: [\ninvalid: yaml: {"
    );
    expect(() =>
      loadConfig(projectDir, fakeHome)
    ).toThrow(/YAML/);
  });

  it("throws on invalid schema in project config", () => {
    const dir = path.join(projectDir, ".opencode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "foreman.yaml"),
      yaml.dump({ max_iterations: "not-a-number" })
    );
    expect(() =>
      loadConfig(projectDir, fakeHome)
    ).toThrow();
  });

  it("user config with .yml extension works", () => {
    fs.writeFileSync(
      path.join(userConfigDir, "foreman.yml"),
      yaml.dump({ max_iterations: 5 })
    );
    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(5);
  });

  it("project config JSON works", () => {
    const dir = path.join(projectDir, ".opencode");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "foreman.json"),
      JSON.stringify({ max_iterations: 8 })
    );
    const config = loadConfig(projectDir, fakeHome);
    expect(config.max_iterations).toBe(8);
  });
});
