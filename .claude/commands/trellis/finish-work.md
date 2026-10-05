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
  > "Working tree has uncommitted code changes from this task: `<list>`. Return to workflow Phase 3.4 to commit them before running `/trellis:finish-work`."

  Do NOT run `git commit` here. Do NOT prompt the user to commit. The user goes back to Phase 3.4 and the AI drives the batched commit there.
- **All remaining paths look unrelated** (other parallel-window work) — report them once and continue to Step 3:
  > "FYI, dirty files outside this task's scope — leaving them for the other window: `<list>`."
- **Genuinely unsure** — ask the user once: "Are `<list>` this task's work I forgot to commit, or another window's? (commit / ignore)" — then route per their answer.

## Step 2.7: Campaign closeout gate(战役清账门,2026-10-05 用户裁定)

Applies when the task being archived was executed via dynamic-workflow runs(战役型任务). Full rules in `.claude/CLAUDE.md` 铁律 8. Before `task.py archive`:

0. **C1 机检先行**:`python3 apps/build/scripts/campaign_closeout_audit.py --task <task-name>` —— exit 2(任何红)= no archive,须清账后复跑;warn 项=候令/候窗,须在四标清单中写明等谁的令/什么窗。输出(--json 同步留档)写进任务档 `research/archive_precheck_<YYYYMMDD>.md` 作 C1 证据。
1. **Run 终态核验**:`ListWorkflowRuns` —— 本战役全部 run 须已终态;被停且仍有在飞步骤的 run ≤24h 须 `ResumeWorkflowRun` 续跑或把剩余步转记进任务档,不许带活归档。
2. **notCovered 接力核对**:最后一条 run 的 notCovered 清单逐项有着落——`done / 候令 / 候窗 / 归档于X` 四类之一;悬空项=欠账,**欠账非零不得归档**。
3. **四标清单落档**:收官四标(done/候令/候窗/欠账)清单写进任务档,不只留在会话报告散文里。
4. **清账四查②③④**:git 账面 M/未 push 归零或写明归属、/tmp 易失证据已回收、自起引擎/App 已 pgrep 验死。

## Step 3: Archive task(s)

```bash
python3 ./.trellis/scripts/task.py archive <task-name>
```

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
