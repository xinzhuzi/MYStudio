# Storyboard node Toonflow parity 43

## Goal

Make the MYStudio storyboard workflow node match the real project data and the Toonflow-style storyboard workflow contract. The real Daojie `chapter-001` project has 43 storyboard items; the UI must not make it look like only 12 exist.

## Requirements

- Fix the storyboard table node so it can display all parsed storyboard rows for the current chapter. It must not hard-cap the preview at 12 rows.
- Fix the storyboard panel node so it can expose all current-chapter storyboard image tiles. It must not hard-cap the preview at 24 tiles.
- Preserve the existing node layout and scrolling behavior: showing 43 rows or tiles must not stretch the workflow graph into an unreadable layout.
- Keep Toonflow-style storyboard semantics visible and testable: `videoDesc`, `prompt`, `track`, `duration`, `associateAssetsIds`, `shouldGenerateImage`, ordered references, image workflow id, media writeback state, and failure/skip state.
- Do not move image generation controls back onto the outside node. Storyboard image generation and writeback actions belong in the image workflow detail.
- Do not regenerate Daojie images or rebuild the MP4 for this task unless a verification step proves the data is actually incomplete.
- Do not use git or worktree operations.

## Acceptance Criteria

- [x] Real Daojie `chapter-001` store still has exactly 43 storyboards, 43 media refs, and 43 storyboard image workflows.
- [x] `buildProductionFlowModel()` returns 43 storyboard table rows when the source table has 43 rows.
- [x] `buildProductionFlowModel()` returns 43 storyboard tiles when the input has 43 storyboards.
- [x] `StoryboardTablePreview` and `StoryboardGridPreview` can render the full 43-item model inside their internal scroll containers.
- [x] Storyboard tile click still opens the corresponding image workflow context.
- [x] Focused tests cover the old 12/24 truncation regressions.
- [x] `npm run smoke:workflow:run:daojie` verifies the visible Daojie workflow against the real project clone, not an empty smoke template.
- [x] After tests pass, package and install with `npm run build:mac:install`.

## Notes

- Current evidence before implementation: real store path `/Users/zhengbingjin/Library/Application Support/漫影工作室/projects/_p/49dce4c1-64b1-42de-85c2-9f266698aec0/studio-workflow-store.json` has `chapter-001` storyboards = 43, media refs = 43, image workflow links = 43.
- Current suspected truncation points: `workflow-node-model.ts` limits storyboard table preview rows to 12 and storyboard tiles to 24.
