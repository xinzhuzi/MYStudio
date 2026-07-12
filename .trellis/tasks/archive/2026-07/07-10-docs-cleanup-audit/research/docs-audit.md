# docs 全量清理审计

## 盘点范围

- 范围：`docs/` 当前磁盘全部文件。
- 文件总数：79。
- Markdown：78。
- 非 Markdown：`docs/.DS_Store` 1 个。
- 总大小：约 884 KiB。

## 索引与链接

- `docs/README.md` 已覆盖根目录全部非 README Markdown 文档。
- `docs/融合/README.md` 未覆盖 3 个 Markdown 文档：
  - `docs/融合/GPT图片生成标准适配说明.md`
  - `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md`
  - `docs/融合/Toonflow_MYStudio_分镜差异审计.md`
- 上述 3 个文件同时没有 Markdown 反向链接。
- 按 `docs/DOCS_MAINTENANCE.md` 的范围复跑 81 个 Markdown 文件，本地相对链接缺失数为 0。

## 重复与相似内容

- SHA-256 完全重复组：0。
- 最高相似项是 `art-styles.md` 与 `art-styles.en.md`，属于中英文版本，不是冗余副本。
- `DOCS_COVERAGE_AUDIT.md`、`README.md`、`NAVIGATION_GUIDE.md` 内容有交集，但职责分别是覆盖台账、文档索引和导航手册。
- `*_GUIDE.md` 与 `*_OPERATIONS.md` 的成对结构符合 `DOCS_MAINTENANCE.md` 规定的“总览/操作手册”职责划分，不作为重复清理项。

## 反例核验

### 两份 Toonflow 文档不能删除

- `docs/融合/Toonflow_MYStudio_分镜差异审计.md` 被以下未完成任务引用：
  - `.trellis/tasks/07-07-toonflow-image-workflow-deep-audit/`
  - `.trellis/tasks/07-08-mystudio-toonflow-workflow-parity-trace/`
- `docs/融合/MYStudio_Toonflow_工作流全链路追溯矩阵.md` 是 `.trellis/tasks/07-08-mystudio-toonflow-workflow-parity-trace/` 的明确验收产物。
- 结论：两者不是无用文件；当前问题是缺少融合索引入口。

### GPT 图片说明不宜直接丢弃

- `docs/融合/GPT图片生成标准适配说明.md` 没有索引、没有任务引用，但包含当前仍有效的图片模型测试和尺寸规则。
- 源码已确认 `apps/frontend/lib/api-manager/model-test.ts` 对 `gpt-image-*` 使用 `sdkGenerateImage()` 做真实图片请求。
- `apps/frontend/lib/ai/image-size-presets.ts` 已实现 `openai-size`、尺寸映射和 GPT 图片尺寸门禁。
- 当前权威用户文档 `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md` 仍写着“图片 dry-run”，与当前源码冲突。
- 结论：把有效内容合并进权威 API 模型测试文档后，再删除这份孤立适配说明。

## 建议清理清单

### 删除

1. `docs/.DS_Store`
   - 理由：macOS Finder 元数据，不是项目文档。
2. `docs/融合/GPT图片生成标准适配说明.md`
   - 前提：先把当前有效的 GPT 图片真实测试、标准模板、尺寸规则和排错口径合并进 `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md`。
   - 理由：孤立实现说明与权威用户文档职责重叠，保留会继续产生事实漂移。

### 修改但保留

1. `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md`
   - 修正图片模型测试仍是 dry-run 的过时说明。
   - 合并 GPT 图片标准请求、兼容兜底、尺寸限制和错误边界。
2. `docs/融合/README.md`
   - 增加两份当前仍被使用的 Toonflow 审计/追溯文档入口。

### 保留

- 其余 75 个 Markdown 文档。
- `docs/角色数据排查报告.md` 已明确归入带日期边界的历史排查资料，不属于未解释垃圾。
- `docs/融合/README.md` 当前列出的权威入口、技术参考和后续方案均有明确用途，不做激进裁剪。

## 预计结果

- `docs/` 从 79 个文件降为 77 个文件。
- Markdown 从 78 个降为 77 个。
- 非 Markdown 杂项从 1 个降为 0 个。
- 融合目录不再存在未解释的孤立文档。
- API 模型测试说明与当前源码一致。
