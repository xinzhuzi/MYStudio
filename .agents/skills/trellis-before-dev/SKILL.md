---
name: trellis-before-dev
description: "Discovers and injects project-specific coding guidelines from .trellis/spec/ before implementation begins. Reads spec indexes, pre-development checklists, and shared thinking guides for the target package. Use when starting a new coding task, before writing any code, switching to a different package, or needing to refresh project conventions and standards."
---

Read the relevant development guidelines before starting your task.

Execute these steps:

1. **Read current task artifacts**:
   - `prd.md` for requirements and acceptance criteria
   - `design.md` if present for technical design
   - `implement.md` if present for execution order and validation plan

2. **Discover packages and their spec layers**:
   ```bash
   python3 ./.trellis/scripts/get_context.py --mode packages
   ```

3. **Identify which specs apply** to your task based on:
   - Which package you're modifying (e.g., `cli/`, `docs-site/`)
   - What type of work (backend, frontend, unit-test, docs, etc.)
   - Any spec/research paths referenced by the task artifacts

4. **Read the spec index** for each relevant module:
   ```bash
   cat .trellis/spec/<package>/<layer>/index.md
   ```
   Follow the **"Pre-Development Checklist"** section in the index.

5. **Read the specific guideline files** listed in the Pre-Development Checklist that are relevant to your task. The index is NOT the goal — it points you to the actual guideline files (e.g., `error-handling.md`, `conventions.md`, `mock-strategies.md`). Read those files to understand the coding standards and patterns.

6. **Always read shared guides**:
   ```bash
   cat .trellis/spec/guides/index.md
   ```

7. **Load discipline guides matched to the work** (from `.trellis/spec/guides/`, ported 2026-08-31):
   - Behavior change / bugfix / refactor → `development-quality-discipline-guide.md`
   - Complex multi-file task with design.md/implement.md → `implementation-planning-discipline-guide.md`
   - Parallel sub-agents / channel workers → `agent-execution-discipline-guide.md`
   - Session reporting / archive wording → `agent-user-reporting-discipline-guide.md` + `multi-agent-task-archive-gate-guide.md`

8. **For a non-trivial task, state the change boundary before writing code.** Non-trivial means it touches more than one file, crosses a layer, changes a public interface, or edits code you did not just write. Write down:
   - the smallest behavior gap between what happens now and what should happen
   - where that behavior actually lives (not where it is easiest to intercept)
   - which files you expect to change, and why each one is necessary
   - what you are explicitly not doing in this task
   - if a local refactor is needed, how you will show it did not change behavior

   A small, well-scoped change does not need this — do it directly.

   If the real scope turns out to be clearly larger than this, say so and why before continuing. Do not widen the change on your own.

9. Understand the coding standards and patterns you need to follow, then proceed with your development plan.

This step is **mandatory** before writing any code.

<!-- MYSTUDIO-FUSION: superpowers (executing-plans + subagent-driven-development rulings), 2026-08-31 -->

## Plan Execution Discipline (when an implement.md exists)

- **Review the plan critically before executing it.** Read it end to end first; if you see gaps, contradictions, or steps you don't understand, raise them before starting — a flawed plan executed faithfully produces flawed code. Fixing the plan silently mid-run is fine for trivial typos; for anything structural, say what changed.
- **Follow the steps exactly; never skip a verification step.** The plan's "run X, expect Y" steps are the contract. If the actual output diverges from the expected output, that divergence is information — stop and read it, don't steamroll past it.
- **Stop and ask instead of guessing** when: a dependency is missing, an instruction is genuinely ambiguous in a way that changes behavior, or a verification fails repeatedly (two failed fix attempts on the same step → escalate rather than attempt three).
- **Rulings, not stalls, for plan defects that don't change behavior**: scope-adjacent cleanup decisions, naming, ordering of independent steps — decide them, record the decision in the task notes (`Ruling: <decision> — <why>`), keep moving. A wrong ruling costs visible rework; a session parked on a trivial question costs the day.
