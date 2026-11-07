import type { FirstTestReview } from "./first-test.ts";
export interface ReviewIssue {
  field: keyof FirstTestReview | "review" | "reviewFile";
  message: string;
}
/** Only static field labels/reasons. Never attach input values, paths or causes. */
export class ReviewValidationError extends Error {
  readonly issues: readonly ReviewIssue[];
  constructor(issues: readonly ReviewIssue[]) {
    super("Offline cost review validation failed.");
    this.name = "ReviewValidationError";
    this.issues = issues;
  }
}
