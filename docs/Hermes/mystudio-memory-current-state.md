# MYStudio 现有记忆链核验

## Current capabilities

- `apps/frontend/lib/studio/source-bible.ts:11-20`：`sourceBible` 当前上限为 4000 字符，镜像路径固定为 `novel/source-bible.md`。
- `apps/frontend/lib/studio/source-bible.ts:68-122`：AI 生成只从导入章节做头/中/尾采样，默认总采样预算 24000 字符、单章 3000 字符；没有源文件 manifest、内容指纹或增量失效协议。
- `apps/frontend/stores/studio/studio-store-novel-mirrors.ts:41-73`：保存时异步写 Markdown 镜像，启动或切项目时仅在 store 为空时回读；没有冲突、版本或 stale 判定。
- `apps/frontend/lib/studio/project-memory.ts:29-133`：工作流调用时临时从章节事件、实体提取和剧集圣经重建记录；记录没有磁盘档案索引。
- `apps/frontend/lib/studio/project-memory.ts:136-177`：检索是 JS 内存数组过滤和字符串包含计分；中文查询按空白/标点切分，无法替代中文 FTS 或结构化查询。
- `apps/frontend/components/panels/studio/useScriptStageActions.ts:168-202` 与 `useProductionPlanningActions.ts:86-103`：编剧、导演计划在每次调用现场重建并注入项目记忆，同时独立注入 `sourceBible`。
- `apps/frontend/lib/studio/event-graph.ts:9-133` 与 `apps/frontend/stores/studio/memory-slice.ts:41-77`：另一套事件图记录会持久化在 studio store，并支持项目范围 rebuild/retrieve/purge；它只覆盖已完成事件分析的章节。
- `apps/frontend/types/studio.ts:67-113`：持久化事件记忆仅有 event/run/summary 三类，具备 sourceId/revision 的上游身份但没有文件哈希、抽取器版本、来源片段锚点和 stale 状态。

## Structural gaps

1. `project-memory.ts` 与 `event-graph.ts` 存在两套记录类型、构建与检索实现；新系统不能再建立第三套平行事实源。
2. 当前唯一项目文件是 `novel/source-bible.md`；正文镜像在 `novel/chapters/`，没有 `novel/source-memory/`。
3. 记忆没有可追溯的 source manifest、hash、offset/章节锚点、生成器版本和依赖图，正文修改后无法证明哪些记忆仍有效。
4. 没有文件锁、原子批写、人工编辑漂移保护、写入审批或坏索引自动重建契约。
5. 没有 SQLite/FTS5 档案层，也没有面向中文的检索验证；现有 `includes` 计分只能作为兼容降级。
6. UI 只有原著圣经编辑器，用户看不到档案记忆来源、更新时间、失效原因、索引健康度或重建进度。

## Integration direction

- 以 `source-memory/` 为磁盘事实边界；`source-bible.md` 保持兼容，但应成为由记忆库生成或用户确认的常驻摘要视图。
- 合并现有两条事件记忆逻辑到单一适配层；在完成迁移前保留旧调用结果的零数据回退。
- 所有工作流只通过同一 retrieval contract 请求当前章节需要的上下文，返回记录必须携带来源与 freshness。
