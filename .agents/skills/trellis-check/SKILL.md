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
  grep -r "pattern" src/
  ```
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
