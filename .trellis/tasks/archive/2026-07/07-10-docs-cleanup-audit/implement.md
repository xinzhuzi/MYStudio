# Implementation Plan: docs 清理

## 实施前门禁

- [x] 用户确认 `docs/.DS_Store` 与合并后的 `docs/融合/GPT图片生成标准适配说明.md` 可以删除。
- [x] 用户确认按本计划进入实施。
- [x] 读取 `trellis-before-dev`，回读 PRD、design、implement、研究结论和目标文档。

## 小批次执行

### 批次 1：修正权威 API 文档

- [x] 精确修改 `docs/API_PROVIDER_MODEL_TEST_REFERENCE.md` 的“模型测试范围”。
- [x] 增加 GPT 图片真实请求、标准模板、尺寸限制、兼容兜底和排错说明。
- [x] 回读修改区域，并与当前源码逐项核对。

### 批次 2：补齐融合索引

- [x] 在 `docs/融合/README.md` 增加“当前审计资料”。
- [x] 链接 `MYStudio_Toonflow_工作流全链路追溯矩阵.md`。
- [x] 链接 `Toonflow_MYStudio_分镜差异审计.md`。
- [x] 回读索引区域并检查相对路径。

### 批次 3：执行已确认删除

- [x] 先确认批次 1 已完整吸收 GPT 孤立说明的有效信息。
- [x] 单独删除 `docs/.DS_Store`，立即检查非 Markdown 杂项数量。
- [x] 单独删除 `docs/融合/GPT图片生成标准适配说明.md`，立即检查所有索引和任务引用。

## 验证

- [x] 全量 Markdown 相对链接检查：80 个文件，缺失数为 0。
- [x] 根目录索引覆盖检查：未索引文档为 0。
- [x] 融合目录索引覆盖检查：未索引文档为 0。
- [x] 完全重复内容检查：重复组为 0。
- [x] 杂项检查：`docs/` 下非 Markdown 文件为 0。
- [x] 过时说明检查：“图片模型测试仅 dry-run”和孤立 GPT 说明路径在 `docs/` 内命中均为 0。
- [x] 最终计数：77 个文件，全部为 Markdown。

## 定向测试证据

- 命令：`npm test -- frontend/lib/api-manager/model-test.test.ts frontend/lib/ai/image-standard.test.ts frontend/lib/ai/image-size-presets.test.ts frontend/lib/diagnostics/network.test.ts`
- 结果：4 个测试文件通过，31 个测试通过。
- 说明：测试输出含现有非浏览器环境的 `localStorage is not defined` 日志，但退出码为 0，断言全部通过；本轮没有修改相关代码。

## Spec Decision

- 不更新 `.trellis/spec/`：本轮没有改变代码、API、数据结构或跨层契约，现有文档维护规则已覆盖索引和链接门禁。
- “孤立文档不能仅凭无索引判断删除，需先查未完成任务引用”的证据保存在 `research/docs-audit.md`，不越界扩写项目代码规范。

## 收口边界

- 不执行 git / worktree。
- human review 摘要已经交付，用户随后明确要求继续完成任务。
- 归档和 session 记录仅使用已核验的 `--no-commit` 路径；session 显式传 `--branch=-`，避免间接探测 git 分支。
