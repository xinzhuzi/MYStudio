# Design

## Boundary

This task changes only the Daojie chapter-001 image prompt path and its validation:

- `Library/build_daojie_chapter001_workflow.py`
- `apps/build/automate-daojie-chapter001-video.mjs`
- `apps/frontend/config/build-scripts.test.ts`
- `apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/*`

It does not change the persistent studio workflow schema, package build scripts, global image workflow UI, or other chapters.

## Data Flow

Storyboard source data provides a scene, a visual description, asset names, and existing metadata such as emotion. The generation script resolves those names to asset catalog entries and image paths, builds a reference list, then creates the final image workflow graph with the generated-node prompt.

The new owner for prompt integrity is the Python generation script:

1. Resolve image assets and reference order.
2. Build an alias map from asset names, source names, and known role aliases.
3. Replace asset mentions inside `【画面】` with their `@图N` markers.
4. Derive a compact `【光影】` section from scene/emotion.
5. Audit the final prompt and record one manifest row per storyboard.
6. Emit aggregate counts into the automation report.

The Node wrapper consumes only those report fields and fails when a required count is not equal to the storyboard count or when missing/leak arrays are non-empty.

## Prompt Contract

Final storyboard image prompts use this order:

```text
@图1 为...；@图2 为...
【画面】...
【光影】...
【参考图规则】...
【风格锁】...
【可变化项】...
【反向约束】...
保持所有@图N造型、结构与参考图一致。
```

`【画面】` is the information-dense section and must keep the original visual description after replacing referenced names. `【风格锁】` preserves Daojie's ink-guofeng style. `【反向约束】` blocks photorealistic, 3D, cel-shaded, modern, and western-fantasy drift.

## Validation Contract

Each storyboard prompt manifest row records:

- storyboard id/index
- reference labels and asset names
- visible role names found in the visual description
- missing visible role references
- raw asset name leaks from the `【画面】` section
- booleans for reference prefix, light section, Daojie style lock, reference rules, and negative constraints
- final prompt

Aggregate report fields count successful rows and list failures. The wrapper treats these fields as the source of truth instead of re-parsing prompt internals independently.
