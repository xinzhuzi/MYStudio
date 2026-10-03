"""One-shot documented path corrections; backups and before/after hashes retained."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/09-20-docs-current-alignment'
CHANGES = []

def edit(path, pairs):
    before = path.read_text()
    after = before
    for old, new in pairs:
        assert after.count(old) == 1, (str(path), old[:90], after.count(old))
        after = after.replace(old, new, 1)
    digest = hashlib.sha256(before.encode()).hexdigest()
    backup = TASK / 'backups/final' / digest[:12] / path.relative_to(ROOT)
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, backup)
    assert path.read_text() == before, f'Concurrent edit: {path}'
    path.write_text(after)
    assert path.read_text() == after
    CHANGES.append({'path': str(path.relative_to(ROOT)), 'before_sha256': digest,
                    'after_sha256': hashlib.sha256(after.encode()).hexdigest(),
                    'backup': str(backup.relative_to(ROOT)),
                    'replacements': [{'old': a, 'new': b} for a,b in pairs]})
    print(path.relative_to(ROOT))

edit(ROOT/'docs/engineering/DEVELOPER_ARCHITECTURE.md', [
    ('`frontend/config/electron-vite.config.ts` 的 `sharedAlias`', '`apps/frontend/config/electron-vite.config.ts` 的 `sharedAlias`'),
])
edit(ROOT/'docs/settings/PYTHON_TTS_SETUP.md', [
    ('默认 `video:daojie:chapter001` 不会设置该变量', '默认 `video:chapter001` 不会设置该变量（在 `apps/` 执行 `npm run video:chapter001`）'),
])
edit(ROOT/'docs/engineering/DOCS_MAINTENANCE.md', [
    ('`workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md`（已过时标注）', '`workflow/WORKFLOW_STORYBOARD_EDITING_OPERATIONS.md`（现行 15 列协议与视频工作台；旧两栏界面另标历史）'),
    ('- video-use 若接入，必须记录', '- video-use 已接入，维护时必须记录'),
])
for name in ['MYStudio_Toonflow_工作流缺口与分目标推进计划.md', 'Toonflow_MYStudio_分镜差异审计.md', '第一章自动成片与多角色口播Trellis计划.md']:
    p = next((ROOT/'docs').rglob(name))
    heading = p.read_text().splitlines()[0]
    edit(p, [(heading, heading + '\n\n> 命令映射（2026-09-20）：正文 `video:daojie:chapter001` 是原记录的旧脚本名；当前 `apps/package.json` 注册的是 `video:chapter001`，在 `apps/` 执行 `npm run video:chapter001`。这里仅核对入口存在，未运行真实媒体生成；旧命令、历史测试数和产物哈希继续保留原日期。')])

for name in ['四个视频Skill与MYStudio融合研究.md', '四个视频Skill与MYStudio版本更新与升级方案.md']:
    p=next((ROOT/'docs').rglob(name)); heading=p.read_text().splitlines()[0]
    pairs=[(heading, heading + '\n\n> 适用范围（2026-09-20）：本文保留 2026-08-08 至 08-10 的融合决策、版本快照与验收记录；后文“当前”“latest”、路径行号、性能和完成状态均属于当时，不表示本次复跑。当前用户步骤见[完整视频链路](../../workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md)，运行时与发布见[开发架构](../../engineering/DEVELOPER_ARCHITECTURE.md)和[打包指南](../../engineering/PACKAGING_AND_SMOKE_TESTING.md)。职责划分可作决策背景，具体接口和锁文件以现有源码为准。\n\n> 锁文件现址：`resolveVideoWorkflowRuntimePaths` 将 video-use lock 与 marker 解析到 `<storageBasePath>/python/profiles/video-use/requirements-video-use.lock` 和同目录 `profile.json`。`video-workflow-runtime-manager.ts` 在 staging 准备时把 `VIDEO_USE_LOCK_CONTENT` 写成 lock，再验证并激活；它不是仓库 `apps/backend/video_use/` 下的静态 lock。')]
    if '融合研究' in name:
        pairs.append(('`apps/backend/video_use/requirements-video-use.lock` + `<storageBasePath>/python` 的独立 profile marker', '原设计为仓库内 lock；现为 `<storageBasePath>/python/profiles/video-use/requirements-video-use.lock` + 同目录 `profile.json`（由 runtime manager 生成）'))
    else:
        pairs.append(('`apps/backend/video_use/requirements-video-use.lock` 和 profile marker。', '`<storageBasePath>/python/profiles/video-use/requirements-video-use.lock` 和同目录 `profile.json`（2026-09-20 路径更正：由 runtime manager 准备/激活，原仓库内 lock 是早期设计）。'))
    edit(p,pairs)
p=next(p for p in (ROOT/'docs').rglob('README.md') if p.parent.name=='参考')
edit(p,[('本目录存放**非 MYStudio 官方文档**的外部参考资料，仅供学习和技术调研使用。', '本目录同时保存外部参考资料与 MYStudio 基于外部项目形成的历史融合决策；两类资料按下文来源区分。'),('其中“融合研究”和“版本更新与升级方案”是 MYStudio 基于外部仓库形成的官方决策文档；表格','其中“融合研究”和“版本更新与升级方案”是 2026-08 的项目决策与验收快照，已在文首标明当前入口；表格')])
p=next((ROOT/'docs').rglob('模板系统与ComfyUI集成方案.md'))
edit(p,[('例如 `src/lib/studio/resources.ts` 对应 `apps/frontend/lib/studio/resources.ts`。','例如 `src/lib/studio/resources.ts` 是原方案中的模块路径；当前没有同名 `apps/frontend/lib/studio/resources.ts`，不能仅替换前缀就当作现存实现。')])
p=next((ROOT/'docs').rglob('配置中心升级与供应商能力方案.md'))
edit(p,[('- `apps/frontend/stores/api-config-store.ts`','- `apps/frontend/stores/ai/api-config-store.ts`（2026-09-20 现址更正）'),('`apps/frontend/stores/studio-config-store.ts` 仍存在','`apps/frontend/stores/app/studio-config-store.ts` 仍存在（2026-09-20 现址更正）')])
p=next((ROOT/'docs').rglob('部署打包与工程化手册.md'))
edit(p,[('1. 所有 Pull Request / push 先在 Ubuntu runner 执行 `npm ci`、`typecheck`、`lint`、\n   Vitest 和 `electron-vite build`。','1. 所有 Pull Request / push 先在 Ubuntu runner 通过 corepack 启用 pnpm，执行 `pnpm install --frozen-lockfile`、`npm run test:all` 和 `electron-vite build`；聚合质量门按脚本执行 typecheck、lint、测试及适用 smoke。'),('`apps/package.json` 与 `apps/package-lock.json`，在 Ubuntu 生成被 `.gitignore` 忽略的','`apps/package.json` 的版本；依赖安装读取 `apps/pnpm-lock.yaml`，在 Ubuntu 生成被 `.gitignore` 忽略的')])
(TASK/'research/final-path-edits.json').write_text(json.dumps(CHANGES,ensure_ascii=False,indent=2)+'\n')
