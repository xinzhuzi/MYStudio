# MYStudio workflow node layout clarity

## Goal

Make the production workflow node graph use deterministic equal spacing so nodes, arrows, and edge lines are readable.

## Requirements

- The production workflow graph must use deterministic layout constants instead of scattered hand-written coordinates.
- In left-to-right layout, the main chain nodes must share one baseline and use one fixed horizontal gutter after accounting for each node width.
- The script-to-assets branch must use a fixed vertical gutter and stay visually separated from the main chain.
- Workflow edge strokes and arrowheads must remain theme-aware, but be more readable than the current thin/low-contrast default.
- The change must not alter node ids, edge ids, workflow data contracts, image workflow data, project persistence, or generation behavior.

## Acceptance Criteria

- [x] `WorkflowNodeCanvas.tsx` exposes layout constants for node widths, horizontal gutter, branch gutter, and positions.
- [x] Source tests no longer lock the old uneven coordinate `assets: { x: 0, y: 660 }`.
- [x] Tests assert that `scriptPlan`, `storyboardTable`, `storyboard`, and `workbench` are placed from the shared horizontal gutter calculation.
- [x] Tests assert that edges use a clear production edge style and arrowhead color.
- [x] Focused workflow UI tests pass.

## Notes

- Scope is only the visible production workflow node graph.
- Do not package or install unless separately requested after implementation.
