/**
 * Builds a prompt for the Reviewer role.
 *
 * The Reviewer runs `/bmad:bmm:code-review` to verify implementation
 * against acceptance criteria and creates action items if issues are found.
 */
export function buildReviewerPrompt(storyPath: string): string {
  return `Run /bmad:bmm:code-review ${storyPath}

The workflow will ask interactive questions.
- First confirmation: answer "y"
- Second confirmation: answer "y"
- When asked to select action: answer "2" (create action items)
Do not wait for user input.`;
}
