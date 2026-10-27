# 档案检索层设计深化：Hermes 血统、三处偏离与本地 RAG 定位

> 主会话 08-17 夜补充。来源：本会话对 NousResearch/hermes-agent 的源码级研究
> （hermes_state.py / session_search / 文档站 memory 页）+ sqlite-fts5-runtime-probe.md 探针结论。
> 供 L1/L3 实施者直接继承设计依据，避免重新推导。

## 一、血统映射（我们学的是 Hermes 的哪一部分）

| 本项目 | Hermes 出处（已核实） | 继承的哲学 |
|---|---|---|
| `source-memory/MEMORY.md` 常驻层 | `MEMORY.md`（2.2KB 硬上限，每会话全文注入） | 常驻层管"永远需要的"，小到无需检索 |
| `index.sqlite` FTS5 档案层 | `hermes_state.py`（SQLite 会话存档 + FTS5 + WAL + schema 自修复）+ `session_search`（~20ms，返回**原文**不摘要不截断） | 档案层管"按需查的"，检索零模型依赖、可重建 |
| 双层分工 | 文档明示："memory holds key always-needed facts; session search answers 'did we discuss X last week'" | 两层互补，不互相编译依赖 |

Hermes 另有 native CJK 分词器（`native/fts5_cjk`）——探针在我们运行时复现了同款问题
（默认 unicode61 把「晏燎创建万劫圣宗」当单 token，查「晏燎」不命中），我们用应用层
CJK bigram `search_tokens` 字段绕过，不引入原生代码。这是同坑异解，不是设计分歧。

## 二、三处刻意偏离及理由（实施时不得"纠正"回 Hermes 形态）

1. **语料不同**：Hermes 档案 = 会话消息原文；我们 = 小说章节切块 + AI 结构化抽取事实
   （11 类：character/alias/relation/event/timeline/world-rule/term/location/object/
   foreshadowing/adaptation-redline，每条带 sourceSha256 出处）。
   理由：管线需要"这句话是谁、哪章、还作数吗"的**类型化答案**，纯原文检索给不了。

2. **消费模型不同**：Hermes 是 **agent 主动拉**（模型自己决定何时调 session_search 工具）；
   我们是 **管线主动推**——每个工作流动作开始时自动检索并打包 memoryBlock 注入。
   理由：管线是单次 AI 调用，没有对话循环让模型"想起来去查"。
   **实施约束**：注入必须复用主会话已交付的 `readResidentBible` 消费模式——动作开始现读一次、
   批次内一致、跨批次新鲜；memoryBlock 作为**同一动作内的一次附加检索**，追加在常驻圣经块
   之后，不得自成第二个常驻块（用户裁定：只注入一层常驻）。

3. **打分不同**：Hermes 纯 BM25；我们 = 硬过滤（项目/章节/freshness）× BM25 × 实体精确命中
   × 时间线邻近 × 用途权重，同分按 recordId 保证确定性。
   理由：结构化记录允许 facet 过滤；确定性排序可写回归测试。

## 三、本地 RAG 定位（对外解释口径，也是设计边界）

- 是**本地检索增强（RAG 本义）**，但**不是向量 RAG**：无 embedding、无向量库、无语义相似度。
  实现 = FTS5 倒排索引 + BM25 + 结构化过滤，零模型下载（符合本地模型显式下载政策）。
- 关键词检索的语义短板由**结构化抽取补偿**：小说检索高频目标是人名/宗门名/术语（精确 token，
  BM25 天然强项）；同义与别名由 AI 抽取生成 alias 记录解决（查"小逸"命中晏燎的别名行）。
- **向量扩展的逃生门**：records.jsonl 事实层与检索投影分离——将来若需语义检索，往 SQLite
  加一张向量表 + 本地 embedding 模型（显式下载）即可，不动事实层与常驻层。第一阶段不做。

## 四、实施锚点（已存在的代码事实，勿重复造）

- 常驻层单文件链路已上线（commit 2a9c2cc）：`readResidentBible`（lib/studio/source-bible.ts，
  新路径→旧 source-bible.md→store 兜底）+ 四注入点动作级现读 + 编辑器打开现读。
  L2 的"MEMORY 编译"= **维护** `source-memory/MEMORY.md` 这一个文件（AI 精选事实追加时
  守 4000 上限、超限拒收不截断），不是另造编译产物。
- `chapter-paths.ts` 顶层布局注释是路径权威；`_p/{pid}/` 虚拟键四通道已统一重定向
  （commit 1a53102），文本写入走 `project-file-write-text` 即可达项目目录。
- FTS5 探针数字：Electron 43.4.0 / Node 24.18.1 / SQLite 3.53.1，`node:sqlite` +
  `CREATE VIRTUAL TABLE ... USING fts5` 可用（ELECTRON_RUN_AS_NODE 环境）；
  **packaged utilityProcess 环境仍需 L1 先行验证**（评审意见 2）。
