import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import type { ForemanConfig } from "./types";

export const RoleConfigSchema = z.object({
  provider: z.string(),
  model: z.string(),
  agent: z.string(),
});

const defaultRoleConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-20250514",
  agent: "sisyphus",
};

const defaultArbiterConfig = {
  provider: "anthropic",
  model: "claude-opus-4-20250514",
  agent: "sisyphus",
};

export const ForemanConfigSchema = z.object({
  stories_dir: z.string().default("docs/stories"),
  sprint_status: z.string().default("docs/sprint-status.yaml"),
  max_iterations: z.number().int().min(1).default(3),
  contexts: z.array(z.string()).default([]),
  roles: z
    .object({
      developer: RoleConfigSchema.default(defaultRoleConfig),
      reviewer: RoleConfigSchema.default(defaultRoleConfig),
      arbiter: RoleConfigSchema.default(defaultArbiterConfig),
    })
    .default({}),
  role_timeout_ms: z.number().int().min(1000).default(1800000),
});

export const DEFAULT_CONFIG: ForemanConfig = ForemanConfigSchema.parse({});

export function loadConfig(directory?: string): ForemanConfig {
  const homeDir = directory ?? os.homedir();
  const configPath = path.join(homeDir, ".config", "opencode", "foreman.json");

  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  const fileContent = fs.readFileSync(configPath, "utf-8");

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse config JSON: ${errorMessage}`);
  }

  return ForemanConfigSchema.parse(parsed);
}
