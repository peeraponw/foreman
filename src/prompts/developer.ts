/**
 * Builds a prompt for the Developer role.
 *
 * The Developer runs `/bmad:bmm:dev-story` to implement acceptance criteria.
 * If action items exist from a previous review, it addresses those first.
 */
export function buildDeveloperPrompt(storyPath: string, isFollowUp: boolean): string {
  const basePrompt = `Run /bmad:bmm:dev-story ${storyPath}

The workflow will ask interactive questions. Answer them immediately without pausing:
- For any yes/no or confirmation prompt: answer "y"
- For any numbered option list: answer with the number for the most appropriate action
- For any path-related question: the story path is ${storyPath}
- NEVER stop and wait for user input — always provide an answer immediately
Do not output questions directed at the user. Answer them yourself inline.`;

  if (isFollowUp) {
    return `${basePrompt}

NOTE: This is a follow-up iteration. Address any remaining action items from the review before proceeding with new work.`;
  }

  return basePrompt;
}
