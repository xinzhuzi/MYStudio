# Type Safety

> Type safety patterns in this project.

---

## Overview

<!--
Document your project's type safety conventions here.

Questions to answer:
- What type system do you use?
- How are types organized?
- What validation library do you use?
- How do you handle type inference?
-->

The renderer, Electron main/preload code, and tests use TypeScript with
`strict: true`, bundler module resolution, and the `@/` path alias. The current
configuration permits explicit `any`, but new boundary code should prefer
`unknown` plus narrowing.

---

## Type Organization

<!-- Where types are defined, shared types vs local types -->

- Shared domain and bridge contracts belong in `apps/frontend/types/`.
- Component-only props and small local state types stay beside the component.
- Use discriminated unions for success/failure and workflow status contracts.
- Import types with `import type` when no runtime value is required.

```ts
export type UpdateCheckResult =
  | { success: true; hasUpdate: boolean }
  | { success: false; error: string };
```

---

## Validation

<!-- Runtime validation patterns (Zod, Yup, io-ts, etc.) -->

Validate external provider responses, persisted legacy data, and IPC payloads
at their boundary. Reuse existing Zod schemas where present; otherwise use
explicit type guards and normalization functions. A TypeScript assertion alone
is not runtime validation.

---

## Common Patterns

<!-- Type utilities, generics, type guards -->

- Model finite states as string-literal unions.
- Use `Partial<T>` for narrow updates, not for complete persisted records.
- Return `null` for an expected absence and throw/return an error result for a
  failed operation; do not mix the meanings.
- Normalize snake_case/camelCase compatibility at one boundary.

---

## Forbidden Patterns

<!-- any, type assertions, etc. -->

- Repeated local casts of the same raw IPC/provider payload.
- Non-null assertions on files, DOM nodes, or store records that can disappear.
- Adding an unchecked status string outside the canonical union.
- Using `any` to bypass a boundary that can be represented by `unknown` and a
  guard.
