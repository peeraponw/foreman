import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { ForemanState } from "../types.js";

import {
  parseStoryFile,
  deriveState,
  resolveStoryPath,
  readAndParseStory,
} from "../story-parser.js";

const PROJECT_ROOT = path.join(import.meta.dir, "../..");
const EXAMPLES_DIR = path.join(PROJECT_ROOT, "docs/examples");

describe("parseStoryFile", () => {
  describe("Status field extraction", () => {
    it("extracts 'ready-for-dev' status", () => {
      const content = "# Story\n\nStatus: ready-for-dev\n\n## Story";
      const result = parseStoryFile(content);
      expect(result.status).toBe("ready-for-dev");
    });

    it("extracts 'in-progress' status", () => {
      const content = "# Story\n\nStatus: in-progress\n\n## Story";
      const result = parseStoryFile(content);
      expect(result.status).toBe("in-progress");
    });

    it("extracts 'review' status", () => {
      const content = "# Story\n\nStatus: review\n\n## Story";
      const result = parseStoryFile(content);
      expect(result.status).toBe("review");
    });

    it("extracts 'done' status", () => {
      const content = "# Story\n\nStatus: done\n\n## Story";
      const result = parseStoryFile(content);
      expect(result.status).toBe("done");
    });
  });

  describe("Review section detection", () => {
    it("detects presence of Senior Developer Review section", () => {
      const content = `# Story

Status: review

## Senior Developer Review (AI)

Some review content here.`;
      const result = parseStoryFile(content);
      expect(result.hasReviewSection).toBe(true);
    });

    it("returns false when no Senior Developer Review section", () => {
      const content = `# Story

Status: in-progress

## Dev Notes

Some dev notes.`;
      const result = parseStoryFile(content);
      expect(result.hasReviewSection).toBe(false);
    });
  });

  describe("Unresolved items detection", () => {
    it("detects unchecked items in Review Follow-ups section", () => {
      const content = `# Story

Status: done

## Review Follow-ups (AI)

- [ ] Fix the bug
- [ ] Add more tests`;
      const result = parseStoryFile(content);
      expect(result.hasUnresolvedItems).toBe(true);
    });

    it("returns false when all items in Review Follow-ups are checked", () => {
      const content = `# Story

Status: done

## Review Follow-ups (AI)

- [x] Fix the bug
- [x] Add more tests`;
      const result = parseStoryFile(content);
      expect(result.hasUnresolvedItems).toBe(false);
    });

    it("returns false when no Review Follow-ups section exists", () => {
      const content = `# Story

Status: in-progress

## Tasks
- [ ] Task 1`;
      const result = parseStoryFile(content);
      expect(result.hasUnresolvedItems).toBe(false);
    });
  });

  describe("Task stats", () => {
    it("counts total and completed checkboxes across file", () => {
      const content = `# Story

Status: in-progress

## Tasks / Subtasks

- [x] Task 1
- [x] Task 2
- [ ] Task 3
- [ ] Task 4`;
      const result = parseStoryFile(content);
      expect(result.taskStats.total).toBe(4);
      expect(result.taskStats.completed).toBe(2);
    });

    it("returns zero counts when no checkboxes exist", () => {
      const content = `# Story

Status: ready-for-dev

## Story

No tasks yet.`;
      const result = parseStoryFile(content);
      expect(result.taskStats.total).toBe(0);
      expect(result.taskStats.completed).toBe(0);
    });
  });

  describe("Edge cases", () => {
    it("throws error for missing Status field", () => {
      const content = `# Story

## Story

No status here.`;
      expect(() => parseStoryFile(content)).toThrow("Story file missing Status field");
    });

    it("throws error for empty content", () => {
      expect(() => parseStoryFile("")).toThrow("Story file content is empty");
    });

    it("throws error for whitespace-only content", () => {
      expect(() => parseStoryFile("   \n\n   ")).toThrow("Story file content is empty");
    });
  });
});

describe("deriveState", () => {
  it("returns Idle for ready-for-dev status without review section", () => {
    const story = { status: "ready-for-dev", hasReviewSection: false, hasUnresolvedItems: false, taskStats: { total: 0, completed: 0 } };
    expect(deriveState(story)).toBe(ForemanState.Idle);
  });

  it("returns Developing for in-progress status without review section", () => {
    const story = { status: "in-progress", hasReviewSection: false, hasUnresolvedItems: false, taskStats: { total: 5, completed: 2 } };
    expect(deriveState(story)).toBe(ForemanState.Developing);
  });

  it("returns Developing for in-progress status with review section (fixing)", () => {
    const story = { status: "in-progress", hasReviewSection: true, hasUnresolvedItems: true, taskStats: { total: 5, completed: 3 } };
    expect(deriveState(story)).toBe(ForemanState.Developing);
  });

  it("returns Reviewing for review status without review section", () => {
    const story = { status: "review", hasReviewSection: false, hasUnresolvedItems: false, taskStats: { total: 5, completed: 5 } };
    expect(deriveState(story)).toBe(ForemanState.Reviewing);
  });

  it("returns Reviewing for review status with review section", () => {
    const story = { status: "review", hasReviewSection: true, hasUnresolvedItems: false, taskStats: { total: 5, completed: 5 } };
    expect(deriveState(story)).toBe(ForemanState.Reviewing);
  });

  it("returns Complete for done status", () => {
    const story = { status: "done", hasReviewSection: true, hasUnresolvedItems: false, taskStats: { total: 5, completed: 5 } };
    expect(deriveState(story)).toBe(ForemanState.Complete);
  });

  it("returns Complete for done status without review section", () => {
    const story = { status: "done", hasReviewSection: false, hasUnresolvedItems: false, taskStats: { total: 5, completed: 5 } };
    expect(deriveState(story)).toBe(ForemanState.Complete);
  });

  it("throws error for unknown status", () => {
    const story = { status: "unknown-status", hasReviewSection: false, hasUnresolvedItems: false, taskStats: { total: 0, completed: 0 } };
    expect(() => deriveState(story)).toThrow("Unknown story status: unknown-status");
  });
});

describe("resolveStoryPath", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(import.meta.dir, "test-stories-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns path when single match found", () => {
    fs.writeFileSync(path.join(tempDir, "1-3-add-feature.md"), "# Story");
    const result = resolveStoryPath(tempDir, "1-3");
    expect(result).toBe(path.join(tempDir, "1-3-add-feature.md"));
  });

  it("throws error when no match found", () => {
    fs.writeFileSync(path.join(tempDir, "other-story.md"), "# Story");
    expect(() => resolveStoryPath(tempDir, "1-3")).toThrow("No story file found for ID: 1-3");
  });

  it("returns first alphabetically when multiple matches found", () => {
    fs.writeFileSync(path.join(tempDir, "5-3-zebra.md"), "# Story");
    fs.writeFileSync(path.join(tempDir, "5-3-apple.md"), "# Story");
    const result = resolveStoryPath(tempDir, "5-3");
    expect(result).toBe(path.join(tempDir, "5-3-apple.md"));
  });
});

describe("readAndParseStory", () => {
  let tempFile: string;

  beforeEach(() => {
    tempFile = path.join(import.meta.dir, "test-story.md");
  });

  afterEach(() => {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
  });

  it("reads and parses a story file from disk", async () => {
    const content = `# Story

Status: in-progress

## Tasks
- [x] Task 1
- [ ] Task 2`;
    fs.writeFileSync(tempFile, content);

    const result = await readAndParseStory(tempFile);
    expect(result.status).toBe("in-progress");
    expect(result.taskStats.total).toBe(2);
    expect(result.taskStats.completed).toBe(1);
  });
});

describe("Real fixtures from docs/examples", () => {
  it("parses 2-3-state-persistence-with-atomic-writes.md correctly", async () => {
    const filePath = path.join(EXAMPLES_DIR, "2-3-state-persistence-with-atomic-writes.md");
    const result = await readAndParseStory(filePath);

    expect(result.status).toBe("done");
    expect(result.hasReviewSection).toBe(false);
    expect(result.taskStats.completed).toBeGreaterThan(0);
    expect(result.taskStats.total).toBe(result.taskStats.completed);

    expect(deriveState(result)).toBe(ForemanState.Complete);
  });

  it("parses 3-1-agent-protocol-base-implementation.md correctly", async () => {
    const filePath = path.join(EXAMPLES_DIR, "3-1-agent-protocol-base-implementation.md");
    const result = await readAndParseStory(filePath);

    expect(result.status).toBe("done");
    expect(result.hasReviewSection).toBe(false);

    expect(deriveState(result)).toBe(ForemanState.Complete);
  });

  it("parses 5-3-auto-commit-after-review-approval.md with Review Follow-ups", async () => {
    const filePath = path.join(EXAMPLES_DIR, "5-3-auto-commit-after-review-approval.md");
    const result = await readAndParseStory(filePath);

    expect(result.status).toBe("done");
    expect(result.hasReviewSection).toBe(false);
    expect(result.hasUnresolvedItems).toBe(false);

    expect(deriveState(result)).toBe(ForemanState.Complete);
  });
});
