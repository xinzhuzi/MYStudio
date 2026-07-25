<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

---

## 项目级工程铁律(Claude Code)

本仓库的通用工程铁律——先验证再动手(铁律0)、下结论前三关、渐进式分段、大量内容用脚本处理(放 `apps/build/scripts/`)、子代理探子用法、禁止破坏性操作、严禁猜测、搜索 SOP(搜索前先读 `.trellis/spec/guides/search-sop-guide.md`)等——维护在 [`.claude/CLAUDE.md`](.claude/CLAUDE.md)。

Codex / 其它 agent 处理本仓库时建议参照该文件的工程纪律;任务流程仍以 `.trellis/workflow.md` 为准。
