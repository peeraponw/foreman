/**
 * Story file parsing and state derivation.
 *
 * Parses BMAD story files to extract status, review sections,
 * and task statistics. Derives ForemanState from story content.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ForemanState, StoryState } from "./types.js";

/**
 * Parse a story file's content to extract structured state.
 *
 * @param content - Raw markdown content of a story file
 * @returns Parsed StoryState object
 * @throws Error if Status field is missing or content is empty
 */
export function parseStoryFile(content: string): StoryState {
  if (!content || content.trim().length === 0) {
    throw new Error("Story file content is empty");
  }

  const statusMatch = content.match(/^Status:\s*(.+)$/m);
  if (!statusMatch) {
    throw new Error("Story file missing Status field");
  }
  const status = statusMatch[1].trim();

  const hasReviewSection = /##\s+Senior Developer Review \(AI\)/.test(content);

  // Review Follow-ups section: find content between this header and next ## header or end
  const reviewFollowupsMatch = content.match(
    /##\s+Review Follow-ups \(AI\)([\s\S]*?)(?=\n##\s|$)/
  );
  let hasUnresolvedItems = false;
  if (reviewFollowupsMatch) {
    const followupsContent = reviewFollowupsMatch[1];
    const uncheckedItems = followupsContent.match(/^- \[ \]/gm);
    hasUnresolvedItems = uncheckedItems !== null && uncheckedItems.length > 0;
  }

  // Task checkbox stats: total (- [ ] + - [x]) and completed (- [x])
  const totalCheckboxes = content.match(/^- \[[ x]\]/gm);
  const completedCheckboxes = content.match(/^- \[x\]/gm);

  const taskStats = {
    total: totalCheckboxes ? totalCheckboxes.length : 0,
    completed: completedCheckboxes ? completedCheckboxes.length : 0,
  };

  return {
    status,
    hasReviewSection,
    hasUnresolvedItems,
    taskStats,
  };
}

/**
 * Derive ForemanState from parsed story state.
 *
 * State derivation table:
 * | Status         | hasReviewSection | ForemanState      |
 * |----------------|-----------------|-------------------|
 * | ready-for-dev  | No              | Idle              |
 * | in-progress    | No              | Developing        |
 * | review         | No/Yes          | Reviewing         |
 * | in-progress    | Yes             | Developing        |
 * | done           | (any)           | Complete          |
 *
 * @param story - Parsed StoryState object
 * @returns Corresponding ForemanState
 * @throws Error for unknown status values
 */
export function deriveState(story: StoryState): ForemanState {
  const { status, hasReviewSection } = story;

  switch (status) {
    case "ready-for-dev":
      return ForemanState.Idle;

    case "in-progress":
      return ForemanState.Developing;

    case "review":
      return ForemanState.Reviewing;

    case "done":
      return ForemanState.Complete;

    default:
      throw new Error(`Unknown story status: ${status}`);
  }
}

/**
 * Resolve a story file path from a story ID.
 *
 * Searches for files matching pattern `{storyId}-*.md` in the stories directory.
 *
 * @param storiesDir - Path to the stories directory
 * @param storyId - Story identifier (e.g., "1-3", "5-3")
 * @returns Full path to the matching story file
 * @throws Error if no matching file found
 */
export function resolveStoryPath(storiesDir: string, storyId: string): string {
  const files = fs.readdirSync(storiesDir);
  const pattern = new RegExp(`^${escapeRegex(storyId)}-.*\\.md$`);
  const matches = files.filter((f) => pattern.test(f)).sort();

  if (matches.length === 0) {
    throw new Error(`No story file found for ID: ${storyId}`);
  }

  if (matches.length > 1) {
    console.warn(
      `Multiple story files found for ID ${storyId}: ${matches.join(", ")}. Using: ${matches[0]}`
    );
  }

  return path.join(storiesDir, matches[0]);
}

/**
 * Read and parse a story file from disk.
 *
 * @param filePath - Full path to the story file
 * @returns Parsed StoryState object
 */
export async function readAndParseStory(filePath: string): Promise<StoryState> {
  const content = await fs.promises.readFile(filePath, "utf-8");
  return parseStoryFile(content);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
