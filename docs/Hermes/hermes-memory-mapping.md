# Hermes 记忆机制核验

## Sources

- `https://github.com/NousResearch/hermes-agent/blob/main/tools/memory_tool.py`
- `https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_manager.py`
- `https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_provider.py`
- `https://github.com/NousResearch/hermes-agent/blob/main/tools/session_search_tool.py`
- `https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md`

## Confirmed mechanisms

1. **常驻层是文件持久化，不是只存在内存的 store。** `MemoryStore` 维护 `MEMORY.md` 与 `USER.md` 两个目标；写入立即落盘，但系统提示使用会话开始时抓取的一份 frozen snapshot，当前会话不因写入而改变。这同时满足跨会话持久化和提示词前缀稳定。
2. **常驻层有硬边界。** 条目以 `§` 分隔，按字符而不是 token 计数；add/replace 超限返回错误，要求模型先合并或删除，不静默截断。重复条目被拒绝。
3. **写入具备文件安全协议。** 写前做 threat-pattern 扫描；读改写在独立 `.lock` 文件上加锁；写文件使用原子替换；检测到人工编辑或并发写入造成的 round-trip drift 时先生成备份并拒绝覆盖。
4. **工具契约是小而确定的 CRUD。** 单一 `memory` 工具支持 add/replace/remove，replace/remove 用唯一短文本定位；batch 可以在同一次调用中先删/改再新增，并以最终总量原子校验。
5. **运行时有生命周期管理。** `MemoryProvider` 暴露 initialize、system_prompt_block、prefetch、queue_prefetch、sync_turn、tool schemas、shutdown 等钩子；`MemoryManager` 负责系统提示拼装、每轮召回、异步同步和失败隔离。
6. **第二层检索独立于常驻层。** `session_search` 对 SQLite 会话库做 FTS5 检索，不调用 LLM；发现、滚动、读取、浏览是不同形状，结果带 session/消息锚点，可在命中后继续滚动上下文。检索结果按 session lineage 去重并排除仍在当前上下文中的内容。
7. **安全边界贯穿注入链。** 常驻文件载入系统提示前会替换命中注入模式的条目为阻断占位符；原文仍保留给用户查看和删除。文档也明确区分“始终注入的关键事实”和“按需搜索的历史记录”。

## 对 MYStudio 的映射建议

- `source-memory/` 应是小说项目级、可搬运的文件树，而不是 `studio store` 的一个大字符串字段。
- 应保留“精炼常驻层”和“可检索档案层”两个独立契约：前者服务每次文本管线注入，后者服务章节/人物/设定的按需召回。
- 正文、设定、细纲等源文件需要有 manifest、内容指纹和生成时间；源文件指纹变化时派生记忆必须标记 stale，禁止静默继续使用旧结果。
- SQLite/FTS5 可作为第二阶段实现，但必须先确认中文检索方案、项目隔离键、清理和可迁移边界；不能把 Hermes 的会话数据库路径直接复制进小说项目。
- 外部资料写入、AI 生成和用户手工修订必须记录来源与覆盖关系；sourceBible 是一类派生记忆，不应成为唯一事实源。
