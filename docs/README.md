# 漫影工作室文档中心

这里整理 MYStudio 当前可用的用户手册、配置说明、开发资料和融合规划。文档按功能域分目录组织，新用户建议先读"工作流"，正在调试本地 TTS、音色分配或打包流程时，直接进入对应专题。

## 目录结构

| 目录 | 收纳范围 |
|---|---|
| [workflow/](./workflow/) | 工作流核心链路：小说导入、剧本、分镜、概览 |
| [assets/](./assets/) | 资产库、角色、场景、道具、视觉风格、音色 |
| [director/](./director/) | 导演工作台、S级镜头、视角切换、四宫格、旧剧本 |
| [panels/](./panels/) | 应用外壳、导航、项目、技能、辅助、产物、导出、TTS 面板 |
| [settings/](./settings/) | 设置页、API、Python/TTS 配置、图床、更新、许可证 |
| [engineering/](./engineering/) | 架构、打包、故障排查、三方声明、存储、文档维护 |
| [融合/](./融合/) | 规划与调查（含外部参考资料） |

## 工作流（workflow/）

| 文档 | 用途 |
|---|---|
| [基本工作流教程](./workflow/WORKFLOW_GUIDE.md) | 从剧本导入到分镜、素材、视频生成的基础流程 |
| [工作流阶段操作手册](./workflow/WORKFLOW_STAGE_OPERATIONS.md) | 七阶段按钮、状态、弹窗和数据关系 |
| [小说导入与策划编剧操作参考](./workflow/WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md) | 风格/导演手册、小说章节导入、事件分析、三阶段剧本生成和审核修复 |
| [剧本资产与 ProductionAgent 操作参考](./workflow/WORKFLOW_ASSET_GENERATION_OPERATIONS.md) | 资产提取、资产库匹配、提示词润色、缺失资产生成和角色音色入口 |
| [分镜面板与视频工作台操作参考](./workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md) | 素材导入、媒体引用、AI 分镜表协议、track 分组、本地合成和拼接成片 |
| [剧本导入格式示例](./workflow/SCRIPT_FORMAT_EXAMPLE.md) | 标准剧本格式、场景头、人物、对白和舞台指示示例 |
| [项目概览](./workflow/OVERVIEW_PANEL_GUIDE.md) | 编辑故事核心、世界观、制作设定和查看分集目录 |
| [项目概览操作手册](./workflow/OVERVIEW_PANEL_OPERATIONS.md) | 项目入口、内联编辑、分集目录、新建集和右侧资料摘要 |

## 资产与风格（assets/）

| 文档 | 用途 |
|---|---|
| [艺术风格库](./assets/art-styles.md) | 内置 60 种风格模板和预览入口 |
| [Art Style Gallery](./assets/art-styles.en.md) | 英文版内置风格模板和预览入口 |
| [资产库使用与存储](./assets/ASSET_LIBRARY_GUIDE.md) | 角色、场景、道具、音频资产的入口、详情、SQLite 存储和迁移边界 |
| [资产导入与管理](./assets/ASSET_IMPORT_AND_MANAGEMENT.md) | 添加角色/场景/道具、批量删除、多图管理、音频说话内容和道具目录 |
| [资产详情弹窗操作手册](./assets/ASSET_DETAIL_OPERATIONS.md) | 资产详情预览、图片操作、提示词润色、一键生成、音频转写、角色音色和删除 |
| [道具目录操作手册](./assets/PROPS_LIBRARY_OPERATIONS.md) | 本地道具目录、新建/重命名/删除文件夹、移动/重命名/删除道具 |
| [视觉风格管理](./assets/VISUAL_STYLE_MANAGEMENT.md) | 默认风格、我的风格、视觉手册编辑和 AI 提取风格词 |
| [视觉手册编辑器操作手册](./assets/VISUAL_MANUAL_EDITOR_OPERATIONS.md) | 视觉手册 Markdown 模块、参考图、打开目录、预览和保存行为 |
| [角色生成与衣橱](./assets/CHARACTER_GENERATION_GUIDE.md) | 内部角色生成、三视图、AI 校准信息和造型变体 |
| [场景库多视角与四视图](./assets/SCENE_MULTIVIEW_GUIDE.md) | 场景单图、联合图、四视图、切割和批量四视图 |
| [资产库音色分配](./assets/ASSET_AUDIO_ASSIGNMENT.md) | 从资产音频中给角色分配可克隆音色，并使用自动分配 |
| [角色音色分配与自动匹配参考](./assets/ROLE_AUDIO_ASSIGNMENT_REFERENCE.md) | 手动音色弹窗字段、自动分配规则、AI 语义匹配、试听和批量识别失败提示 |

## 导演与高级镜头（director/）

| 文档 | 用途 |
|---|---|
| [高级导演与 S级镜头](./director/ADVANCED_DIRECTOR_TOOLS.md) | 内部导演工作区、S级组级生成、视角切换和四宫格 |
| [导演分镜卡片与首尾帧生成参考](./director/DIRECTOR_SHOT_CARD_REFERENCE.md) | 导演分镜卡片字段、首帧/尾帧、参考图、提示词、视频生成和音频控制 |
| [导演分镜口播与批量配音参考](./director/DIRECTOR_VOICEOVER_REFERENCE.md) | 分镜口播、声线 profile、单条生成、批量生成缺失项和重试失败项 |
| [视角切换与四宫格操作手册](./director/ANGLE_AND_QUAD_GRID_OPERATIONS.md) | 首帧/尾帧视角切换、四宫格生成、结果应用、复制到其他分镜和失败排查 |
| [S级组级视频生成操作手册](./director/SCLASS_GROUP_VIDEO_OPERATIONS.md) | Seedance 2.0 分组生成、单镜生成、@引用、AI 校准、延长和编辑 |
| [预告片分镜挑选与复用参考](./director/TRAILER_STORYBOARD_REUSE_REFERENCE.md) | 旧剧本预告片挑选、Shot 到导演分镜转换、S级预告片复用和清空边界 |
| [兼容剧本编辑工作区](./director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md) | 旧剧本三栏编辑、AI 校准、预告片挑选和内部跳转 |

## 面板操作（panels/）

| 文档 | 用途 |
|---|---|
| [应用外壳操作手册](./panels/APP_SHELL_OPERATIONS.md) | 项目外/项目内侧栏、隐藏侧栏、项目头部、返回按钮、分集面包屑和保存状态 |
| [页面导航](./panels/NAVIGATION_GUIDE.md) | 项目内外主导航、工作流分区和设置分区说明 |
| [项目首页与项目管理](./panels/PROJECT_DASHBOARD_GUIDE.md) | 创建、打开、复制、重命名和删除项目 |
| [项目首页操作手册](./panels/PROJECT_DASHBOARD_OPERATIONS.md) | 侧栏按钮、管理选择、新建输入、更多菜单、重命名和批量删除弹窗 |
| [技能编辑](./panels/SKILLS_EDITOR_GUIDE.md) | 查看、编辑、新增、删除和恢复项目 Markdown 技能文件 |
| [技能编辑操作手册](./panels/SKILLS_EDITOR_OPERATIONS.md) | 技能页按钮状态、文件状态、新增路径、删除和恢复边界 |
| [辅助工作台](./panels/ASSIST_WORKBENCH_GUIDE.md) | 图片、视频、电影级拍摄和 TTS 临时生成工作台 |
| [辅助工作台操作手册](./panels/ASSIST_WORKBENCH_OPERATIONS.md) | 图片/视频/电影/TTS 子工作台按钮、参数、历史和保存到道具库 |
| [辅助工作台参数参考](./panels/ASSIST_WORKBENCH_PARAMETER_REFERENCE.md) | 图片、视频、Veo 上传、电影摄影参数、辅助 TTS 和生成历史字段说明 |
| [产物管理](./panels/MEDIA_OUTPUTS_GUIDE.md) | 上传、整理、预览、导出图片/视频/音频产物 |
| [产物页操作手册](./panels/MEDIA_OUTPUTS_OPERATIONS.md) | 上传、文件夹、视图、排序、右键菜单、导出和导演入口 |
| [成片与导出](./panels/EXPORT_GUIDE.md) | 查看渲染状态、选择文件夹导出和逐个下载素材 |
| [成片与导出操作手册](./panels/EXPORT_OPERATIONS.md) | 导出来源、序列图、导出进度、按钮禁用和二级卡片边界 |
| [TTS 面板操作手册](./panels/TTS_PANEL_OPERATIONS.md) | 本地 TTS 状态、模型目录、下载任务、模型详情弹窗和声线库 |
| [Voicebox 声音克隆流程](./panels/voicebox-voice-cloning-flow.md) | TTS 后端 API、profile、模型状态和声音克隆链路参考 |
| [外观皮肤与护眼模式](./panels/APPEARANCE_THEMES.md) | 护眼浅色模板、暗色影视模板和使用建议 |

## 设置与配置（settings/）

| 文档 | 用途 |
|---|---|
| [设置页操作手册](./settings/SETTINGS_PANEL_OPERATIONS.md) | 设置标签页、外观、API、Python、存储、更新、开发和支持入口的按钮状态 |
| [设置与 API 管理](./settings/API_SETTINGS_GUIDE.md) | 模型服务、模型映射、Agent 配置、图床和本地 TTS 服务说明 |
| [API 管理操作手册](./settings/API_MANAGER_OPERATIONS.md) | 添加供应商、同步模型、测试模型、思考模式、模型映射和 Agent 绑定 |
| [API 供应商字段与模型测试参考](./settings/API_PROVIDER_MODEL_TEST_REFERENCE.md) | 添加/编辑供应商字段、同步模型规则、模型测试范围、协议和错误说明 |
| [Python 与本地 TTS 配置](./settings/PYTHON_TTS_SETUP.md) | 设置页手动配置 Python 3.12、本地 TTS 依赖、模型缓存和启动方式 |
| [TTS 配置页](./settings/TTS_CONFIG_GUIDE.md) | 启动本地 TTS 后端、管理模型缓存、下载模型和创建声线 profile |
| [高级选项](./settings/ADVANCED_OPTIONS_GUIDE.md) | 视觉连续性、断点续传、内容审核容错和多模型自动切换 |
| [图床配置](./settings/IMAGE_HOST_CONFIG.md) | SCDN、ImgBB、Catbox、自定义图床和跨分镜图片上传配置 |
| [应用更新](./settings/APP_UPDATE_GUIDE.md) | 手动检查更新、启动自动检查、忽略版本和版本清单字段 |
| [开发模式与控制台](./settings/DEVELOPMENT_MODE.md) | 打开 DevTools、排查白屏和调试日志 |
| [许可证与商业授权说明](./settings/LICENSE_GUIDE.md) | AGPL-3.0、商业授权和联系入口 |
| [支持作者与反馈](./settings/SUPPORT_GUIDE.md) | 请作者喝杯咖啡、作者微信、问题反馈和商业授权区别 |

## 工程与发布（engineering/）

| 文档 | 用途 |
|---|---|
| [开发者架构与代码入口](./engineering/DEVELOPER_ARCHITECTURE.md) | 当前目录结构、前端/Electron/后端/TTS/打包模块索引 |
| [打包、安装与 Smoke 测试](./engineering/PACKAGING_AND_SMOKE_TESTING.md) | 本地验证、macOS 打包、覆盖安装和安装版 smoke 流程 |
| [常见故障排查](./engineering/TROUBLESHOOTING.md) | 白屏、Python、TTS、API、图床、存储和打包问题排查 |
| [第三方声明](./engineering/THIRD_PARTY_NOTICES.md) | 第三方组件和许可证声明 |
| [存储与数据迁移](./engineering/STORAGE_AND_DATA.md) | 项目存储位置、导入导出、指向已有数据目录和 legacy 迁移 |
| [文档覆盖审计](./engineering/DOCS_COVERAGE_AUDIT.md) | 当前界面、源码入口和用户文档的覆盖关系与维护方向 |
| [文档维护清单](./engineering/DOCS_MAINTENANCE.md) | 修改 UI、TTS、打包、存储或工作流后需要同步的文档和验证命令 |

## 融合规划（融合/）

| 文档 | 用途 |
|---|---|
| [融合规划文档索引](./融合/README.md) | 融合目录的阅读顺序和分类导航 |
| [小说到成片统一工作流计划](./融合/小说到成片·统一工作流计划.md) | 从小说导入到成片生产的完整产品链路 |
| [数据模型与接口规范](./融合/数据模型与接口规范.md) | 工作流、资产、分镜、导出等核心数据结构 |
| [部署打包与工程化手册](./融合/部署打包与工程化手册.md) | Electron 打包、安装、测试和工程化约束 |
| [错误处理与测试策略](./融合/错误处理与测试策略.md) | 运行时错误、回归测试、打包 smoke 和故障处理 |
| [外部参考资料](./融合/参考/) | Seedance 2.0 Skill OS 等外部仓库参考资料（非 MYStudio 官方文档） |

## 相关入口

| 文档 | 用途 |
|---|---|
| [项目 README](../README.md) | 项目定位、系统要求、开发启动和打包入口 |
| [本地 TTS 后端参考](../apps/backend/README.md) | Python sidecar 目录、启动方式、运行时目录、API 和测试入口 |

## 维护说明

- 用户操作类文档按功能域放在 `docs/{workflow,assets,director,panels,settings}/`。
- 工程与发布类文档放在 `docs/engineering/`。
- 长期方案、技术调查和融合计划放在 `docs/融合/`。
- 外部参考资料放在 `docs/融合/参考/`，须注明来源和适用边界。
- 新增或移动文档后，必须更新本索引、`DOCS_MAINTENANCE.md` 和 `DOCS_COVERAGE_AUDIT.md`，并跑链接校验脚本（见 `DOCS_MAINTENANCE.md`）。

English documentation starts at [README.en.md](./README.en.md).
