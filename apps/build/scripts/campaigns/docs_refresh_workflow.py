#!/usr/bin/env python3
"""Apply reviewed workflow-entry and engine-directory documentation corrections."""
from pathlib import Path
from docs_refresh_batch import ROOT, update

if __name__ == '__main__':
    # Each replacement is tied to current WORKFLOW_TABS, chapter runner or manifest.
    for name in ('WORKFLOW_GUIDE.md', 'WORKFLOW_STAGE_OPERATIONS.md', 'WORKFLOW_NOVEL_SCRIPT_OPERATIONS.md'):
        rel = f'docs/workflow/{name}'
        old = (ROOT / rel).read_text()
        pairs = []
        for before, after in (
            ('工作流 -> 策划编剧', 'MY 工作流 -> 剧本生产阶段'),
            ('工作流 -> 剧本资产提取', 'MY 工作流 -> 剧本资产管理（提取资产）'),
            ('进入 `工作流 ->', '进入 `MY 工作流 ->'),
            ('七阶段主流程', '当前八页签主流程'),
            ('## 3. 策划编剧', '## 3. 剧本生产阶段'),
            ('## 策划编剧\n', '## 剧本生产阶段\n'),
            ('## 策划编剧阶段', '## 剧本生产阶段的生成步骤'),
            ('先回到 `策划编剧` 生成剧本草稿', '先回到 `剧本生产阶段` 生成剧本草稿'),
        ):
            if before in old: pairs.append((before, after))
        update(rel, pairs)
    update('docs/workflow/WORKFLOW_GUIDE.md', [
        ('文中个别按钮文案如与当前界面有出入，以界面为准。', '以下操作入口已按 `WORKFLOW_TABS` 和章节编排器核对（2026-09-20）。'),
        ('系统只提交当前章节的 `StoryboardShot` jobs，不生成章节级 `ChapterVideo`，也不回退到旧迁移草稿片段或 FFmpeg。', '完整章节操作会补齐规划、分镜物料与配音，提交当前章 `StoryboardShot` jobs，等待 current slots 后自动运行 video-use，并停在视频工作台的用户审阅确认。它不会直接生成最终 `ChapterVideo`；单镜重试只提交指定镜头。'),
        ('1. 节点按当前章节动态 M 个分镜构建逐镜 plan', '1. 章节编排器按当前章节动态 M 个分镜构建逐镜 plan'),
        ('4. 全部 required shot current slots 成功后，节点才满足进入工作台的门禁。按钮的模型 `targetStage` 是 `workbench`，但一次提交不等于章节工作台或 ChapterVideo 已完成。', '4. 全部 required shot current slots 成功后，完整章节操作调用 video-use 生成预览。出现「请在视频工作台确认」时先审阅当前 revision；一次提交不等于最终 ChapterVideo 已完成。'),
    ])
    update('docs/workflow/WORKFLOW_STAGE_OPERATIONS.md', [
        ('本文旧阶段名/旧按钮（如「运行 AI 分镜计划」「添加分镜」「从章节生成」「生成当前章分镜视频」）如与当前界面有出入，以界面为准。', '下表按业务完成条件解释数据状态；ProductionAgent 与 Remotion 队列是内部职责，不是独立页签。'),
        ('| 策划编剧 |', '| 剧本生产阶段 |'),
        ('| 剧本资产 |', '| 剧本资产管理：资产提取 |'),
        ('| ProductionAgent |', '| 剧本资产管理：制作准备（内部 ProductionAgent） |'),
        ('| Remotion 视频生产 |', '| 分镜面板：Remotion 逐镜生产 |'),
        ('`策划编剧` 按章节逐步生成剧本资料。', '`剧本生产阶段` 按章节逐步生成剧本资料。'),
        ('## 剧本资产\n', '## 剧本资产管理：提取\n'),
        ('## ProductionAgent\n', '## 剧本资产管理：制作准备\n'),
        ('提交后，系统只为当前章节提交逐镜 `StoryboardShot` jobs：', '完整章节操作会补齐规划、分镜物料和配音，再提交当前章 `StoryboardShot` jobs；等待 current slots 后自动运行 video-use 预览，并提示到视频工作台确认。指定单镜重试只提交所选镜头：'),
        ('- 全部 required shot current slots 成功后，才满足进入 `workbench` 的章节工程门禁。', '- 全部 required shot current slots 成功后，继续生成 video-use 预览；预览、当前 revision 的用户确认及 HyperFrames overlay/no-op 门禁齐备后，才可准备正式章节工程。'),
        ('  -> 原生 Remotion Studio 章节工程', '  -> MLX 对齐 / video-use 预览与用户确认\n  -> EditingProject / HyperFrames overlay 或 no-op\n  -> 原生 Remotion Studio 章节工程'),
        ('修正后在 `Remotion 视频生产` 节点重试对应 shot', '修正后在 `分镜面板` 重试对应镜头'),
    ])
    update('docs/settings/COMFYUI_ENGINE_GUIDE.md', [
        ('ComfyUI 源码、独立 venv、`models/` 模型、`user/default/workflows` 工作流库、manifest 与实例锁。', '默认包括 `ComfyUI/` 源码、独立 `venv/`、`models/` 模型、manifest 与实例锁。用户工作流默认在 `<源码目录>/user/default/workflows/`；源码、venv、工作流等目录可在存储页迁移，实际位置以该页为准。'),
        ('| 工作流目录 | 内置模板与你的工作流库（`漫影/` 分组） |', '| 工作流目录 | 可写用户工作流库；默认 `<源码目录>/user/default/workflows/`。内置模板从应用自带仓库库只读合并，不随这一目录迁移 |'),
    ])
    update('docs/panels/LOCAL_MODELS_GUIDE.md', [
        ('工作流库（`漫影/` 分组按图片 / 视频 / 声音 / 参考分域）', '工作流库（仓库模板按 `0_分镜 / 1_图片 / 2_视频 / 3_声音` 分域；提示词参考资料在文档库）'),
        ('画布左侧「工作流」即工作流库管理界面（浏览 / 打开 / 改名 / 删除 / 建文件夹）。', '画布左侧「工作流」可浏览和打开模板。`repo:` 项来自应用自带工作流库，为只读模板；改名、删除、新建文件夹等写操作作用于用户库。修改模板时另存用户副本。'),
    ])
    p = ROOT / 'docs/director/ANGLE_AND_QUAD_GRID_OPERATIONS.md'
    pairs=[]
    for folder in ('angle-switch','quad-grid'):
        before=f'apps/frontend/components/{folder}/'
        pairs.append((before,f'apps/frontend/components/features/storyboard/{folder}/'))
    update(p.relative_to(ROOT),pairs)
    for name in ('DEVELOPER_ARCHITECTURE.md','PACKAGING_AND_SMOKE_TESTING.md','TROUBLESHOOTING.md','DOCS_MAINTENANCE.md','DOCS_COVERAGE_AUDIT.md'):
        p=ROOT/'docs/engineering'/name
        src=p.read_text()
        pairs=[]
        if 'sync_manying_nodes' in src: pairs.append(('sync_manying_nodes','sync_my_nodes'))
        if 'manying_nodes' in src: pairs.append(('manying_nodes','my_nodes'))
        update(p.relative_to(ROOT),pairs)
