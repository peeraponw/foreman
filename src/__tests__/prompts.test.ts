import { describe, it, expect } from "bun:test";
import { buildDeveloperPrompt } from "../prompts/developer";
import { buildReviewerPrompt } from "../prompts/reviewer";
import { buildArbiterPrompt } from "../prompts/arbiter";

describe("buildDeveloperPrompt", () => {
  it("contains /bmad:bmm:dev-story command and story path", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildDeveloperPrompt(storyPath, false);

    expect(prompt).toContain("/bmad:bmm:dev-story");
    expect(prompt).toContain(storyPath);
  });

  it("for follow-up mentions action items", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildDeveloperPrompt(storyPath, true);

    expect(prompt).toContain("action items");
  });

  it("for initial (not follow-up) does not mention action items", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildDeveloperPrompt(storyPath, false);

    expect(prompt).not.toContain("action items");
  });
});

describe("buildReviewerPrompt", () => {
  it("contains /bmad:bmm:code-review command and story path", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildReviewerPrompt(storyPath);

    expect(prompt).toContain("/bmad:bmm:code-review");
    expect(prompt).toContain(storyPath);
  });

  it("mentions selecting option 2 for action items", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildReviewerPrompt(storyPath);

    expect(prompt).toContain("2");
    expect(prompt).toContain("action items");
  });
});

describe("buildArbiterPrompt", () => {
  it("contains story path", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildArbiterPrompt(storyPath, [], 1, 3);

    expect(prompt).toContain(storyPath);
  });

  it("contains all context file paths", () => {
    const storyPath = "/stories/my-feature.md";
    const contextFiles = ["/docs/architecture.md", "/epics/auth.md"];
    const prompt = buildArbiterPrompt(storyPath, contextFiles, 1, 3);

    expect(prompt).toContain("/docs/architecture.md");
    expect(prompt).toContain("/epics/auth.md");
  });

  it("contains iteration number and max iterations", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildArbiterPrompt(storyPath, [], 2, 5);

    expect(prompt).toContain("2");
    expect(prompt).toContain("5");
  });

  it("contains PASS and NEEDS_WORK response options", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildArbiterPrompt(storyPath, [], 1, 3);

    expect(prompt).toContain("PASS");
    expect(prompt).toContain("NEEDS_WORK");
  });

  it("does not contain any BMAD commands", () => {
    const storyPath = "/stories/my-feature.md";
    const prompt = buildArbiterPrompt(storyPath, [], 1, 3);

    expect(prompt).not.toContain("/bmad:bmm");
  });
});
