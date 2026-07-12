# 清理 docs 不需要内容

## Goal

盘点 `docs/`，区分保留、合并与待确认删除内容，形成可审计清单后小批次清理。

## Requirements

- 仅处理 `docs/` 目录，不修改应用源码或其他生产资料。
- 先按当前磁盘、当前文档索引、仓库引用和内容重复度形成清理清单，不凭文件名猜测用途。
- 将文件明确分为：保留、合并、待用户确认删除；没有充分证据的文件不得删除。
- 删除任何已有文件或正文内容前，必须先向用户展示精确路径、理由和影响并获得明确确认。
- 禁止任何 git / worktree 操作；禁止批量删除、清空文件及破坏性命令。
- 实施时采用备份优先、小批次修改、每批回读和验证的方式。
- 保持 `docs/README.md`、`docs/README.en.md`、`docs/DOCS_MAINTENANCE.md` 与 `docs/融合/README.md` 的索引一致性。

## Acceptance Criteria

- [x] 当前 `docs/` 文件清单、索引覆盖、仓库反向引用、相同内容和高相似内容已完成全量核验。
- [x] 每个清理对象都有精确路径、证据、处理建议和风险说明。
- [x] 用户明确确认删除清单后，才执行删除或内容裁剪。
- [x] 实施后不存在失效的本地 Markdown 链接，索引未引用已删除文件。
- [x] 实施后重新全量扫描 `docs/`，确认无 `.DS_Store`、备份、临时文件或未解释的孤立文档。
- [x] 最终 `docs/` 为 77 个 Markdown 文件，根目录和融合目录索引覆盖缺口均为 0。

## Confirmed Facts

- 实施前 `docs/` 共 79 个文件，其中 78 个 Markdown 文件和 1 个 `.DS_Store`，总大小约 884 KiB。
- `docs/DOCS_MAINTENANCE.md` 规定：根目录非 README 文档应被 `docs/README.md` 覆盖，融合目录文档应被 `docs/融合/README.md` 覆盖。
- `docs/融合/README.md` 声明该目录只保留对当前 MYStudio 仍有参考价值的资料，当前代码和 `docs/WORKFLOW_GUIDE.md` 优先于历史规划。
- 当前相对链接缺失数为 0，完全重复文件组为 0；根目录索引覆盖完整。
- 融合目录有 3 个未索引文件，其中两份 Toonflow 审计/追溯文档仍被未完成任务引用，必须保留并补索引。
- `docs/融合/GPT图片生成标准适配说明.md` 没有索引或任务引用，但其有效内容能修正 `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md` 中“图片测试仅 dry-run”的过时说明。
- 实施后 `docs/` 共 77 个 Markdown 文件；相对链接缺失、两级索引缺口、完全重复组、非 Markdown 杂项和过时图片 dry-run 表述均为 0。

## Proposed Cleanup

- 删除 `docs/.DS_Store`。
- 将 GPT 图片真实测试、标准模板、尺寸限制和排错边界合并进 `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md`，随后删除 `docs/融合/GPT图片生成标准适配说明.md`。
- 在 `docs/融合/README.md` 中补充两份仍被使用的 Toonflow 文档入口。
- 保留其余文档，不做激进裁剪。

## User Decision

- 2026-07-10：用户批准 Proposed Cleanup 的精确删除清单，并同意按计划进入实施阶段。
- 2026-07-10：用户在 human-review 摘要后要求继续完成任务，批准使用 `--no-commit` 归档当前任务并记录 session。

## Out of Scope

- 不修改 `docs/` 之外的代码、配置、资源或正文。
- 不借清理之机重写产品功能说明或扩展新文档。
- 不执行任何 git / worktree 操作；Trellis 归档和 session 记录仅走已批准的 `--no-commit` 路径。
