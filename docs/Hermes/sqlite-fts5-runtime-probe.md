# Electron SQLite / FTS5 最小探针

## Runtime

- 命令在 `apps/` 下以 `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron -e ...` 执行。
- Electron `43.4.0` / Node `24.18.1` 可直接 `require("node:sqlite")`。
- `DatabaseSync(":memory:")` 可用，内置 SQLite 版本为 `3.53.1`。
- `CREATE VIRTUAL TABLE ... USING fts5(...)` 成功，不需要新增 npm SQLite 依赖或依赖系统 `sqlite3` CLI。

## Chinese retrieval result

对原文 `晏燎创建万劫圣宗` 使用默认 FTS5 tokenizer：

- 查询完整连续文本 `晏燎创建万劫圣宗`：命中。
- 查询 `晏燎`：不命中。
- 查询 `万劫圣宗`：不命中。

结论：默认 `unicode61` 把连续中文当作一个 token，不能满足小说人物名、宗门名和片段关键词检索。第一阶段必须在应用层生成确定性的 CJK bigram（必要时叠加 unigram/Latin token）搜索字段，或加载经过跨平台打包验证的 CJK FTS5 tokenizer；不能直接宣称默认 FTS5 支持中文。

## Design consequence

第一阶段采用 `node:sqlite` + 应用层 CJK bigram 索引，避免新增原生依赖和系统 CLI 假设。数据库是可重建派生物；原始 Markdown、manifest 和结构化 JSONL 保持可读、可迁移。
