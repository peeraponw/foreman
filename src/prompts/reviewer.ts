/**
 * Builds a prompt for the Reviewer role.
 *
 * The Reviewer runs `/bmad:bmm:code-review` to verify implementation
 * against acceptance criteria and creates action items if issues are found.
 */
export function buildReviewerPrompt(storyPath: string): string {
  return `Run /bmad:bmm:code-review ${storyPath}

The workflow will ask interactive questions. Answer them immediately without pausing:
- First confirmation: answer "y"
- Second confirmation: answer "y"
- When asked to select an action (numbered list): answer "2" (create action items)
- For any other yes/no prompt: answer "y"
- NEVER stop and wait for user input — always provide an answer immediately
Do not output questions directed at the user. Answer them yourself inline.`;
}
