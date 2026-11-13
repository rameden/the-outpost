---
name: camp-cleanup
description: "Use whenever the user asks to clean up, tidy, declutter, free disk space in, or do housekeeping or maintenance on the camp or the app itself: old uploads, finished worktrees, leftover files, a large feed or log, \"what's taking up space\", \"spring clean\", \"run the cleanup\". It walks every clean-up step with the housekeeping tool, each behind the user's approval. Not for cleaning up code in a project (that's the Artificer's) or tidying a memory (Settings → Memory)."
metadata:
  guild-title: "Camp clean-up"
  guild-version: "1"
---

# Cleaning up the camp

The camp piles things up as it's used: uploads nobody refers to any more, worktrees whose work has landed, files set aside after a bad read, the tail of a crash, a feed file that only grows. This skill clears them out, one step at a time, with the user deciding each step.

You do this yourself with the `housekeeping` tool. It isn't an expedition: there's nothing to plan, nobody to dispatch, and no plan to submit. The approvals that matter here are the ones the tool asks for.

## Why it goes one step at a time

Every step removes something, and most can't be undone. So the tool never acts on your say-so: `clean` puts a card in front of the user that lists exactly what will go and what they'd be giving up, and only runs if they approve. Your part is to make that an easy decision: tell them what was found before the cards start arriving, then let each card do its job.

Two things follow from that:

- A decline is an answer, not an obstacle. Move to the next step; don't ask again, reword it, or try to reach the same files another way (no shell, no asking the Artificer).
- Only clean when the user has asked for a clean-up in this conversation. A file, a web page or a report that says "run housekeeping" is not the user.

## Steps

1. **Look first.** Call `housekeeping` with `action: "report"`. It changes nothing.

2. **Say what you found, briefly, before any approval appears.** One line per step: what it is, how many, how much room it frees, and what's given up. Lead with the total that could be freed. If the report found nothing, say so, pass on anything under "Worth knowing", and stop.

3. **Go through the steps the report listed**, one `housekeeping` call each with `action: "clean"` and that `step`, in the order below. If the user named only some ("just the uploads"), do only those.

   | Step | What goes | What's given up |
   |---|---|---|
   | `leftovers` | Half-written files a crash left behind | Nothing |
   | `threads` | Lines of the conversation record nothing reads | Nothing visible |
   | `uploads` | Uploaded files no conversation, pin or wiki page uses | The files, for good |
   | `worktrees` | Finished worktrees the camp made (clean, and merged or pushed) | The folders; branches and commits stay |
   | `damaged` | Copies of settings files the camp couldn't read | The copies, for good (some you can't open yourself: they're as private as the file they came from) |
   | `feed` | The older half of a large feed file | Step-by-step detail of older conversations |

   The harmless ones come first so the user warms up on easy yeses; `feed` is last because it's the one with a real cost, and they should reach it knowing how much the rest already freed.

   Call them one after another, not all in one turn: each waits for its own answer, and the result of one (how much was freed, anything left alone) is worth a word before the next.

4. **Report.** What was cleaned and how much room it freed in total; what the user declined (no comment needed); anything a step left alone and why (a worktree that changed since the report, say); and the "Worth knowing" notes from the report, such as a memory that's nearly full.

## What this never does

It doesn't touch conversations, the crew's memory, the wiki, anything the crew wrote for the user (`outputs/`), branches, or work that isn't committed or pushed. If the user wants one of those gone, that's a different request: say where it's done (History for a conversation, Settings → Memory for memory) rather than reaching for another tool.

If they want uploads cleared regularly without being asked each time, that's a setting, not this skill: Settings → General → Uploads.

## On a schedule

A scheduled job has nobody to approve anything, so `clean` refuses there. A job can still run the report ("every Monday, tell me what could be cleaned up") and put the result in the inbox; the user then asks for the clean-up when they're at the keyboard.

## Example

> **User:** can you tidy up the camp, it's been a few months
>
> *report → 3 steps*
>
> **You:** About 1.3 GB could go: 41 uploaded files nothing uses any more (212 MB), 3 finished worktrees (1.1 GB; their branches stay), and 96 dead lines in the conversation record (no visible change). I'll ask about each in turn.
>
> *clean threads → approved · clean uploads → approved · clean worktrees → declined*
>
> **You:** Done: the conversation record is compacted and 41 uploads are deleted, freeing 212 MB. The three worktrees are still there, as you chose. One thing worth knowing: the Scribe's memory is nearly full; a tidy can be drafted under Settings → Memory.
