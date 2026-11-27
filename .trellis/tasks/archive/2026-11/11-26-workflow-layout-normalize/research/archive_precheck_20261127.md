# 11-26-workflow-layout-normalize 归档预检

`multi-AI precheck: fail-blocked`。用户已批准完成后归档。当前任务为 `in_progress`，AC8 与 AC9 开放。

| 检查 | 证据与待办 |
| --- | --- |
| A1 在途写入与引用 | `task.py list` 退出 0，共 8 项开放。生图引擎对账已归档，小说数据对齐只在历史测试记录引用本任务，未依赖任务目录。SenseNova 模型由 GLM 处理，保留其配置变更。正式移动任务目录时，更新 `docs/comfyui-kb/画布布局规范.md` 第 46、65 行与 `.agents/skills/node-graph/OPTIMIZATION.md` 第 162 行引用的役档路径。 |
| A2 改动范围 | 本轮修订本任务的 Mac 安装记录和归档预检。依仓库 no-git 规则，以任务工件和可见文件核对范围。 |
| A3 工件写入 | 续做记录载明 `current_run=null`。本轮检查发现的最近写入与续做回执时间一致。实际归档前复核在途执行、认领及工件时间。 |
| A4 交付完整性 | 布局批次已有 [AC 回执](../ac-evidence.md) 记录。三份测试修订见[续做复核](closeout-verification-1127.md)，当前未做 Git 状态核对。归档使用 `--no-commit --skip-branch-validation`。 |
| A5 验收矩阵 | AC1–AC7、AC10 已登记。AC8 的 Python 总门仍红，节点域 969 通过、1 跳过、4 失败。AC9 缺 Windows 四件 H3 布局同步与应用内目检。 |

## 本轮核对

- **AC8**：`test_negative_token_format_1008.py` 检出 `qi21_bases.json` 中「分镜剧情图」的一条 12 字负向词。`test_qi21_charsheet_six_zone.py` 另有 3 条失败，根因是实体与透明设定卡的提示词版式不同。测试注释明确保留版式相同的契约，既有 `11-15-derived-asset-detail/fix-all-fire-plan.md` 也记录过这 3 条失败。处理提示词真源需要独立决定语义和版式，属于布局整治范围之外。蓝图与宿主的存量结构差异按设计作为 `pre_drift` 保留。SenseNova 模型与重导出验证由 GLM 接手。
- **Mac Target Acceptance**：`VERIFIED`（装机日志、包体指纹、文件布局）。`build-mac.log` 第 99 行记录已装机并启动，`verify-installed-report.json` 的 17:27 报告 `ok=true`。本轮使用 Python `Path.read_bytes()` 独立对拍 `qi21-道劫-t2i.json`、`qi21-edit.json`、`fasth3-单镜视频-i2v.json`，三件逐字节相等，退出 0。用户应用内布局目检待确认。
- **Windows Target Acceptance**：`FAILED`（装机文件的布局对拍）。[装机对拍](installed-layout-audit-1127.json) 与[四件同步前指纹](windows-layout-sync-plan-1127.json) 记录实际布局差异。按 [Step 8.13](../implement.md) 等明确部署指令。全包部署会拉取代码并停启应用和引擎，安排时需避开在途运行。部署后定点复核四件文件，再由用户确认应用内布局。
