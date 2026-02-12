/**
 * Builds a prompt for the Developer role.
 *
 * The Developer runs `/bmad:bmm:dev-story` to implement acceptance criteria.
 * If action items exist from a previous review, it addresses those first.
 */
export function buildDeveloperPrompt(storyPath: string, isFollowUp: boolean): string {
  const basePrompt = `Run /bmad:bmm:dev-story ${storyPath}

The workflow will ask interactive questions.
- Answer "y" to confirmations.
Do not wait for user input.`;

  if (isFollowUp) {
    return `${basePrompt}

NOTE: This is a follow-up iteration. Address any remaining action items from the review before proceeding with new work.`;
  }

  return basePrompt;
}
