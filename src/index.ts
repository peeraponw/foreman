import type { Plugin, PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { Foreman, type PluginClient } from "./foreman.js";

const plugin: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const config = loadConfig(input.directory);
  const foreman = new Foreman(config, input.client as PluginClient);

  return {
    tool: {
      foreman_run: tool({
        description: "Run the full develop-review-arbitrate loop for a BMAD story",
        args: {
          story_id: tool.schema.string().describe("Story ID (e.g., '1-3')"),
        },
        async execute(args, _context: ToolContext) {
          return await foreman.run(args.story_id, input.directory);
        },
      }),
      foreman_status: tool({
        description: "Show current status of the Foreman orchestrator",
        args: {},
        async execute(_args: Record<string, never>, _context: ToolContext) {
          const status = foreman.getStatus();
          return JSON.stringify(status, null, 2);
        },
      }),
    },
    event: async ({ event }) => {
      foreman.handleEvent(event);
    },
  };
};

export default plugin;
