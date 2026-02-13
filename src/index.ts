import type { Plugin, PluginInput, Hooks, ToolContext } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import { Foreman, type PluginClient, type ProgressCallback } from "./foreman.js";

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
        async execute(args, context: ToolContext) {
          const onProgress: ProgressCallback = (update) => {
            context.metadata({
              title: update.title,
              metadata: update.metadata,
            });
            const variant = update.metadata.state === "Complete"
              ? "success" as const
              : update.metadata.state === "Failed"
                ? "error" as const
                : "info" as const;
            (input.client as PluginClient).tui.showToast({
              body: {
                title: "Foreman",
                message: update.title,
                variant,
              },
            });
          };
          return await foreman.run(args.story_id, onProgress);
        },
      }),
      foreman_status: tool({
        description: "Show current status of the Foreman orchestrator",
        args: {},
        async execute(_args: Record<string, never>, _context: ToolContext) {
          const status = foreman.getStatus();
          const lines = [
            `State: ${status.state}`,
            `Story: ${status.storyId ?? "none"}`,
            `Iteration: ${status.iteration}/${status.maxIterations}`,
          ];
          if (status.currentRole) lines.push(`Role: ${status.currentRole}`);
          if (status.sessionDurationMs != null) {
            lines.push(`Duration: ${Math.round(status.sessionDurationMs / 1000)}s`);
          }
          if (status.taskStats) {
            lines.push(`Tasks: ${status.taskStats.completed}/${status.taskStats.total}`);
          }
          return lines.join(" | ");
        },
      }),
    },
    "permission.ask": async (input: { sessionID?: string; type?: string }, output: { status?: string }) => {
      if (input.sessionID && foreman.isManagedSession(input.sessionID)) {
        output.status = "allow";
        console.warn(
          `[foreman] Auto-allowed permission "${input.type}" for session ${input.sessionID}`
        );
      }
    },
  };
};

export default plugin;
