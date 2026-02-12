/**
 * Builds a prompt for the Arbiter role.
 *
 * The Arbiter reads the story file and broader project context,
 * then judges whether the implementation satisfies acceptance criteria.
 * It does NOT run any BMAD commands.
 */
export function buildArbiterPrompt(
  storyPath: string,
  contextFiles: string[],
  iteration: number,
  maxIterations: number
): string {
  const contextSection =
    contextFiles.length > 0
      ? `\n\nContext files to review:\n${contextFiles.map((f) => `- ${f}`).join("\n")}`
      : "";

  return `Review the story file: ${storyPath}${contextSection}

Iteration: ${iteration} of ${maxIterations}

Your task is to judge whether the implementation satisfies the acceptance criteria.

Respond with one of:
- PASS: The implementation satisfies all acceptance criteria and any review action items are resolved.
- NEEDS_WORK: Further development is needed. The implementation does not yet meet the criteria.

Note: This is iteration ${iteration}. Consider diminishing returns when evaluating whether changes are truly necessary.`;
}
