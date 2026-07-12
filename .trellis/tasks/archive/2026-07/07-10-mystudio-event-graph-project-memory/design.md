# MYStudio event graph and project memory design

## Scope

This child task turns chapter event analysis into project-scoped memory records that can be retrieved by script and production stages. It does not introduce a vector database or copy Toonflow's ONNX/vector implementation.

## Data model

Project memory is persisted inside the existing project-scoped Studio workflow store:

```text
_p/{projectId}/studio-workflow-store
  -> eventGraph[]
  -> projectMemoryRecords[]
```

Each record includes:

- stable `id`
- `projectId`
- `episodeId`
- chapter index/title
- event summary, mainline relation, information density, duration, emotions
- extracted entities
- timeline order
- retrieval text
- created/updated timestamps

## Retrieval contract

Retrieval is deterministic and bounded:

- filter by project id;
- optionally filter by episode id;
- rank exact episode matches first;
- then rank prior timeline order and entity matches;
- return a compact markdown block, not raw full chapters.

## Cleanup contract

Cleanup must be explicit and project scoped:

- remove by project id;

## Integration points

- `buildStageMessages` accepts `projectMemoryContext` and injects it into script generation.
- `useProductionPlanningActions` appends scoped project memory into director planning `manualContext`.
- Store actions create/update memory from already analyzed `NovelChapter` records and retrieve/clean memory.

## Non-goals

- No cross-project memory scans.
- No semantic vector dependency.
- No hidden persistence outside the project workflow store.
