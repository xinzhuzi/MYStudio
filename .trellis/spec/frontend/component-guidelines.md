# Component Guidelines

> How components are built in this project.

---

## Overview

<!--
Document your project's component conventions here.

Questions to answer:
- What component patterns do you use?
- How are props defined?
- How do you handle composition?
- What accessibility standards apply?
-->

Components are React 18 function components using named exports. UI composition
uses Tailwind CSS, Radix primitives, and the shared `cn()` helper. Domain work
should be delegated to stores, hooks, or `lib/` functions.

---

## Component Structure

<!-- Standard structure of a component file -->

- Import dependencies first, then define local prop types/constants, then export
  the component.
- Keep render branches readable; extract repeated or stateful behavior.
- Use existing UI primitives before adding a new visual pattern.

```tsx
type BrandMarkProps = { className?: string; alt?: string };

export function BrandMark({ className, alt = "漫影工作室" }: BrandMarkProps) {
  return <img className={cn("object-contain", className)} alt={alt} />;
}
```

---

## Props Conventions

<!-- How props should be defined and typed -->

- Type props explicitly; use optional props only when the component has a safe
  default.
- Prefer callback names beginning with `on` and boolean names beginning with
  `is`, `has`, `can`, or `should`.
- Do not pass raw IPC payloads through component trees; normalize them first.

### Artifact detail panel — tags stay read-only

`ArtifactDetailPanel` (`components/panels/media/artifact-detail/index.tsx`)
edits only safe metadata: `name` and `notes`. Tags, state, physical path,
dependencies, and generated content are read-only in the UI; content editing
happens via "go to owning workflow", the single edit entry point.

The `onMetadataUpdate` contract reflects this exactly:

```tsx
onMetadataUpdate?: (
  artifactId: string,
  updates: { name?: string; notes?: string }
) => Promise<void>;
```

Do **not** re-add `tags?: string[]` to this type. The backend still accepts
tags, but the UI deliberately does not expose tag editing — widening the type
re-introduces a "lying type" (a field the UI never sends). If tag editing is
needed, update the PRD (`R3`) first, then widen the contract end-to-end
(panel props → `handleMetadataUpdate` → `ArtifactCenter.handleMetadataUpdate`)
in one change.

### List keys for physical refs

When rendering `physicalRefs`, use a semantic key, never an array index. The
dedup identity used by `artifact-inventory-service` is `${ref.type}:${ref.path}`
— reuse it as the React `key`. `ref.type` is a non-empty literal union and
`ref.path` is unique per ref, so the composite is stable across re-orders:

```tsx
{refs.map((ref) => (
  <div key={`${ref.type}:${ref.path}`} ...>
))}
```

Array-index keys (`key={idx}`) break state/animation continuity when refs are
re-ordered or filtered.

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

- Use Tailwind utility classes and `cn()` for conditional composition.
- Preserve the existing dark visual system and Radix interaction behavior.
- Reuse shared component variants instead of duplicating long class strings.
- Keep layout responsive and avoid fixed dimensions unless the workflow canvas
  or media aspect ratio requires them.

### Fixed-height CodeMirror editors

When `@uiw/react-codemirror` is placed in a fixed-height flex dialog, setting
`height="100%"` alone does not guarantee vertical scrolling: the bundled
`.cm-scroller` style only establishes horizontal overflow. Add a stable editor
theme that explicitly enables vertical overflow, give the CodeMirror wrapper a
definite `h-full` height, and keep the parent at `min-h-0`:

```tsx
const editorScrollTheme = EditorView.theme({
  ".cm-scroller": { overflowY: "auto" },
});

<div className="min-h-0 flex-1 overflow-hidden">
  <CodeMirror className="h-full" height="100%" extensions={[editorScrollTheme]} />
</div>;
```

This keeps the dialog header and footer fixed while the editor content scrolls.

### Read-only structured viewers (JsonViewer)

For read-only structured values (arrays/objects such as `tags` or a full
`PhysicalRef`), reuse `components/panels/media/artifact-detail/json-viewer.tsx`
instead of a plain `<pre>`. It is built on the project's CodeMirror stack
(`@uiw/react-codemirror` + `@codemirror/lang-json`) with `readOnly` +
`editable={false}`, and mirrors the `RefPreview` scroll theme.

Two CodeMirror behaviors must be preserved when extending it:

- **Cap height via the `maxHeight` prop, not CSS.** A wrapper `max-height` is a
  no-op for CodeMirror — the `.cm-editor` keeps growing. Pass `maxHeight="12rem"`
  to `CodeMirror`, which correctly caps the editor and enables internal
  scrolling.
- **Disable interactive editor affordances.** Keep `foldGutter: false`,
  `highlightActiveLineGutter: false`, and `highlightActiveLine: false` in
  `basicSetup` — this is a viewer, not an editor; fold gutters and active-line
  highlights mislead users into thinking the value is editable.

```tsx
<JsonViewer value={tags} maxHeight="12rem" />
```

### Canonical JSON editor save boundary

When a node editor is in canonical JSON mode, a failed JSON validation must
return before any Markdown parser fallback. Markdown writeback is reserved for
the non-JSON node editor path; otherwise invalid JSON can be silently converted
into a different source format and persisted.

```tsx
const jsonResult = validateStoryboardJson(draft, episodeId, projectId);
if (!jsonResult.items && jsonMode === "canonical") {
  toast.error(jsonResult.error ?? "JSON 格式无效");
  return;
}
```

Keep a regression test that supplies Markdown accepted by the fallback parser
while canonical mode is active, and assert that no writeback occurs.

### Performance-sensitive viewport interactions

Heavy React Flow nodes must not use React state for a per-gesture decorative
class. Toggle the class on the canvas root through a ref in `onMoveStart` and
`onMoveEnd`, so the first wheel event does not re-render every preview subtree.
Automatic fit operations scheduled after node measurement should use an
immediate viewport update (`duration: 0`); explicit user-triggered fit and zoom
controls may retain their smooth animation.

Production workflow canvases use one opaque background on the non-transformed
canvas container. Do not mount React Flow `<Background>` patterns, animated
gradients, blur, or heavy glow effects inside the transformed viewport. Keep
zoom, fit, and percentage controls in a fixed overlay outside that viewport.

Every delayed measurement/layout fit must be cancelable. Store scheduled
`requestAnimationFrame` ids, cancel superseded callbacks, and invalidate all
pending automatic fits as soon as the user pans or zooms. A focus return or
resize may refresh measurements, but it must preserve a user-owned viewport;
only an explicit fit command may replace it.

```tsx
const canvasRef = useRef<HTMLElement | null>(null);
const onMoveStart = useCallback(() => {
  canvasRef.current?.classList.add("workflow-node-canvas-interacting");
}, []);
const onMoveEnd = useCallback(() => {
  canvasRef.current?.classList.remove("workflow-node-canvas-interacting");
}, []);
```

---

## Accessibility

<!-- A11y requirements and patterns -->

- Interactive controls need an accessible name and correct semantic element.
- Images require meaningful `alt` text or empty alt text when decorative.
- Dialogs, menus, and tooltips should use the existing Radix primitives.
- Keyboard focus must remain visible and usable in the desktop renderer.

---

## Common Mistakes

<!-- Component-related mistakes your team has made -->

- Putting persistence, filesystem, or provider orchestration inside JSX.
- Adding a new button style when a shared variant already exists.
- Using a clickable `div` without keyboard and accessibility behavior.
- Reading untyped `window` bridge fields directly in many components.
