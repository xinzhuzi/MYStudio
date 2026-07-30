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

---

## Styling Patterns

<!-- How styles are applied (CSS modules, styled-components, Tailwind, etc.) -->

- Use Tailwind utility classes and `cn()` for conditional composition.
- Preserve the existing dark visual system and Radix interaction behavior.
- Reuse shared component variants instead of duplicating long class strings.
- Keep layout responsive and avoid fixed dimensions unless the workflow canvas
  or media aspect ratio requires them.

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
