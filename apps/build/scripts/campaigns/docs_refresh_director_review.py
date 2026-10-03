"""Apply the reviewed 2026-09-20 documentation corrections, no product writes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]

def edit(name, pairs):
    path = ROOT / name
    text = path.read_text()
    before = text
    for old, new in pairs:
        if old not in text and new in text:
            continue
        if text.count(old) != 1:
            raise ValueError((name, old[:90], text.count(old)))
        text = text.replace(old, new, 1)
    if text != before:
        path.write_text(text)
        assert path.read_text() == text
        print(name)

edit('docs/workflow/OVERVIEW_PANEL_OPERATIONS.md', [
 ('本文补充 `项目概览` 的可点击控件、内联编辑、分集目录和右侧摘要细节。', '本文补充 `项目概览` 的工作流门户、内联编辑和实体资料操作，按 2026-09-20 源码核对。'),
 ('## 两栏布局\n\n概览页使用左右两栏布局：\n\n| 区域 | 内容 |\n|---|---|\n| 左栏 | 故事核心、世界观、制作设定、分集目录 |\n| 右栏 | 角色、阵营、关键物品、地理设定 |\n\n中间有可拖动分隔条。拖动分隔条可以调整左右栏宽度。',
  '## 页面布局\n\n页面使用单一滚动区：上方为工作流门户，下方为项目概览资料卡。故事核心、世界观、制作设定、角色、阵营、关键物品和地理设定在资料卡内竖向排列，没有左右拖动分隔条。门户在有无 `seriesMeta` 两种状态下都可用。'),
 ('## 分集目录', '## 历史分集目录（当前概览已不提供）\n\n> 以下分集卡片、新建、编辑标题与删除行为是旧界面记录，不是当前操作说明。2026-09-20 的概览只读取分集数据以显示集数，不渲染这些控件；当前章节制作入口见 [工作流阶段操作手册](./WORKFLOW_STAGE_OPERATIONS.md)。'),
 ('## 右侧资料摘要\n\n右侧用于检查 AI 分析或剧本导入后沉淀出的实体资料：',
  '## 当前实体资料区\n\n项目概览卡内竖向展示 AI 分析或导入后沉淀出的实体资料：'),
 ('| 角色 | 最多显示前 20 个角色。角色会显示主角、配角标签、年龄和角色说明。超过 20 个时显示剩余数量。 |',
  '| 角色 | 完整展示角色列表，可添加角色、编辑姓名和身份/背景、删除角色资料；已有性别和标签作为附加信息展示。 |'),
 ('右侧摘要不是完整资产库。', '概览资料区不是完整资产库。'),
 ('### 点击分集后没有看到预期内容\n\n确认当前项目存在该集的剧本、分镜或工作流数据。分集卡片只负责进入分集上下文，不会自动生成缺失内容。',
  '### 找不到分集卡片\n\n当前概览只显示集数，不提供分集卡片。请通过上方工作流门户进入当前章节的制作阶段。'),
 ('### 右侧角色或阵营为空', '### 角色或阵营资料为空'),
])
edit('docs/workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md', [
 ('分镜表协议已扩为 16 列。', '分镜表正式协议为 15 列（2026-09-20 已按序列化器复核，见下文）。'),
 ('> 当前实现（2026-07-30）：', '> 章节生产边界（2026-09-20 复核，旧面板布局仅作历史参考）：'),
 ('分镜面板 -> Remotion 视频生产 -> 视频工作台', '分镜视频生成 / 分镜面板 -> Remotion StoryboardShot -> video-use 草稿 -> 用户确认 -> HyperFrames overlay 或 no-op -> 视频工作台原生 Remotion Studio -> ChapterVideo'),
 ('## 分镜面板页面结构', '## 历史分镜编辑界面\n\n> 从本节到「AI 分镜表协议」之前，保留旧两栏编辑器的操作记录；当前分镜面板为卡片网格，图像节点图与分镜视频生成使用 ComfyUI。此处的两栏、素材区和旧按钮不作为当前导航依据。'),
 ('表格必须是 14 列：', '当前生成与序列化的标准表格为 15 列；第 15 列保存出镜语义 JSON。协议依据为 `apps/frontend/assets/studio-manuals/production_execution_storyboard_table.md` 与 `apps/frontend/lib/studio/storyboard-table.ts`：'),
 ('| 13 | 声音 |\n| 14 | 关联资产 ID |', '| 13 | 音效 |\n| 14 | 关联资产 ID |\n| 15 | 出镜语义JSON |'),
 ('- 列数不是 14 列的行会记为错误。', '- 解析器接受 15 列标准输入，并兼容旧 14 列及分组式 8/7 列输入；其他列数记为错误。兼容读取不等于新输出可以省略出镜语义列。'),
 ('## 外部视频 Skill 的旁路位置', '## video-use 与 HyperFrames 的接力位置'),
])
for name in ['ADVANCED_DIRECTOR_TOOLS.md', 'TRAILER_STORYBOARD_REUSE_REFERENCE.md']:
    p = ROOT / 'docs/director' / name
    s = p.read_text()
    pairs = [(a,b) for a,b in [('`工作流 -> 分镜表`','`工作流 -> 分镜面板`'),('`工作流 -> 剪辑工作台`','`工作流 -> 视频工作台`'),('`剪辑工作台`','`视频工作台`'),('逐个生成后再进入剪辑工作台拼接。','逐个生成后按章节审核与素材门禁进入视频工作台。')] if a in s]
    for a,b in pairs: s=s.replace(a,b)
    p.write_text(s)
    assert p.read_text()==s
    print(p.relative_to(ROOT))
edit('docs/director/LEGACY_SCRIPT_WORKSPACE_GUIDE.md', [('`工作流 -> 小说导入`、`策划编剧` 和 `分镜面板`', '`工作流 -> 小说导入`、`剧本生产阶段` 和 `分镜面板`')])
edit('docs/director/DIRECTOR_SHOT_CARD_REFERENCE.md', [
 ('- 分镜表字段、素材绑定和本地 FFmpeg 剪辑见 [分镜表与剪辑工作台操作参考](../workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md)。',
  '- 当前章节链为 `StoryboardShot -> video-use -> 用户确认 -> HyperFrames -> 原生 Remotion Studio -> ChapterVideo`；门禁与正式输出见 [完整视频生产链路](../workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md)，表格协议与旧面板说明见 [分镜面板与视频工作台操作参考](../workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md)。'),
])
edit('docs/workflow/WORKFLOW_ASSET_GENERATION_OPERATIONS.md', [
 ('`MY 工作流` 页中 `剧本资产提取` 和 `剧本资产管理` 相关操作。', '`MY 工作流 -> 剧本资产管理` 页内的资产提取和管理操作。'),
 ('本文旧阶段导航路径按此对应阅读。', '本文操作路径已按现行页签同步。'),
 ('策划编剧\n  -> 剧本资产提取：从剧本草稿提取角色、场景、道具\n  -> 剧本资产管理：承接提取结果，落地衍生资产、单项资产和角色音频',
  '剧本生产阶段：生成剧本草稿\n  -> 剧本资产管理：在页内提取角色、场景、道具，再落地衍生资产、单项资产和角色音频'),
 ('`剧本资产提取` 的输入是每章的剧本草稿。没有剧本草稿时，页面会提示先回到 `策划编剧`。', '资产提取的输入是每章的剧本草稿。没有剧本草稿时，先回到 `剧本生产阶段`。'),
 ('工作流 -> 剧本资产提取\n', '工作流 -> 剧本资产管理 -> 提取资产\n'),
 ('| 检查本集剧本缺哪些角色、场景、道具 | 工作流 -> 剧本资产提取 |', '| 检查本集剧本缺哪些角色、场景、道具 | 工作流 -> 剧本资产管理 -> 提取资产 |'),
 ('在 `策划编剧` 中生成剧本草稿。', '在 `剧本生产阶段` 中生成剧本草稿。'),
 ('| 批量润色当前剧本用到的资产提示词 | 资产 -> 角色库、场景库或道具库 |', '| 批量润色当前剧本用到的资产提示词 | 资产 -> 角色、场景或道具 |'),
 ('需要批量润色时进入 `资产 -> 角色库`、`场景库` 或 `道具库`。', '需要批量润色时进入 `资产 -> 角色`、`场景` 或 `道具`。'),
 ('该批量栏位于 `资产 -> 角色库`、`场景库` 或 `道具库`，', '该批量栏位于 `资产 -> 角色`、`场景` 或 `道具`，'),
])
p=ROOT/'docs/assets/ASSET_AUDIO_ASSIGNMENT.md'
s=p.read_text().replace('音频样本来自资产库的 `音频库`。','音频样本来自 `资产 -> 配音`（页面标题为 `配音库`）。').replace('资产 -> 音频库','资产 -> 配音').replace('资产 -> 角色库','资产 -> 角色').replace('- 角色库中存在角色。','- `资产 -> 角色` 中存在角色。').replace('- 音频库中存在可用音频。','- `资产 -> 配音` 中存在可用音频。')
p.write_text(s);assert p.read_text()==s;print(p.relative_to(ROOT))
edit('docs/assets/ASSET_LAYER_PROJECTIZATION_DECISION_20260903.md', [
 ('> 由 09-03 会话挂账任务二产出;拍板前严禁动任何数据。', '> 由 09-03 会话挂账任务二产出;拍板前严禁动任何数据。\n> **历史快照边界（2026-09-20）**：下文大小、计数、引用扫描和清理建议均为 2026-09-03 记录，本轮未重新测量业务数据。不得直接执行文末清理；需重新盘点、检查引用并获得明确删除授权。现行统一导出包含 `projects/`、`media/`、`assets/`、`skills/`，但不包含外部项目实体及位置登记，见 [存储与数据迁移](../engineering/STORAGE_AND_DATA.md)。'),
 ('**与架构裁定无关、但立即可做的收口**(无论选哪个方案都成立):', '**2026-09-03 提出的清理建议（未在本轮验证或授权执行）**:'),
])
