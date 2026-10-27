# Hermes 研究参考文档集

Hermes(Nous Research 本地 AI agent)的研究资料,供后续参考。两次研究互补:08-17 是「借」(给 MYStudio 设计原著记忆库),10-27 是「评」(Hermes 记忆系统本身的优点盘点与业界定位)。

## Hermes 本体位置(本机)

- 源码仓库:`~/.hermes/hermes-agent`(活跃 git 仓库)
- 数据家:`~/.hermes`(config.yaml、hermes.db、已装插件;gateway 常驻,查库须只读)
- App:`/Applications/Hermes.app`

## 文档清单

| 文件 | 日期 | 内容 | 材料 |
|---|---|---|---|
| [hermes-memory-deep-dive.md](hermes-memory-deep-dive.md) | 2026-10-27 | **深度详解(主参考,细节版)**:初版 12 支柱骨架 + 七章代码级详解全文(356KB)——运行时逐跳时序/存储契约/安全五闸/WAL·FTS 状态库/压缩链/生态治理清点/本机部署实况;开头有目录·阅读指引·支柱-章节速查表,含章节级核证状态表(并修正初版 P11 一处措辞,**以本版为准**) | 本地仓库深读 + 本机部署态 |
| [chapters/](chapters/) | 2026-10-27 | 七章详解单独成件(ch01~ch07,各 350~475 行),供按主题单独查阅;核证状态见详解版开头的章节核证表 | 同上 |
| [hermes-memory-report.md](hermes-memory-report.md) | 2026-10-27 | 记忆系统深度研究终稿(结论速览版):七路深读源码 + 竞品对比 + 12 条支柱主张逐条独立核证(12/12 成立),含核证附录;定谳「工程化与安全治理维度的公开标杆、整体第一梯队」,并如实列出「最好」头衔的不可证点。细节展开见详解版 | 本地仓库深读 + 本机部署态 |
| [hermes-memory-mapping.md](hermes-memory-mapping.md) | 2026-08-17 | Hermes 记忆机制核验(7 条确认机制:文件持久化+冻结快照、硬字符边界、写入安全协议、小而确定的 CRUD、provider 生命周期、session_search FTS5 二层检索、注入链安全)+ 对 MYStudio 的映射建议 | GitHub 上游 main |
| [archive-layer-lineage.md](archive-layer-lineage.md) | 2026-08-17 | 档案检索层设计深化:Hermes 血统、三处偏离、本地 RAG 定位 | 上游源码 + FTS5 探针 |
| [mystudio-memory-current-state.md](mystudio-memory-current-state.md) | 2026-08-17 | MYStudio 当时现有记忆链核验 | 本仓 |
| [novel-source-inventory.md](novel-source-inventory.md) | 2026-08-17 | 小说原著资料盘面盘点(MA/novel) | 本机盘面 |
| [sqlite-fts5-runtime-probe.md](sqlite-fts5-runtime-probe.md) | 2026-08-17 | Electron SQLite/FTS5 最小运行探针结论 | 本机实验 |

## 两次研究的重合与增量

08-17 确认的机制中有 4~5 条与 10-27 核证支柱重合并再次坐实(冻结快照保前缀缓存、硬字符预算不静默截断、威胁扫描+[BLOCKED] 占位、batch 终态原子校验、session_search 独立 FTS5 检索层)——上游核心机制三个月稳定未变。10-27 新增维度:WAL 所有权纪律、api_content 边车逐轮回放、卡死熔断门、审批 TOCTOU 防偷换、出口强制脱敏、CJK 双字分词 FTS、插件供应链治理、多 profile 归属隔离、业界竞品对比。

## 出处注

- 08-17 五件复制自 `.trellis/tasks/archive/2026-08/08-17-source-memory-hermes/research/`(trellis 归档原址保留不动)。
- 10-27 终稿原件在 `apps/output/hermes-memory-study-1027/`(apps/output 有周期清场风险,以本目录为准)。
