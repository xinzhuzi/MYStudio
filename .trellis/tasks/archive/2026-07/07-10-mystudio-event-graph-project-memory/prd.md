# MYStudio event graph and project memory

## Goal

Upgrade chapter event summaries into project-scoped event graph and controlled project memory/RAG with cleanup and privacy boundaries.

## Requirements

- Convert chapter-level event summaries into a project-scoped event graph with event IDs, chapter links, entities, timeline order, and retrieval metadata.
- Provide bounded context retrieval for script and production stages instead of broad unscoped memory scans.
- Add short-term run memory and summary memory with project/episode isolation.
- Make semantic recall optional and cleanable; do not require Toonflow's exact ONNX/vector implementation.
- Provide clear disable, purge, and export boundaries for privacy and project portability.

## Acceptance Criteria

- [x] Script generation can request relevant event context by episode/chapter scope.
- [x] Production planning can retrieve role, scene, and prior episode context without reading unrelated projects.
- [x] Memory records are project-scoped and removable through a tested cleanup path.
- [x] Tests cover event graph construction, scoped retrieval, and cleanup.
- [x] Documentation states what is stored, where, and how to disable it.

## Notes

- Complex task. Add `design.md` and `implement.md` before starting.
