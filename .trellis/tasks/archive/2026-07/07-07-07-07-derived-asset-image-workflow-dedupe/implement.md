# Implementation Plan

1. Read task artifacts and relevant Trellis specs before code edits.
2. Read Toonflow audit notes and the Daojie visual skill/manual files needed for prompt language.
3. Inspect current graph creation/repair, canvas rendering, derived asset task construction, and orchestrator prompt construction.
4. Add the smallest implementation changes:
   - normalized local image URL comparison and duplicate reference collapse
   - generated-node prompt editor suppression when a linked prompt node exists
   - character-only three-view derived-asset prompt contract
5. Add focused regression tests for each change.
6. Run focused tests from `apps/`.
7. Run full validation from `apps/`: `npm run typecheck`, `npm run lint`, `npm test`.
8. Build and install:
   - `npm run build:mac`
   - `npm run smoke:desktop`
   - overwrite `/Applications/漫影工作室.app`
   - compare packaged and installed `app.asar` hashes
   - installed smoke using `/Applications/漫影工作室.app/Contents/MacOS/漫影工作室`
9. Run real Daojie visible workflow runner and inspect the resulting report/screenshots or image evidence.
10. Report only fresh evidence. If real image generation was not run, state that explicitly.
