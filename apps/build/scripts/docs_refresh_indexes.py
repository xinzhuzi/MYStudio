"""Connect new guides and align present-day documentation entry points."""
from docs_refresh_batch import ROOT, update
update('docs/README.md',[
 ('| [页面导航](./panels/NAVIGATION_GUIDE.md)', '| [自媒体发布台](./panels/SELF_MEDIA_GUIDE.md) | 账号、内容发布、定时任务与发布历史；能力以平台和账号状态为准 |\n| [页面导航](./panels/NAVIGATION_GUIDE.md)'),
 ('| [ComfyUI 引擎指南](./settings/COMFYUI_ENGINE_GUIDE.md)', '| [MCP 服务](./settings/MCP_SERVICES_GUIDE.md) | 服务登记、连接测试、JSON 导入导出与配置边界 |\n| [图片规格](./settings/IMAGE_SIZE_GUIDE.md) | 默认生图引擎、画幅、分辨率与兼容选项 |\n| [ComfyUI 引擎指南](./settings/COMFYUI_ENGINE_GUIDE.md)'),
 ('四层流水线定位（H3 生成→remotion 组装→hy 装饰→video-use 交付）', '素材到成片链（H3→Remotion shots→video-use 审阅→用户确认/HyperFrames→章节渲染）'),
 ('本地视频引擎定制安装计划（零成本草图/选镜定位，不进生产管线）', '2026-08-22 独立 Comfy Desktop 部署历史；现行 H3 已接入托管引擎，见产线知识库'),
 ('3D 纵深、景深散焦与相机运动玩法（实验性路线，当前出片主线为 2D panZoom + 特效）', '2026-08 实验性 3D 玩法记录；现行素材与渲染入口以完整视频链路为准'),
 ('当前 Toonflow 对照缺口、未迁移能力和 Trellis 目标', '2026-07 Toonflow 对照缺口与六目标推进记录；不作当前开放任务列表'),
 ('从小说导入到成片生产的完整产品链路', '融合设计与历史阶段划分；当前操作查 workflow/'),
 ('工作流、资产、分镜、导出等核心数据结构', '2026-05 起草的目标数据模型；字段契约以当前 types 与 schema 为准'),
 ('Electron 打包、安装、测试和工程化约束', '2026-08 部署基线和后续规划；当前发布查 engineering/'),
])
update('docs/panels/NAVIGATION_GUIDE.md',[
 ('- [支持作者与反馈](../settings/SUPPORT_GUIDE.md)', '- [支持作者与反馈](../settings/SUPPORT_GUIDE.md)\n- [MCP 服务](../settings/MCP_SERVICES_GUIDE.md)\n- [图片规格](../settings/IMAGE_SIZE_GUIDE.md)\n\n自媒体账号、发布和任务说明见[自媒体发布台](./SELF_MEDIA_GUIDE.md)。'),
])
update('docs/engineering/DOCS_COVERAGE_AUDIT.md',[
 ('【缺口】暂无用户文档（工程边界见 [自媒体 / AiToEarn 集成边界](./self-media-aitoearn-integration.md)）', '[自媒体发布台](../panels/SELF_MEDIA_GUIDE.md)；工程边界见 [自媒体 / AiToEarn 集成边界](./self-media-aitoearn-integration.md)'),
 ('【缺口】设置页现含「MCP 服务」页签，暂无文档', '[MCP 服务](../settings/MCP_SERVICES_GUIDE.md)'),
 ('【缺口】设置页现含「图片规格」页签，暂无文档', '[图片规格](../settings/IMAGE_SIZE_GUIDE.md)'),
 ('「本地模型」页（画布/配音室/漫影生图）与设置页 ComfyUI 引擎卡是当前最大文档缺口，建议单独成篇。', '「本地模型」页与设置页 ComfyUI 引擎卡已有专篇；MCP、图片规格和自媒体于 2026-09-20 补齐。'),
 ('`小说导入/剧本策划`、`剧本资产管理/剧情产物生成` 和 `分镜表/剪辑工作台`', '`小说导入/剧本生产阶段`、`剧本资产管理/剧情产物生成职责` 和 `分镜面板/视频工作台`'),
 ('时间线 renderer 已覆盖全局选择、Remotion Player/Headless Shell、FFmpeg 兼容入口、bundle/compositor 打包和 renderer-specific evidence；真实 Daojie 双链仍按 Remotion Trellis 任务的 AC11 状态单独报告。', '时间线文档区分 Remotion 正式渲染、video-use/HyperFrames 媒体辅助、Headless Shell、bundle 与 evidence；静态检查和单元测试不等于真实章节生成、打包或发布验收。'),
])
p=ROOT/'docs/engineering/DOCS_MAINTENANCE.md'
src=p.read_text();start=src.index("```bash\nnode <<'NODE'");end=src.index('\n```',start)+4
update(p.relative_to(ROOT),[
 (src[start:end], '```bash\npython3 apps/build/scripts/docs_current_audit.py \\\n  --output .trellis/tasks/09-20-docs-current-alignment/research/audit.json \\\n  --check-links\n```\n\n脚本使用仓库已安装的 markdown-it 解析 Markdown 与 HTML 本地链接，并输出逐篇清单、不可达文档、源码路径和 npm 命令待核项；不抓取外部链接，也不验证标题锚点。上例输出属于本轮任务，后续维护改为对应任务的 research 路径。历史路径、外部项目路径和示例命令须逐项裁定，不能一律视为坏链；旧正则会误认节点编号及含括号的图片路径，已不作为验收入口。'),
 ('应用级 Node 22', 'Electron 内置 Node（运行时要求 >=22）'),
 ('`panels/LOCAL_MODELS_GUIDE.md`、', '`panels/SELF_MEDIA_GUIDE.md`、`panels/LOCAL_MODELS_GUIDE.md`、'),
 ('`settings/COMFYUI_ENGINE_GUIDE.md`、`settings/PYTHON_TTS_SETUP.md`', '`settings/COMFYUI_ENGINE_GUIDE.md`、`settings/MCP_SERVICES_GUIDE.md`、`settings/IMAGE_SIZE_GUIDE.md`、`settings/PYTHON_TTS_SETUP.md`'),
 ('| 产物页上传、文件夹、预览、导出变化 |', '| 自媒体账号、发布能力或定时任务变化 | `panels/SELF_MEDIA_GUIDE.md`、`engineering/self-media-aitoearn-integration.md` |\n| 产物页上传、文件夹、预览、导出变化 |'),
])
update('docs/README.en.md',[
 ('Novel Import -> Script Planning -> Asset Extraction -> Production Generation -> Storyboard Table -> Remotion Shot Jobs -> Native Remotion Studio -> ChapterVideo MP4', 'Novel / Script -> Assets / Storyboards -> Shot Materials / TTS -> Remotion Shot Jobs\n-> video-use Preview and Review -> User Confirmation -> HyperFrames / EditingProject\n-> Native Remotion Studio -> ChapterVideo MP4 -> Final QC'),
 ('while project JSON data stays under `<storageBasePath>/projects`.', 'while project data lives at its registered project folder. Only legacy projects fall back to `<storageBasePath>/projects/_p/<id>`. The unified storage export does not include external project folders.'),
 ('**60 built-in** art styles', 'Built-in art styles'),
 ('[Browse all 60 art styles →]', '[Browse the art style gallery →]'),
 ('After opening a project, open `Workflow` on the left:', 'After opening a project, open `MY 工作流` (MY Workflow). The current eight tabs retain their Chinese UI labels below:'),
 ('1. `Novel Import`: import `.txt/.md` files or paste the source text.\n2. `Script Planning`: generate the story skeleton, adaptation strategy, script draft, and review report.\n3. `Script Asset Management`: extract characters, scenes, and props from scripts and match them with the asset library.\n4. `Production Generation`: run director planning and fill missing character, scene, and prop images.\n5. `Storyboard Table`: generate storyboard rows and maintain duration, dialogue, and visual assets.\n6. `Storyboard / Shot Jobs`: review each shot\'s AI material and render one Remotion `StoryboardShot` MP4 per shot.\n7. `Video Workbench`: open the native Remotion Studio for the current chapter and render one Remotion `ChapterVideo` MP4.', '1. `风格与导演`: select visual and directing guidance.\n2. `小说导入`: import chapters from text files or pasted text.\n3. `剧本生产阶段`: event analysis, story structure, adaptation, script generation and review.\n4. `剧本资产管理`: extract, match and maintain characters, scenes and props.\n5. `分镜视频生成`: ComfyUI chapter workflow canvas.\n6. `分镜面板`: shot cards, material/voice operations and chapter video preparation.\n7. `图像节点图`: ComfyUI image workflow canvas.\n8. `视频工作台`: review the chapter workflow and edit/render through native Remotion Studio.\n\nThe chapter automation prepares shot jobs and video-use preview, then stops for user review; it does not automatically approve a revision or publish a final cut.'),
 ('| [Settings Panel Operations]', '| [MCP Services](settings/MCP_SERVICES_GUIDE.md) | Register services, test connections, and import/export JSON configuration |\n| [Image Defaults](settings/IMAGE_SIZE_GUIDE.md) | Default engine, aspect ratio, resolution and compatibility options |\n| [Self-media Publishing](panels/SELF_MEDIA_GUIDE.md) | Accounts, drafts, scheduled tasks and publishing history |\n| [Settings Panel Operations]'),
 ('32 GB+; local full-song generation (Music3 bf16) requires **48 GB+** (hard gate 44 GB) — otherwise use the lightweight MusicGen', '32 GB+ as a starting point; check each selected workflow and model. H3 and large music/image workflows can require substantially more memory'),
 ('50 GB+ SSD, plus local models on demand (music weights ~28.5 GB, ComfyUI image-generation weights in the tens of GB; all downloaded explicitly)', '50 GB+ SSD, plus the actual model inventory; large image/video workflows require additional space and explicit provisioning'),
 ('Node.js >= 18 (latest LTS recommended)', 'End users do not need a separate Node installation; the app carries its runtime. Source development currently requires Node.js >=22.12.0 (installed Electron package constraint)'),
 ('- Node.js >= 18\n', '- Node.js >=22.12.0 (verify against the installed dependency engines when upgrading)\n'),
 ('`Settings -> Python Configuration`', '`Settings -> Local Configuration -> Python runtime`'),
])
update('docs/panels/LOCAL_MODELS_GUIDE.md',[
 ('约快一倍，细节保留约 95%（步数只有 4 / 6 两档）', '步数可选 4 / 6 两档；速度和画质依模型、输入及设备而变，UI 估算文案不是本轮性能测试结果'),
])
