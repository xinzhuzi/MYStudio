# Design

## Data Flow

The authoritative storyboard count comes from the current chapter-scoped `StoryboardsItem[]` passed into `buildProductionFlowModel()`. The model should sort by `index` and pass every item to the preview model. The preview components own visual scrolling; the model must not silently truncate the data.

For storyboard table rows, `parseStoryboardPreviewRows()` should parse all valid rows from `flowData.storyboardTable`. It can still fall back to markdown table parsing when the structured parser fails, but it must not cap the result to 12.

For storyboard tiles, `storyboardTiles` should include every current input storyboard sorted by `index`. Each tile must continue to carry the fields needed for image workflow opening: `id`, `index`, `mediaPath`, `title`, `lines`, `state`, `imageWorkflowId`, `imageWorkflowNodeId`, and `shouldGenerateImage`.

## UI Behavior

The table preview keeps its existing internal scroll container and sticky header. Rendering 43 rows should increase scrollable content, not node width or graph spacing.

The grid preview keeps its existing internal scroll container and tile click behavior. Rendering 43 tiles should show all tiles through vertical scrolling, and clicking either the image or entry button must open the storyboard image workflow for that tile.

## Toonflow Parity Boundary

This task fixes MYStudio node visibility and workflow access. It does not import Toonflow DB rows or replace Daojie canonical storyboard content. The contract absorbed here is: do not hide existing storyboard records, preserve ordered references and `shouldGenerateImage`, keep image generation/writeback in the image workflow detail, and verify against real Daojie `chapter-001`.

## Evidence

The real Daojie project currently proves that the data layer has 43 complete records. The implementation must make the UI/model reflect that fact and add tests so a future hard-coded preview cap cannot make the project look incomplete again.
