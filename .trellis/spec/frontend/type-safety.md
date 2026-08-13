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

---

## 类型安全治理结论 (2026-08-13)

### tsconfig (`apps/frontend/config/tsconfig.json`)

- `strict: true`(保留),`noFallthroughCasesInSwitch: true`(保留)
- `noUnusedLocals: true`、`noUnusedParameters: true` **已打开**——typecheck 0 errors(曾为 false,本轮已渐进打开并清零)
- `noImplicitAny: false` **暂保持**——渐进策略不变,后续再单独收紧

### noUnused* 修复模式(逐文件 Edit,禁止批量脚本)

| 类别 | 处理方式 |
|---|---|
| 未用解构值(保留 setter) | hole 模式 `const [, setX] = useState(...)`,不留名 |
| 未用函数 / 多行 const | 整块删除(brace matching),并连带清理孤儿 import / helper |
| 未用 import | 删除成员或整行 |
| 未用参数 | `_` 前缀(**仅参数 / catch / for-of 支持**) |
| 未用属性赋值 | 从解构中移除该成员 |

> 注意:`_` 前缀在 `noUnusedLocals` 下**不豁免局部变量**,只豁免参数、`catch` 绑定与 `for-of` 变量。未用局部变量必须删除或改用 hole 模式,不能靠加 `_` 前缀绕过。

### `:any` 治理

- 非 vendor、非测试口径:**75 处**(从含 vendor ~390 基线收窄);AC 目标 `≤195`,已达成。vendor 口径(`aitoearn-core`)按 Scope 明确不碰。
- 新代码禁止新增 `:any`(ESLint `@typescript-eslint/no-explicit-any` 已升为 **error** 级,见 quality-guidelines.md)。
- 合理保留 `any` / `Record<string, any>` 的场景:**AI 返回 JSON 的动态 shape 解析**,且对结果做直接属性访问——改 `unknown` 会触发 TS18046(对象类型不可窄化)。
- 运行时类型守卫 / 收窄辅助函数(如 `ensureString` / `ensureTags`)应使用 `unknown` + 类型守卫,不要用 `any`。
- 新边界代码统一规则:优先 `unknown` + narrowing;只有上述"动态 shape 直接取属性"场景才允许 `any` / `Record<string, any>`。
