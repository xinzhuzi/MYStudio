---
name: trellis-check
description: "Comprehensive quality verification: spec compliance, lint, type-check, tests, cross-layer data flow, code reuse, and consistency checks. Use when code is written and needs quality verification, before committing changes, or to catch context drift during long sessions."
---

# Code Quality Check

Comprehensive quality verification for recently written code. Combines spec compliance, cross-layer safety, and pre-commit checks.

<!-- MYSTUDIO-FUSION: superpowers (verification-before-completion + receiving-code-review), 2026-08-31 -->

## Fresh Verification Gate

**No completion claims without fresh verification evidence.** If you haven't run the verification command in this turn, you cannot claim it passes.

Before reporting any Step 3 / Step 4 result as green:

1. Run the FULL command fresh — no `cmd | tail` (it swallows the exit code), no reuse of a previous run's output.
2. Read the complete output and the exit code; count the failures yourself.
3. When a run produces a report file (e.g., smoke), the report JSON's `ok` field is the verdict — not the console tail, not a progress line.
4. Subagent / channel-worker reports of "success" are claims, not evidence. Verify against the actual diff or output before repeating them.

Red flags that mean STOP and run the command instead: "should pass", "probably fine", "passed earlier this session", "the worker said it's done", "just this once".

## Review Feedback Evidence Gate

Every CRITICAL / WARNING / Important finding from a reviewer (human, subagent, or tool) must be verified at the original `file:line` before it is acted on or reported as fixed. A reviewer summary is not a fact source.

- Verify the claim against the codebase before implementing. If it conflicts with how this repo actually works, push back with technical reasoning instead of complying.
- If any item in a multi-item review is unclear, clarify ALL unclear items before implementing ANY — items may be related; partial understanding produces wrong implementation.
- No performative agreement ("you're absolutely right", "great catch"). State the fix and show it in the code.
- YAGNI check: when a reviewer asks to "implement X properly", grep for actual usage first — unused surface gets removed, not hardened.

---

## Step 1: Identify What Changed

```bash
git diff --name-only HEAD
git status
```

## Step 2: Read Task Artifacts and Applicable Specs

Read the current task artifacts in order:

- `prd.md`
- `design.md` if present
- `implement.md` if present

```bash
python3 ./.trellis/scripts/get_context.py --mode packages
```

For each changed package/layer, read the spec index and follow its **Quality Check** section:

```bash
cat .trellis/spec/<package>/<layer>/index.md
```

Read the specific guideline files referenced — the index is a pointer, not the goal.

## Step 3: Run Project Checks

Run the project's lint, type-check, and test commands. Fix any failures before proceeding.

## Step 4: Review Against Checklist

### Code Quality

- [ ] Linter passes?
- [ ] Type checker passes (if applicable)?
- [ ] Tests pass?
- [ ] No debug logging left in?
- [ ] No suppressed warnings or type-safety bypasses?

### Test Coverage

- [ ] New function → unit test added?
- [ ] Bug fix → regression test added?
- [ ] Changed behavior → existing tests updated?

### Spec Sync

- [ ] Does `.trellis/spec/` need updates? (new patterns, conventions, lessons learned)

> "If I fixed a bug or discovered something non-obvious, should I document it so future me won't hit the same issue?" → If YES, update the relevant spec doc.

### Scope Discipline

- [ ] Any tidying of code the task did not require?
- [ ] Any abstraction, config or extension point added for a case that does not exist yet?
- [ ] Any speculative fallback for a state that cannot occur?
- [ ] Any file changed that the acceptance criteria do not mention?
- [ ] Any workaround added at the caller instead of a fix where the behavior actually lives?

## Step 5: Cross-Layer Dimensions (if applicable)

Skip this step if your change is confined to a single layer.

### A. Data Flow (changes touch 3+ layers)

- [ ] Read flow traces correctly: Storage → Service → API → UI
- [ ] Write flow traces correctly: UI → API → Service → Storage
- [ ] Types/schemas correctly passed between layers?
- [ ] Errors properly propagated to caller?

### B. Code Reuse (modifying constants, creating utilities)

- [ ] Searched for existing similar code before creating new?
  ```bash
  rg "pattern" <具体热路径>
  ```
  (禁 `grep -r`/`find . -name`/无路径 rg——搜索纪律见 `.claude/knowledge/search-sop.md`)
- [ ] If the same value repeats, does it represent one stable concept whose callers must change together? Extract only then — two literals that merely happen to match today should stay separate.
- [ ] After batch modification, all occurrences updated?

### C. Import/Dependency (creating new files)

- [ ] Correct import paths (relative vs absolute)?
- [ ] No circular dependencies?

### D. Same-Layer Consistency

- [ ] Other places using the same concept are consistent?

---

## Step 6: Report and Fix

Report every violation you find. Then:

- Mechanical and local (lint nit, missing type, wrong import, dead branch, failing assertion) → fix in place, then re-run project checks.
- Design or judgment (naming a shared concept, moving a module boundary, changing a public interface, reassigning where behavior lives) → record the evidence and your recommendation, and stop. Do not rewrite it silently.

If a fix would touch files outside the current task's scope, say so and stop instead of widening the change.

---

## 战役清账门(Campaign Closeout Gate,2026-10-05 用户裁定)

本节在「代码写完要验质量」之外补一道「战役要收官先清账」的门。适用:多阶段、跑 dynamic workflow、由任务档驱动的战役型任务;单文件快改不适用。规矩全文见 `.claude/CLAUDE.md` 铁律 8。

**机检入口(先跑再人工)**:`python3 apps/build/scripts/campaign_closeout_audit.py --task <任务目录名>`——exit 0=无红,exit 2=有红须清账后复跑;`--json` 供 workflow 收尾 phase 断言;`--evidence <临时取证路径>` 可反复传。下列人工项在机检之外补语义判断(四标是否属实、归账路径是否成立):

- [ ] **对拍任务档**:implement.md 全部 Phase 行逐行结清,每行打四标之一 `done / 候令 / 候窗 / 欠账`(候令须写明等谁的什么令;**欠账非零=不得称收官**,只能称阶段边界)
- [ ] **git 账面**:工作树 M 件数、未 push 笔数;非零则逐件写明归账路径(谁的役、随哪笔提交),不许「先放着」无主
- [ ] **易失证据回收**:/tmp 与本机临时位的取证文件(截图/日志/判读 JSON)已收回仓库或任务档——重启即丢的证据等于没取
- [ ] **资源收摊**:自起的引擎/App 进程已按「干完即停」铁律 pgrep 双口验死
- [ ] **台账随收**:implement.md checkbox 已随对应提交勾划;无「代码已提交、checkbox 全空」的账实分离
- [ ] **接力交代**:若开新 run 承接本战役,上一条 run 的 notCovered 已逐项显式接走或写明归档去向
