# MYStudio Toonflow fixture and final parity verification

## Goal

Add read-only Toonflow fixture mapping, golden structure/image comparison, and layered verification from unit tests to real Daojie media generation.

## Requirements

- Build a read-only Toonflow fixture import/mapping for EP01 fields needed by MYStudio parity checks.
- Compare Toonflow `o_storyboard`, asset reference order, image paths, and generated media structure against MYStudio projections.
- Add golden structure comparison first; add image comparison only after paths and fixture ownership are stable.
- Keep the current Daojie `chapter-001` fixture data separate from Toonflow original fixture data.
- Treat `43` as the current Daojie `chapter-001` fixture fact only; generation and smoke validation must derive the expected storyboard count from the selected episode/director-plan source segments or the cloned source project, not from a global constant.
- Define layered verification: unit -> typecheck/lint -> full tests -> packaged smoke -> visible smoke -> real Daojie runner -> explicitly authorized real media generation.

## Acceptance Criteria

- [x] A read-only fixture or fixture adapter can produce deterministic storyboard/reference expectations.
- [x] The report flags mismatches between Toonflow original rows and MYStudio canonical/generated rows.
- [x] Golden image comparison has a clear threshold and failure report, or is explicitly deferred with fixture blockers.
- [x] Validation output names exactly which layer was run and which was not run.
- [x] No real media generation is claimed unless `npm run video:daojie:chapter001` is freshly executed.

## Notes

- Complex task. Add `design.md` and `implement.md` before starting.
