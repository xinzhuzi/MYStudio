# Design

## Current Behavior

`WorkflowNodeCanvas.tsx` defines `LR_POSITIONS` as unrelated literal coordinates. Because nodes have different widths, the visible gaps between `script`, `scriptPlan`, `storyboardTable`, `storyboard`, and `workbench` are inconsistent. `workbench` is also vertically offset, so the final arrow bends visually away from the main chain.

## Proposed Behavior

- Keep the existing graph topology and React Flow component structure.
- Add local constants for production node widths and spacing:
  - `PRODUCTION_NODE_WIDTHS`
  - `PRODUCTION_LAYOUT_GUTTER`
  - `PRODUCTION_BRANCH_GUTTER`
  - shared main baseline
- Build `LR_POSITIONS` from these constants:
  - main chain nodes share the same `y`
  - each next x coordinate is previous x plus previous width plus one gutter
  - `assets` stays under `script` with one branch gutter
- Keep the top-bottom fallback layout, but use the same branch/main rhythm more explicitly.
- Keep theme tokens for edges and arrows; make the edge stroke more readable with a dedicated constant.

## Boundaries

- No model, storage, generation, image workflow, or project data changes.
- Existing node dragging remains enabled; this change only improves initial/auto layout.
