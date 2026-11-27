# 2026-11-27 布局整治续做复核

范围为仓库布局、测试与双机现有装机资源。执行只读探针，未重写工作流、推送、部署、发车或生成媒体。

## 布局与档位

- `cd apps && python3 -m pytest -p no:cacheprovider backend/comfyui/tests/test_workflow_layout_gate.py -q` 退出 0，8 通过、1 跳过。跳过项是默认关闭的不动点长测。已有 1127 的开启长测回执为 9 通过。
- 16:19 布局报告覆盖 149 件。只读跟踪现行 `layout_normalize.normalize()` 的拒绝返回，逐件复算 35 件低于最紧档的工件和后来字节变动的 3 件 SenseNova，38 件的档位、末态度量和无解标记均与报告相等。40 个降档作用域的拒绝分支、超限值和阈值见 [逐件档位回执](ac4-rung-trace-1127.json)。4 件无解会拒写整件，其中 1 件的主图无解使后续 6 个子图未求解，回执标明了早停。两件 fasth3 到迭代上限后采用组框档试算，原工作流仍受既有不动点拒写保护。

## 回归

`cd apps && npm run test:py` 退出 1。引擎域先失败，入口按原有 fail-fast 跳过 5 域。随后调用 `buildDomains()` 取后续五域原始命令、参数、工作目录和环境，逐域独立实跑。

| 域 | 退出码 | 结果 |
|---|---:|---|
| engines | 1 | 1,231 通过、2 跳过、7 个子测试通过、7 失败 |
| my_nodes | 1 | 963 通过、1 跳过、8 失败 |
| chapter_video | 0 | 238 通过、2 按入口配置排除、9 个子测试通过 |
| build_scripts | 0 | 86 通过、3 个子测试通过 |
| backend_unittest | 0 | 601 个用例，598 通过、3 跳过 |
| trellis | 0 | 22 通过 |

引擎域的 7 条失败来自以下两组。

- `test_flux3_daojie_workflow_contract.py` 的 `test_gui_expands_to_the_same_execution_graph_as_the_recorded_case`、`test_shared_sources_are_unchanged_since_the_builder_snapshot` 均停在第 79 行的主体句文档哈希断言。期望 `94a743f3…1da8`，实得 `5d1fe90f…a072`。命中的文件为 `docs/prompts/道劫_类型主体句示例.md`，历史文档任务中有该文件的更新记录。失败发生在比对文本真源指纹时。
- `test_sensenova_daojie_workflow_contract.py` 的 `TestLoaders::test_ckpt_and_lora_anchors[path0/path1]`、`TestLoaders::test_api_loader_anchors[path0/path1]`、`TestGeneratorReexport::test_reexport_byte_identical`。两对 GUI/API 载入器及重导出测试期望 `int8_convrot`，现行文件为 `bf16`。当前三件 SenseNova GUI 与 16:19 报告、Mac 装机的差异限于上述模型名及其 URL、备注。AC8、AC10 的重导出证据因此仍红。

节点域现存 8 条失败是线模式分类和顺序 2 条、分镜视频标识 2 条、负向词格式 1 条、设定卡版式与透明稿 3 条。与生图对账归档交付记录 15:20 的结果一致。另对 8 组蓝图与宿主的共享字段执行逐键比较，7 组一致，`qi21-提示词类型优化子图-edit.json` 的 11 节点定义与 `qi21-edit.json` 的 3 节点定义在剔除布局后仍不同，为前置断言已经记录的结构差异。

## 双机装机

[149 件仓库与装机 SHA-256](installed-layout-audit-1127.json) 包含样件的出框、贴边和坐标证据。Mac 通过本地资源路径读取，Windows 通过既有 SSH 主机在装机目录执行 `Get-FileHash`，全量读取成功。

- Mac 146 件逐字节一致，3 件仅差 SenseNova 的底模配置，0 缺。三件指定样件均与仓库字节一致。17:27 的装机独立复核报告为 `ok=true`，当前实读打包版与装机版 `app.asar` 仍同哈希。既有 `build-mac.log` 有 16:24 的装机启动通过记录。
- Windows 3 件逐字节一致，89 件仅有换行差异，57 件在统一换行后仍不同，0 缺。`qi21-道劫-t2i.json` 和 `qi21-edit.json` 两件指定样件统一换行即一致。`fasth3-单镜视频-i2v.json` 则确有布局差异，主图 2 个节点位置与 6 个组框不同，Windows 为出框 3、贴边 1，仓库主图均为 0。剔除布局字段后两端 JSON 相等。
- AC9 仍缺 Windows 布局同步及应用内目检。Mac 3 件 SenseNova 的模型配置另由 GLM 接手。装机授权参见实施计划 Step 8.10–8.13。

## 核对状态

- 用户最新指令由 GLM 下载最新 SenseNova 模型，布局任务停止处理模型配置及相应重导出失配。前述 5 条 SenseNova 断言和 Mac 的 3 条模型字节差异作为交接证据保留，不作为布局回归。Krea2 按既有指令搁置。
- Windows 57 条统一换行后仍异的文件，28 件 Krea2 和 3 件 SenseNova 按用户指令放置。其余 26 件逐件对比主图、子图和组框，22 件已同布局（其中 3 件 Windows 少仓库的说明卡节点，但已有节点和组框位置一样）。剩余 4 件有真实布局差异，分别是 `社区-480P生成-960P精修-SolAttn加速-960P直出.json`、`fasth3-单镜视频-i2v.json`、`fasth3-单镜视频-t2v.json` 和 `社区-H3终极三采v2版.json`。前三件剔除布局后 JSON 相同，最后一件的差异通过既有组框合并豁免的结构守门。指纹和逐域计数见[装机对拍](installed-layout-audit-1127.json)。
- 上述复核时 AC8 仍有 Flux.3 主体句哈希、8 条既有节点域失败和 1 组蓝图前置结构差异，AC9 仍有 Windows 布局与应用内目检。此前的历史 RED 日志及提交当时的图变更分析仍缺原始回执。现有会话记录仅指向 11-26 的旧绑定，`current_run=null`，未发现其他会话正在写入本任务文档。

## 第二次续做

- Flux.3 失败已修复。文档归档备份证明示例文档只有第 19 行旧脚本引用更正和第 169 行引用加反引号两处变化。`apps/backend/comfyui/tests/test_flux3_daojie_workflow_contract.py` 只对这两处精确文字还原后比对原批准哈希。未改真源、哈希、审批回执或工作流。GitNexus 报两条测试直接调用、零产品流程，风险 LOW，索引落后 5 个提交，当前文件定点检索也只找到这两条调用。实跑该文件由 2 失败、3 通过变为 5 通过，退出 0。独立对照确认还原后的字节与 `prompts__道劫_类型主体句示例.md.before-deadscript-1126` 完全相同，未登记的内容变动仍会被拒绝。
- `cd apps && PYTHONPATH=backend python3 -m pytest -p no:cacheprovider backend/comfyui/tests --ignore=backend/comfyui/tests/test_sensenova_daojie_workflow_contract.py -q` 退出 0，1,208 通过、2 跳过、7 个子测试通过。仅排除 GLM 在做的 SenseNova 道劫契约文件。本结果是引擎域复验，节点域已知 8 条失败仍按上一轮回执保留。
- Windows 重新通过 `Get-FileHash` 读取四件，仓库及装机指纹均和上一轮对账相同。四件仍需同步，完整路径及待同步的两端 SHA-256 见[定点同步清单](windows-layout-sync-plan-1127.json)。此轮未改 Windows 文件。实施计划仍要求部署明令，并保留应用内目检。
- 蓝图前置结构差异的处理在 `design.md` §6 与 `implement.md` Step 4.7 中已规定为保留并报告 `pre_drift`，因此没有以 3 节点宿主覆盖 11 节点独立蓝图。

## 节点域续检

- 四条旧用例已恢复。线模式测试使用自包含图片处理图验证中间放大节点不会被当成视频输出，按 1102 已退役的看门狗行为检查 `switching → lms_ps → unload → /free → active`，并确认 actor 只收到本序列应有的两条动作。视频回写按 `11-23-h3-selfdev-workflow-fixes` 的 D18-A 验收，同时测试 `MyShot`、`ManyingShot` 两个入口和有无 `_修脸` 两种前缀，仍核对实际视频字节、回写路径和项目 ID。
- `cd apps && PYTHONPATH=backend python3 -m pytest -p no:cacheprovider backend/comfyui/my_nodes/tests/test_line_mode_server.py backend/comfyui/my_nodes/tests/test_my_shot_video.py -q` 退出 0，52 通过。完整节点域同一 pytest 参数运行 `backend/comfyui/my_nodes/tests`，退出 1，969 通过、1 跳过、4 失败。只改了两个测试文件。
- 四条现存失败来自 Qwen 真源契约。`test_negative_token_format_baseline_1008` 检出分镜剧情图负向词「画面中凭空出现的招牌文字」达到 12 字，违反小于 12 字的既有规则。另三条是 `test_qi21_charsheet_six_zone.py` 中的版式一致、`preserve-True` 和 `retry_repair-True`，实体与透明设定卡当前使用不同版式，PE 透明分支因此走拒收或回退。它们均涉及提示词真源或插件行为，在布局任务的生产修改范围外。
