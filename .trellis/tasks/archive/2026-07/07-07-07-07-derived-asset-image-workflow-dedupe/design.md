# Technical Design

## Scope

This task touches only the derived-asset image workflow graph, the image workflow canvas rendering, and the derived-asset prompt construction path.

Relevant source areas:

- `apps/frontend/lib/studio/image-workflow.ts`
- `apps/frontend/components/panels/studio/ImageWorkflowCanvas.tsx`
- `apps/frontend/components/panels/studio/useProductionPlanningActions.ts`
- `apps/frontend/lib/studio/asset-generation-orchestrator.ts`
- focused tests beside those modules

## Graph Contract

- Normalize image references before comparing nodes. Local `file://` URLs and absolute paths that point to the same file must compare equal.
- When repairing an existing graph, collapse duplicate reference nodes for the same normalized source image and retarget edges to the kept node.
- Preserve non-equivalent reference nodes.

## UI Contract

- The prompt node owns full prompt editing when it is linked to the generated node.
- The generated node owns output preview, writeback target, status, and run/writeback controls.
- Legacy graphs without a prompt node can still show the fallback prompt editor until the graph is repaired.

## Character Generation Contract

- Character derived assets use explicit three-view / reference-sheet prompt language: front, side, and back views, consistent identity, clothing, face, and proportions.
- Scene and prop derived assets retain single-image prompts.
- Daojie style anchors are sourced from existing project style/manual logic; no Daojie content is embedded into the app bundle.

## Verification Strategy

- Add regression tests for path normalization, UI duplicate editor suppression, and character-only three-view prompt construction.
- Inspect generated/smoke image evidence after the installed app runner completes.
- Do not claim real model generation unless a real generation command creates a new image and that image is visually inspected.
