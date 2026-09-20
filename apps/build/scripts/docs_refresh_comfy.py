"""Apply reviewed 2026-09-20 Comfy documentation corrections only."""
from docs_refresh_batch import ROOT, update

paths = {p.name: p.relative_to(ROOT) for p in (ROOT/'docs/comfyui-kb').glob('*.md')}
update(paths['定制代码地图.md'], [
 ('事实与本文冲突时以本文为准并更新本文。', '事实与本文冲突时，以当前源码和可复现实证为准，并同步修正文档。2026-09-20 核对了运行时路径、节点注册及零文件注入链；历史实测按原日期保留。'),
 ('http://127.0.0.1:17001(真源=manifest.json;', 'http://127.0.0.1:<实际端口>(真源=manifest.json;'),
 ('| 引擎 | `127.0.0.1:17001` | 端口真源=manifest `status.port`;冷门端口铁律 |', '| 引擎 | `127.0.0.1:<实际端口>` | 真源为 manifest 的 `engine.port` 与设置页实时状态；冲突时在 17000–17999 范围选择，不固定为 17001 |'),
 ('测试/定制用;默认解析=开发兜底 `~/.manying-dev`', '测试/定制用；装机默认 `<userData>/comfyui`，纯开发兜底 `~/.manying-dev/comfyui`'),
 ('(渲染层→库+引擎)', '(渲染层→引擎画布)'),
 ('分镜流程链工作流(节点 `properties.myPreview` 携名)导入库 `分镜/0_工作流主线/`(09-11 起保鲜产物=七环节链+网格;`分镜/1_总览/` 为旧写入位残留;09-14 晚改根自「漫影/1_图片/分镜/」)', '读取只读通用模板 `repo:0_分镜/分镜工作流.json`，克隆并注入当前章载荷后直接 `loadGraphData`；不导出工作流 JSON、不写用户库'),
 ('漫影八节点(第 8 枚=MyDaojieBase 道劫底座,09-18)', '11 个 canonical `My*` 节点（2026-09-20 注册表快照，旧别名另计）'),
 ('**道劫底座节点**(09-18,第 8 枚自研节点)', '**道劫底座节点**(09-18 加入)'),
 ('| `web/sidebar.js`+`sidebar-chrome.js`+`theme.js` 等 |', '| `nodes/my_daojie_loras.py` / `my_daojie_lora_stack.py` / `my_charsheet_labels.py` | 道劫按型 LoRA、LoRA 栈、角色设定表标签；对应 `MyDaojieLoras` / `MyDaojieLoraStack` / `MyCharsheetLabels` |\n| `web/sidebar.js`+`sidebar-chrome.js`+`theme.js` 等 |'),
 ('保鲜(指纹守卫=分镜+环节计数/缩略上传/入库落位**0_工作流主线**)', '保鲜（分镜/环节指纹守卫、缩略与封面上传；不再导出工作流 JSON）'),
 ('双家同步命令(`apps/backend` 下):', '以下是写运行副本的开发调试命令（从 `apps/backend` 执行），不是只读检查，也不属于文档核验步骤。先确认目标家与当前运行实例；装机定稿仍须通过正式打包入口，不能只同步副本：'),
 ('- **架构(09-14 晚二次裁定:引擎家 workflows 恒无漫影)**:①静态自研真源=仓库 `apps/backend/engines/comfyui/workflows/`(36 个 MY- 文件:K2图像/H3视频/音乐;`plugin_manager.list_workflows` 以 `repo:` id 只读合并);②分镜产线动态流=引擎家用户区新根 `分镜/`(0_工作流主线/1_总览/2_单镜图/3_单镜视频);③旧「漫影/」根已由 `apps/build/scripts/engine_workflows_reroot.py` 迁净(幂等;旧装机代码回写旧位时重跑即清);④原生浏览器树对「漫影/」「分镜/」双根全剔(my_module_policy.js `filterUserDataWorkflowEntriesDropMy`),漫影内容只在漫影侧栏可见。', '- **当前架构（2026-09-20）**：静态模板真源为 `apps/backend/engines/comfyui/workflows/`，以 `repo:` id 只读合并；用户另存副本落配置的用户工作流目录（默认 `<引擎源码>/user/default/workflows`）。库文件已废弃 `MY-` 前缀，实时数量查[工作流清单](./漫影工作流清单.md)。分镜主线与单镜视频均运行时注入直开，没有逐章/逐镜写入位。'),
 ('MyShot 实体退役(DEPRECATED,H3 直达并入单镜生产面板行)', '逐镜工作流文件退役；`MyShot` 仍是单镜视频模板的展示/回写锚点，旧 `ManyingShot` 才是兼容别名'),
 ('动态区(`分镜/0_主线` 等)由保鲜链自动覆写,手工改本就无效。', '当前分镜载荷在内存中注入，旧动态目录不再是生产写入位。'),
 ('- **写入方**:流程链保鲜(09-11)→', '- **历史写入方（2026-09-11 至 09-14 早期，已被零文件注入取代）**:流程链保鲜→'),
 ('存到 `漫影/2_视频/H3视频/1_漫影自研/`(ComfyUI 另存时选该夹);攒出功能维度再下分子夹', '手工实验先另存到当前配置的用户工作流目录；固定仓库模板按视频域分类且保持只读，所有者批准纳入产品后再更新仓库清单'),
 ('- **09-14 晚·工作流库去漫影化(引擎家恒无「漫影」)**:', '- **历史迁移快照（09-14 早期，动态根随后被零文件注入取代）**:'),
 ('- **已装机**(09-11 六轮打包链全绿):', '- **历史装机记录**(2026-09-11 六轮打包链全绿，不代表本轮重新打包验证):'),
])
update(paths['漫影工作流清单.md'], [
 ('分镜域**不设任何实体文件**', '运行时分镜域**不生成逐章/逐镜工作流文件**'),
 ('**无写入位、无实体**——', '**运行时无逐章/逐镜写入位**——'),
 ('引擎 userdata 恒零分镜文件(实证已清空)', '运行时不向引擎 userdata 写入分镜文件；旧安装残留需另行核验'),
 ('**无工作流库**(实证为空,勿在那里找)', '早期盘点为空；不是永久约束。当前以运行实例的 manifest 与设置页目录为准'),
 ('| `2_视频/H3视频/1_漫影自研/0_单镜视频/` | 1 | `单镜视频 · chapter-001 · S01` |', '| `2_视频/H3视频/1_漫影自研/0_单镜视频/` | 1 | `单镜视频 · chapter-001 · S01`（2026-09-14 首跑历史样本，非运行时真源；保留追溯） |'),
 ('## 0_分镜 / 分镜产线(**零实体**,仓库模板 1 个)', '## 0_分镜 / 分镜产线（运行时零文件，通用模板 1 个）'),
 ('**09-15 用户裁定:分镜域不应有实体——由上游(漫影 App)控制走分镜工作流生图生视频的逻辑。**', '**09-15 用户裁定：由漫影 App 控制分镜生图/生视频，运行时不生成逐章/逐镜工作流文件。** 仓库仍保留上表 S01 首跑样本，不能把运行时零文件说成仓库不存在历史样本。'),
 (';显示名裁定不变。旧键以 DEPRECATED 别名保留', '；后续增加 `MyStylesLibrary`、`MyDaojieBase`、`MyDaojieLoras`、`MyDaojieLoraStack`、`MyCharsheetLabels`，2026-09-20 canonical 注册共 11 个。旧 `Manying*` 键以 DEPRECATED 别名保留'),
 ('引擎家 input/(`~/Library/Application Support/漫影工作室/comfyui/input`)', 'manifest 配置的 `inputDir`（设置页查看实际目录）'),
])
update(paths['分镜H3视频产线.md'], [
 ('H3(素材生成层,新建)—— 每镜 5.167s 真动态画面+画内声(音画同炉)\n   ↓ 产出装进\nremotion(组装渲染层,既有)—— current.mp4 槽+时间线+转场+字幕+混音+导出\n   ↑ 叠 alpha overlay            ↑ 打包 EDL\nhy:hyperframes(装饰层,既有)   video-use(成片使用层,既有)', 'H3 生成单镜素材 → Remotion shots 写 current.mp4\n   → video-use 生成可审阅的章节 EDL\n   → 用户确认 → HyperFrames 装饰与 EditingProject 投影\n   → Remotion 章节渲染 → QC / 导出'),
 ('## 五、漫影自研单镜工作流(应用写入物)', '## 五、漫影自研单镜工作流（运行时组装直开）'),
 ('ManyingShot', 'MyShot'),
 ('manying-shot-h3-{safeId}.jpg', 'my-shot-h3-{safeId}.jpg'),
 ('→生成→写库 `漫影/2_视频/H3视频/1_漫影自研/0_单镜视频/单镜视频 · {章} · S{NN}.json`→单实例协议打开', '→组装器克隆模板并注入→`loadGraphData` 直接打开，不写用户库。当前生成器返回临时画布名 `MY-单镜视频 · {章} · S{NN}`；这是内存画布名，不能与已去 `MY-` 前缀的仓库文件名规则混同'),
 ('模板锁 `none`+回归断言;排障先看引擎日志 validation 段,别信前端表象', '2026-09-14 排障曾改为 `none`。2026-09-20 静态核对发现 I2V 的按位/具名字段不一致，Ref2VA 仍是 taeh3；详见参数速查。先核对实际加载图与 object_info，不宣称两个模板均已锁定'),
 ('## 八、实测账本', '## 八、历史实测账本（2026-09-14，未在本轮重跑）'),
 ('## 十、待办(按依赖序)', '## 十、2026-09-14 待办记录（历史快照，执行前核对当前任务）'),
])
update(paths['参数速查.md'], [
 ('标注三态:', '2026-09-20 仅核对当前仓库模板与入口；性能数字仍属于原日期的历史实测，本轮未重新生成。\n\n标注三态:'),
 ('h3-shot-template_my.json=单段直出:ResolutionSelector multiple 0.98→1344×768 原生(默认)/0.2→测试档;', '`apps/frontend/lib/assist/image-studio/MY-h3-shot-template.json`=I2V 单段直出：ResolutionSelector 按位 `megapixels=0.98`、`multiple=32`，具名字段仍为 `megapixels=0.2`；'),
 ("ModelPreviewOverrideKJ 的 tiny_vae 必须为 'none'(引擎列表只有它,taeh3 值=验证整图打回)", "09-14 曾因引擎只列 none 而修复 tiny_vae。09-20 静态核对：I2V 按位 tiny_vae=none、具名值仍为 taeh3.safetensors；Ref2VA 变体两处均为 taeh3.safetensors，且分辨率同样存在按位/具名漂移。模板尚未统一，实际序列化值和引擎校验需另验；本轮不改固定 JSON"),
 ('库内模板=`漫影/2_视频/H3视频/1_漫影自研/MY-H3-导演台-双段衔接-本机版.json`', '当时实验模板=`漫影/2_视频/H3视频/1_漫影自研/MY-H3-导演台-双段衔接-本机版.json`（历史路径，当前库不存在，不作为现行入口）'),
 ('| 改图子目录 | 漫影/1_图片/K2图像/3_改图/:', '| 改图子目录 | 仓库只读 `1_图片/K2图像/3_改图/`：'),
 ('| | **ModelPatch 仅限编辑流** |', '| **ModelPatch 仅限编辑流** |'),
 ('顽固时退出 Desktop,清', '以下仅为独立 Comfy Desktop 的旧排障记录，不用于当前托管引擎：顽固时退出 Desktop,清'),
])
update(paths['分镜图生成与超分指引.md'], [
 ('(ManyingShot 网格)', '（当前 `MyShot` 锚点；旧 `ManyingShot` 为兼容别名）'),
 ('(`h3-shot-template.json`)', '（`apps/frontend/lib/assist/image-studio/MY-h3-shot-template.json`）'),
 ('默认 multiple=0.98→1344×768 原生档;测试档切 0.2→608×352', 'ResolutionSelector 的按位 `megapixels=0.98` 为原生档，测试档为 0.2；`multiple=32`。具名字段残留值与 tiny_vae 漂移见[参数速查](./参数速查.md)，不得据此宣称两种模板均已统一'),
 ('引擎家工作流库 `3_超分后处理/SeedVR2` 保留为手动后处理入口', '仓库只读 `2_视频/H3视频/3_超分后处理/社区-视频文件直接超分-SeedVR2.json` 保留为手动后处理入口'),
])
