# Workflow node chrome cleanup

## Goal

Clean up noisy workflow node chrome: hide developer-only status/id text, restrict edit button to writable nodes, and keep stage entry behavior.

## Requirements

- Scope is limited to the workflow node card chrome in the Studio production graph.
- Keep functional navigation: each node still needs a visible stage entry action.
- Keep editing only where the node editor can write back real FlowData: script, director plan, and storyboard table.
- Hide developer-facing text from the node title area, including raw node ids such as `storyboardTable`.
- Do not show a green `READY` chip for completed nodes; only show a status chip when attention is needed.
- Completed nodes should avoid repeated explanatory helper copy; keep counts as quiet text, not pill-shaped pseudo-buttons.
- Do not change workflow persistence, node model ids, image workflows, Daojie generation data, or packaging/install behavior.

## Acceptance Criteria

- [x] Raw workflow node id text is not rendered under the node title.
- [x] Ready nodes no longer render `READY` / `TODO` chrome in the title action area.
- [x] The edit button is rendered only for `script`, `scriptPlan`, and `storyboardTable` nodes.
- [x] The stage entry button remains available.
- [x] Metrics such as `1 份分镜表` render as quiet text rather than button-like pills.
- [x] Ready nodes do not repeat the node description under the title.
- [x] Focused workflow UI tests pass.
- [x] Typecheck passes.
- [x] Lint passes.

## Notes

- This task is intentionally PRD-only because it changes a single frontend component and one regression test.
- No package/install step is included.
