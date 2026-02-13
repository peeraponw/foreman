import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import yaml from "js-yaml";
import type { ForemanConfig } from "./types";

export const RoleConfigSchema = z.object({
  model: z.string(),
  agent: z.string(),
});

const defaultRoleConfig = {
  model: "anthropic/claude-sonnet-4-20250514",
  agent: "sisyphus",
};

const defaultArbiterConfig = {
  model: "anthropic/claude-opus-4-20250514",
  agent: "sisyphus",
};

export const ForemanConfigSchema = z.object({
  stories_dir: z.string().default("docs/stories"),
  sprint_status: z
    .string()
    .default("docs/sprint-status.yaml"),
  max_iterations: z.number().int().min(1).default(3),
  contexts: z.array(z.string()).default([]),
  roles: z
    .object({
      developer: RoleConfigSchema.default(defaultRoleConfig),
      reviewer: RoleConfigSchema.default(defaultRoleConfig),
      arbiter: RoleConfigSchema.default(defaultArbiterConfig),
    })
    .default({}),
  role_timeout_ms: z
    .number()
    .int()
    .min(1000)
    .default(1800000),
});

export const DEFAULT_CONFIG: ForemanConfig =
  ForemanConfigSchema.parse({});

const CONFIG_NAMES = [
  "foreman.yaml",
  "foreman.yml",
  "foreman.json",
] as const;

const PROJECT_CONFIG_DIRS = [
  ".opencode",
  ".claude",
] as const;

/**
 * Find first matching config file in a directory.
 * Tries foreman.yaml, foreman.yml, foreman.json in order.
 */
export function findConfigFile(
  dir: string
): string | undefined {
  for (const name of CONFIG_NAMES) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Parse a config file (YAML or JSON) into raw object.
 * Throws on malformed content.
 */
export function parseConfigFile(
  configPath: string
): unknown {
  const content = fs.readFileSync(configPath, "utf-8");
  const isYaml =
    configPath.endsWith(".yaml") ||
    configPath.endsWith(".yml");

  try {
    return isYaml ? yaml.load(content) : JSON.parse(content);
  } catch (e) {
    const format = isYaml ? "YAML" : "JSON";
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Failed to parse config ${format}: ${msg}`
    );
  }
}

/**
 * Deep-merge two plain objects. Arrays and primitives from
 * `override` replace `base`. Nested objects merge recursively.
 */
export function mergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };

  for (const key of Object.keys(override)) {
    const baseVal = base[key];
    const overVal = override[key];

    if (isPlainObject(baseVal) && isPlainObject(overVal)) {
      result[key] = mergeConfigs(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>
      );
    } else {
      result[key] = overVal;
    }
  }

  return result;
}

function isPlainObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function resolveIfRelative(
  filePath: string,
  baseDir: string
): string {
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.join(baseDir, filePath);
}

function resolvePaths(
  config: ForemanConfig,
  projectDir: string
): ForemanConfig {
  return {
    ...config,
    stories_dir: resolveIfRelative(
      config.stories_dir,
      projectDir
    ),
    sprint_status: resolveIfRelative(
      config.sprint_status,
      projectDir
    ),
    contexts: config.contexts.map((c) =>
      resolveIfRelative(c, projectDir)
    ),
  };
}

function findProjectConfig(
  projectDir: string
): string | undefined {
  for (const dir of PROJECT_CONFIG_DIRS) {
    const found = findConfigFile(
      path.join(projectDir, dir)
    );
    if (found) {
      return found;
    }
  }
  return undefined;
}

/**
 * Load and merge configuration from user and project levels.
 *
 * Resolution order (later overrides earlier):
 *   1. Built-in defaults
 *   2. User config: ~/.config/opencode/foreman.{yaml,yml,json}
 *   3. Project config: {projectDir}/.opencode/foreman.*
 *      or {projectDir}/.claude/foreman.*
 *
 * All relative paths (stories_dir, sprint_status, contexts)
 * are resolved relative to projectDir.
 */
export function loadConfig(
  projectDir: string,
  homeDir: string = os.homedir()
): ForemanConfig {
  let merged: Record<string, unknown> = {};

  // Layer 1: User-level config (~/.config/opencode/)
  const userConfigDir = path.join(
    homeDir,
    ".config",
    "opencode"
  );
  const userConfigPath = findConfigFile(userConfigDir);
  if (userConfigPath) {
    const raw = parseConfigFile(userConfigPath);
    if (isPlainObject(raw)) {
      merged = raw as Record<string, unknown>;
    }
  }

  // Layer 2: Project-level config (.opencode/ or .claude/)
  const projectConfigPath = findProjectConfig(projectDir);
  if (projectConfigPath) {
    const raw = parseConfigFile(projectConfigPath);
    if (isPlainObject(raw)) {
      merged = mergeConfigs(
        merged,
        raw as Record<string, unknown>
      );
    }
  }

  const validated = ForemanConfigSchema.parse(merged);

  return resolvePaths(validated, projectDir);
}
