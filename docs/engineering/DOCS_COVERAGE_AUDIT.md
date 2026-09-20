# 文档覆盖审计

本文记录当前 `docs/` 对 MYStudio 用户界面和主要源码入口的覆盖状态。它不是功能说明，而是维护台账：改界面或继续补文档时，先用这里判断缺口。

## 主导航覆盖

| 界面入口 | 源码入口 | 当前用户文档 |
|---|---|---|
| 应用外壳、侧栏、项目头部 | `apps/frontend/components/Layout.tsx`、`TabBar.tsx`、`ProjectHeader.tsx`、`ChromeControls.tsx` | [应用外壳操作手册](../panels/APP_SHELL_OPERATIONS.md)、[页面导航](../panels/NAVIGATION_GUIDE.md) |
| 项目首页 | `apps/frontend/components/Dashboard.tsx` | [项目首页与项目管理](../panels/PROJECT_DASHBOARD_GUIDE.md)、[项目首页操作手册](../panels/PROJECT_DASHBOARD_OPERATIONS.md) |
| 概览 | `apps/frontend/components/panels/overview/index.tsx` | [项目概览](../workflow/OVERVIEW_PANEL_GUIDE.md)、[项目概览操作手册](../workflow/OVERVIEW_PANEL_OPERATIONS.md) |
| MY 工作流 | `apps/frontend/components/panels/studio/index.tsx`（八页签；「分镜视频生成」「图像节点图」为 ComfyUI 画布，宿主 `comfy-canvas/ComfyCanvasSwap.tsx`） | [基本工作流教程](../workflow/WORKFLOW_GUIDE.md)、[从分镜到最终视频的完整链路](../workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md)、[工作流阶段操作手册](../workflow/WORKFLOW_STAGE_OPERATIONS.md)、[小说导入与剧本策划操作参考](../workflow/WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md)、[剧本资产管理与剧情产物生成操作参考](../workflow/WORKFLOW_ASSET_GENERATION_OPERATIONS.md)、[分镜面板与视频工作台操作参考](../workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md)（15 列协议与章节链路已复核，旧两栏界面单独保留历史标记） |
| 技能 | `apps/frontend/components/panels/skills/index.tsx` | [技能编辑](../panels/SKILLS_EDITOR_GUIDE.md)、[技能编辑操作手册](../panels/SKILLS_EDITOR_OPERATIONS.md) |
| 资产 | `apps/frontend/components/panels/assets/` | [资产库使用与存储](../assets/ASSET_LIBRARY_GUIDE.md)、[资产导入与管理](../assets/ASSET_IMPORT_AND_MANAGEMENT.md)、[资产详情弹窗操作手册](../assets/ASSET_DETAIL_OPERATIONS.md)、[道具目录操作手册](../assets/PROPS_LIBRARY_OPERATIONS.md)、[视觉风格管理](../assets/VISUAL_STYLE_MANAGEMENT.md)、[视觉手册编辑器操作手册](../assets/VISUAL_MANUAL_EDITOR_OPERATIONS.md)、[资产库音色分配](../assets/ASSET_AUDIO_ASSIGNMENT.md)、[角色音色分配与自动匹配参考](../assets/ROLE_AUDIO_ASSIGNMENT_REFERENCE.md) |
| 本地模型（原「辅助」，2026-09-10 全屏 ComfyUI 合一） | `apps/frontend/components/panels/assist/ComfyWorkspace.tsx`（ComfyUI 画布 / TTS 配音室 / 漫影生图三态）、`comfy-canvas/`、`local-models/` | [本地模型页（ComfyUI 工作区）](../panels/LOCAL_MODELS_GUIDE.md)；旧 [辅助工作台](../panels/ASSIST_WORKBENCH_GUIDE.md) 三篇已整体过时（见文首横幅），工程向知识在 [comfyui-kb/](../comfyui-kb/) 与 `.agents/skills/comfyui/machine.md` |
| 自媒体 | `apps/frontend/components/panels/self-media/` | [自媒体发布台](../panels/SELF_MEDIA_GUIDE.md)；工程边界见 [自媒体 / AiToEarn 集成边界](./self-media-aitoearn-integration.md) |
| 导出 | `apps/frontend/components/panels/export/index.tsx` | [成片与导出](../panels/EXPORT_GUIDE.md)、[成片与导出操作手册](../panels/EXPORT_OPERATIONS.md) |
| 产物 | `apps/frontend/components/panels/media/index.tsx` | [产物管理](../panels/MEDIA_OUTPUTS_GUIDE.md)、[产物页操作手册](../panels/MEDIA_OUTPUTS_OPERATIONS.md) |
| 设置 | `apps/frontend/components/panels/SettingsPanel.tsx` | [设置页操作手册](../settings/SETTINGS_PANEL_OPERATIONS.md)、[设置与云端AI配置](../settings/API_SETTINGS_GUIDE.md) |

## 设置页专题覆盖

| 设置分区 | 当前用户文档 |
|---|---|
| 外观 | [外观皮肤与护眼模式](../panels/APPEARANCE_THEMES.md)、[设置页操作手册](../settings/SETTINGS_PANEL_OPERATIONS.md) |
| 云端AI | [设置与云端AI配置](../settings/API_SETTINGS_GUIDE.md)、[云端AI操作手册](../settings/API_MANAGER_OPERATIONS.md)、[API 供应商字段与模型测试参考](../settings/API_PROVIDER_MODEL_TEST_REFERENCE.md) |
| 本地配置 | [设置页操作手册](../settings/SETTINGS_PANEL_OPERATIONS.md)、[ComfyUI 引擎指南](../settings/COMFYUI_ENGINE_GUIDE.md)、[Python 与本地 TTS 配置](../settings/PYTHON_TTS_SETUP.md)、[TTS 运行时与模型区块指南](../settings/TTS_CONFIG_GUIDE.md)、[设置与云端AI配置](../settings/API_SETTINGS_GUIDE.md)、[开发者架构与代码入口](./DEVELOPER_ARCHITECTURE.md) |
| MCP 服务 | [MCP 服务](../settings/MCP_SERVICES_GUIDE.md) |
| 图片规格 | [图片规格](../settings/IMAGE_SIZE_GUIDE.md) |
| 高级选项 | [高级选项](../settings/ADVANCED_OPTIONS_GUIDE.md) |
| 图床配置 | [图床配置](../settings/IMAGE_HOST_CONFIG.md) |
| 存储 | [存储与数据迁移](./STORAGE_AND_DATA.md)、[应用更新](../settings/APP_UPDATE_GUIDE.md) |
| 开发 | [开发模式与控制台](../settings/DEVELOPMENT_MODE.md) |
| 支持作者 | [支持作者与反馈](../settings/SUPPORT_GUIDE.md) |

## 兼容和内部工作区覆盖

这些入口不是当前左侧主导航的一等入口，但仍会通过旧链路、产物页或高级按钮进入。

| 工作区 | 源码入口 | 当前用户文档 |
|---|---|---|
| 旧剧本三栏 | `apps/frontend/components/panels/script/` | [兼容剧本编辑工作区](../director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md)、[预告片分镜挑选与复用参考](../director/TRAILER_STORYBOARD_REUSE_REFERENCE.md) |
| 内部角色生成 | `apps/frontend/components/panels/characters/` | [角色生成与衣橱](../assets/CHARACTER_GENERATION_GUIDE.md) |
| 内部场景生成和多视角 | `apps/frontend/components/panels/scenes/` | [场景库多视角与四视图](../assets/SCENE_MULTIVIEW_GUIDE.md) |
| 导演工作台 | `apps/frontend/components/panels/director/` | [高级导演与 S级镜头](../director/ADVANCED_DIRECTOR_TOOLS.md)、[导演分镜卡片与首尾帧生成参考](../director/DIRECTOR_SHOT_CARD_REFERENCE.md)、[导演分镜口播与批量配音参考](../director/DIRECTOR_VOICEOVER_REFERENCE.md)、[视角切换与四宫格操作手册](../director/ANGLE_AND_QUAD_GRID_OPERATIONS.md) |
| S级组级镜头 | `apps/frontend/components/panels/sclass/` | [高级导演与 S级镜头](../director/ADVANCED_DIRECTOR_TOOLS.md)、[S级组级视频生成操作手册](../director/SCLASS_GROUP_VIDEO_OPERATIONS.md)、[预告片分镜挑选与复用参考](../director/TRAILER_STORYBOARD_REUSE_REFERENCE.md) |
| 视角切换 | `apps/frontend/components/features/storyboard/angle-switch/` | [视角切换与四宫格操作手册](../director/ANGLE_AND_QUAD_GRID_OPERATIONS.md) |
| 四宫格 | `apps/frontend/components/features/storyboard/quad-grid/` | [视角切换与四宫格操作手册](../director/ANGLE_AND_QUAD_GRID_OPERATIONS.md) |

## 工程和运行覆盖

| 范围 | 当前文档 |
|---|---|
| 开发架构 | [开发者架构与代码入口](./DEVELOPER_ARCHITECTURE.md) |
| ComfyUI 引擎层（engines/comfyui、my_nodes、webview 桥、comfyui/ 家） | 用户侧：[ComfyUI 引擎指南](../settings/COMFYUI_ENGINE_GUIDE.md)、[本地模型页](../panels/LOCAL_MODELS_GUIDE.md)；工程侧：[定制代码地图](../comfyui-kb/定制代码地图.md)、[参数速查](../comfyui-kb/参数速查.md)、[常见故障排查](./TROUBLESHOOTING.md)（引擎排障节）、`.claude/knowledge/node-graph-architecture.md`、`.agents/skills/comfyui/machine.md` |
| 打包、覆盖安装、smoke | [打包、安装与 Smoke 测试](./PACKAGING_AND_SMOKE_TESTING.md) |
| 时间线 renderer / Remotion | [渲染契约](../../.trellis/spec/frontend/timeline-rendering.md)、[开发者架构与代码入口](./DEVELOPER_ARCHITECTURE.md)、[常见故障排查](./TROUBLESHOOTING.md) |
| 后端 TTS | [本地 TTS 后端参考](../../apps/backend/README.md)、[本地 TTS 声音克隆与音色分配流程](../panels/voicebox-voice-cloning-flow.md) |
| 许可证 | [许可证与商业授权说明](../settings/LICENSE_GUIDE.md) |
| 故障排查 | [常见故障排查](./TROUBLESHOOTING.md) |
| 文档维护 | [文档维护清单](./DOCS_MAINTENANCE.md) |

## 覆盖状态与维护方向

当前第一层覆盖已经建立，且本轮已补齐覆盖表中明确提到的预告片分镜复用、导演分镜口播和配置弹窗细节。后续不再按“已有缺口”推进，而是跟随界面变化维护：

1. 工作流已覆盖 `小说导入/剧本生产阶段`、`剧本资产管理/剧情产物生成职责` 和 `分镜面板/视频工作台` 专题；工作流阶段、按钮或弹窗变化时同步对应专题。
2. 导演工作区已覆盖 `分镜卡片字段/首帧尾帧生成`、`分镜口播/批量配音` 和 `预告片分镜挑选与复用` 专题；导演、S级、视角切换或四宫格变化时同步对应专题。
3. 设置页云端AI文档已覆盖 `供应商添加/编辑弹窗字段参考`、`多 Key 管理`、`同步模型` 和 `模型测试错误说明`；服务映射或 Agent 绑定变化时同步配置文档。
4. 图床配置已覆盖添加/编辑弹窗、高级字段、平台预设和常见失败；上传链路或图床协议变化时同步图床文档。
5. 辅助工作台已被全屏 ComfyUI 工作区取代（2026-09-10）；旧三篇已标注过时。「本地模型」页与设置页 ComfyUI 引擎卡已有专篇；MCP、图片规格和自媒体于 2026-09-20 补齐。
6. 时间线文档区分 Remotion 正式渲染、video-use/HyperFrames 媒体辅助、Headless Shell、bundle 与 evidence；静态检查和单元测试不等于真实章节生成、打包或发布验收。

继续补文档时，要求：

- 先读当前源码，不沿用旧界面印象。
- 用户操作文档按功能域放在 `docs/{workflow,assets,director,panels,settings}/`，工程文档放在 `docs/engineering/`。
- 方案、技术调查和未来计划放在 `docs/融合/`，外部参考资料放在 `docs/融合/参考/`。
- 新增文档必须更新 [文档中心](../README.md)、[英文文档索引](../README.en.md) 和 [文档维护清单](./DOCS_MAINTENANCE.md)。
- 新增或改链接后必须跑链接和索引覆盖检查。
