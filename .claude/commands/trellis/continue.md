# Continue Current Task

Resume work on the current task — pick up at the right phase/step in `.trellis/workflow.md`.

---

## Step 1: Load Current Context

```bash
python3 ./.trellis/scripts/get_context.py
```

Confirms: current task, git state, recent commits.

## Step 2: Load the Phase Index

```bash
python3 ./.trellis/scripts/get_context.py --mode phase
```

Shows the Phase Index (Plan / Execute / Finish) with routing + skill mapping.

## Step 3: Decide Where You Are

`get_context.py` shows the active task's `status` field. Route by `status` + artifact presence. This command replaces the user needing to remember the Trellis flow; it does not itself approve implementation.

- `status=planning` + no `prd.md` → **1.1** (load `trellis-brainstorm`)
- `status=planning` + `prd.md` only → decide whether the task is lightweight or complex. Lightweight can move to **1.4** review; complex returns to **1.1** to add `design.md` + `implement.md`.
- `status=planning` + complex artifacts complete + sub-agent jsonl not curated (empty, or only a legacy `_example` placeholder row) → **1.3**
- `status=planning` + required artifacts complete + required jsonl curated or inline mode → **1.4** (ask for start review; only run `task.py start` after user confirms)
- `status=in_progress` + implementation not started → **2.1**
- `status=in_progress` + implementation done, not yet checked → **2.2**
- `status=in_progress` + check passed → **3.3** (spec update) → **3.4** (commit)
- `status=completed` (rare; usually archived immediately) → archive flow

Phase rules (full detail in `.trellis/workflow.md`):

1. Run steps **in order** within a phase — `[required]` steps must not be skipped
2. `[once]` steps are already done if the required output exists. `prd.md` alone can be enough only for lightweight tasks; complex tasks also need `design.md` and `implement.md`.
3. You may go back to an earlier phase if discoveries require it

## Step 4: Load the Specific Step

Once you know which step to resume at:

```bash
python3 ./.trellis/scripts/get_context.py --mode phase --step <X.X> --platform claude
```

Follow the loaded instructions. After each `[required]` step completes, move to the next.

---

## 接手在途战役的第一动作(2026-10-05 用户裁定)

恢复一个跑过 dynamic workflow 的战役时,在挑 Phase/Step 之前先验「在途现场」。规矩全文见 `.claude/CLAUDE.md` 铁律 8:

1. `ListWorkflowRuns`:本战役 runs 逐条核状态——`running` 的看 last_progress 判生死(`possibly_interrupted` 标注须实查,不许凭标注判死);`stopped` 且有在飞步骤的,24 小时内必须 `ResumeWorkflowRun` 续跑或把剩余步转记进任务档,不许无限期挂起。机检快查:`python3 apps/build/scripts/campaign_closeout_audit.py`(不带 --task,秒级出 git 账面/易失证据/引擎残留三面)。
2. `pgrep` 引擎/App:上一场收没收摊(干完即停铁律);残留且无主=先处置再开工。
3. 读最后一条 run 的 notCovered 清单,逐项显式承接(接走或写明归档去向)——开新切片不接旧账=遗留重演。
4. run 属主会话仍在跑时,其脚本范围内的活不抢;只接它明确没装的部分。

---

## Reference

Full workflow and detailed phase steps live in `.trellis/workflow.md`. This command is only an entry point — the canonical guidance is there.
