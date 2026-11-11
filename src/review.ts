// Reviews, in one form. Whether a review is asked for by you (Review changes…, on a finished
// answer) or by the Quartermaster (with "review changes before reporting" on), the reviewer is
// told to end with its findings in the same fenced block, which the page shows as a list you
// can act on. The briefs live here, so the page, the crew and the tests agree on the wording.

// How a reviewer ends its answer. (ui/src/feed/Findings.tsx reads this block.)
export const FINDINGS_FORMAT =
  "End your answer with the findings as a fenced block, exactly in this form (an empty list if there are none):\n" +
  "```findings\n[{\"severity\": \"blocker\", \"file\": \"src/app.ts\", \"line\": 42, \"title\": \"One line saying what's wrong\", \"detail\": \"Why, and what to do instead\"}]\n```\n" +
  "severity is \"blocker\" (must be fixed), \"should\" (ought to be), or \"nit\" (small). file is the path as you read it; leave line out if it isn't about one place.";

// What a review looks for, said the same way wherever one is asked for.
export const REVIEW_SCOPE =
  "Read the actual diff (git diff, and the code around it), not the report of it. " +
  "Look for bugs, anything the request asked for that's missing, changes that go beyond the request, and tests that were weakened or skipped. No style notes, no praise.";

// Someone stepping into a conversation for one turn (/api/send with { aside: true, brief }).
export const ASIDE_BRIEFS = {
  opinion:
    "Give me a second opinion on the last answer above. Check the same code and sources yourself rather than taking its word. " +
    "Say where you agree, where it's wrong or not backed up, and what it missed: most important first, with the file and line where you can. Don't change any files.",
  review: `Review the changes made above. ${REVIEW_SCOPE} Don't change any files.\n\n${FINDINGS_FORMAT}`,
} as const;
export type AsideBrief = keyof typeof ASIDE_BRIEFS;
export const isAsideBrief = (v: unknown): v is AsideBrief => v === "opinion" || v === "review";
