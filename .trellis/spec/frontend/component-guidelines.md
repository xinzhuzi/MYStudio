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
