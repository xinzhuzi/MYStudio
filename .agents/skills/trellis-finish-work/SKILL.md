---
name: trellis-finish-work
description: "Wrap up the current session: verify quality gate passed, remind user to commit, archive completed tasks, and record session progress to the developer journal. Use when done coding and ready to end the session."
---

# Finish Work

Wrap up the current session: archive the active task (and any other completed-but-unarchived tasks the user wants to clean up) and record the session journal. Code commits are NOT done here — those happen in workflow Phase 3.4 before you invoke this command.

## Step 1: Survey current state

```bash
python3 ./.trellis/scripts/get_context.py --mode record
```

This prints:

- **My active tasks** — review whether any besides the current one are actually done (code merged, AC met) and should be archived this round.
- **Git status** — quick visual on what's dirty.
- **Recent commits** — you'll need their hashes in Step 4 for `--commit`.

If `--mode record` surfaces other completed tasks not tied to the current session, surface them to the user with a one-shot confirmation: "These N tasks look done — archive them too in this round? [y/N]". Default is no; the current active task is always archived in Step 3 regardless.

## Step 2: Sanity check — classify dirty paths

Run:

```bash
git status --porcelain
```

Filter out paths under `.trellis/workspace/` and `.trellis/tasks/` — those are managed by `add_session.py` and `task.py archive` auto-commits and will appear dirty as part of this skill's own work.

For each remaining dirty path, decide whether it belongs to **the current task** or to **other parallel work** (e.g., another terminal window editing the same repo). Heuristics:

- Paths referenced in the current task's `prd.md` / `implement.jsonl` / `check.jsonl` → current task
- Paths in code areas matching the task's stated scope, or that you remember editing this session → current task
- Paths in unrelated areas you have no recollection of touching this session → other parallel work

Then route:

- **Any remaining path looks like current-task work** — bail out with:
  > "Working tree has uncommitted code changes from this task: `<list>`. Return to workflow Phase 3.4 to commit them before running ``finish-work` (Trellis command)`."

  Do NOT run `git commit` here. Do NOT prompt the user to commit. The user goes back to Phase 3.4 and the AI drives the batched commit there.
- **All remaining paths look unrelated** (other parallel-window work) — report them once and continue to Step 3:
  > "FYI, dirty files outside this task's scope — leaving them for the other window: `<list>`."
- **Genuinely unsure** — ask the user once: "Are `<list>` this task's work I forgot to commit, or another window's? (commit / ignore)" — then route per their answer.

## Step 2.5: Multi-AI archive precheck

Before archiving ANY task, run the A1–A5 checklist from `.trellis/spec/guides/multi-agent-task-archive-gate-guide.md` (MYSTUDIO port 2026-08-31):

- **A1 sibling tasks**: `task.py list` — same-parent or same-domain `in_progress`/`planning` tasks sharing artifacts or dependencies → refuse archive, report them by name.
- **A2 dirty hunks**: `git status --porcelain` — hunks outside this task's scope with unknown ownership (parallel-session WIP) → report and leave untouched; never sweep them into this task's commits.
- **A3 artifact mtime**: this task's files written by another session in the recent window → not quiescent.
- **A4 commit completeness**: this task's outputs are committed (path-scoped) before archive.
- **A5 AC matrix**: every PRD acceptance criterion closed, or scope formally reduced / handed off.

Write evidence to the task's `research/archive_precheck_<YYYYMMDD>.md`. Any red = no archive, and do not offer archive as an option; report open items and parallel blockers instead.

## Step 3: Archive task(s)

```bash
python3 ./.trellis/scripts/task.py archive <task-name> --skip-branch-validation
```

(Flag is mandatory in this repo: 0.6.16 `create` defaults `base_branch=main` + remote present → branch validation refuses archive; tasks here are never PR-backed.)

At minimum: the current active task (if any). Plus any extra tasks the user confirmed in Step 1. Each archive produces a `chore(task): archive ...` commit via the script's auto-commit.

If there is no active task and the user did not confirm any cleanup archives, skip this step.

## Step 4: Record session journal

```bash
python3 ./.trellis/scripts/add_session.py \
  --title "Session Title" \
  --commit "hash1,hash2" \
  --summary "Brief summary"
```

Use the work-commit hashes produced in Phase 3.4 (visible in Step 1's `Recent commits` list, or via `git log --oneline`) for `--commit`. Do not include the archive commit hashes from Step 3. This produces a `chore: record journal` commit.

Final git log order: `<work commits from 3.4>` → `chore(task): archive ...` (one or more) → `chore: record journal`.

<!-- MYSTUDIO-FUSION: superpowers (finishing-a-development-branch), 2026-08-31 -->

## Integration Decision Discipline

- **Verify on the tree you are about to integrate, now.** "Tests passed earlier this session" is not evidence — a green run only proves the tree it ran on. Before archiving a task whose AC include checks, those checks must have been run after the last code change.
- **The integration decision belongs to the user.** Archive / keep-open / extra cleanup are presented as options and waited on — never assumed from enthusiasm, silence, or "they obviously want it done". Discarding work happens only on an explicit request, confirmed in so many words.
- **Known rationalizations — treat each as a stop sign**:

| Rationalization | Reality |
|---|---|
| "Tests passed earlier this session" | Re-run on the final tree; earlier green proves nothing now |
| "They obviously want it archived" | Present the state and wait for the explicit choice |
| "This other dirty area looks stale — I'll clean it too" | Only what Step 2 classified as this task's; everything else gets reported, not touched |
| "Unsure whether a dirty path is mine — commit it to be safe" | Ask once (Step 2), then route by the answer; committing another window's WIP corrupts both |
