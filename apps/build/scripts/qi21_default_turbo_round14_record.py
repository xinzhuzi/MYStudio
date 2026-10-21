"""Record the reviewed Round14 source-only default change without Git operations."""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation'
OUT = TASK / 'research/round14-default-turbo'
REPORT = 'research/round14-default-turbo/resolution-report.md'
HEADING = '## Round14 默认 Turbo 源码切片（2026-10-21）'


def main() -> None:
    assert (OUT / 'check-report.md').is_file(), 'Independent check report is required'
    assert (OUT / 'resolution-report.md').is_file(), 'Final evidence report is required'
    paths = [TASK / name for name in ('prd.md', 'design.md', 'implement.md', 'task.json', 'task-tiers.json')]
    spec = ROOT / '.trellis/spec/backend/comfyui-integration.md'
    paths.append(spec)
    originals = {p: p.read_text(encoding='utf-8') for p in paths}
    backup = OUT / 'parent-backups'
    backup.mkdir(exist_ok=True)
    for path in paths:
        target = backup / ('spec-comfyui-integration.md' if path == spec else path.name)
        if not target.exists():
            shutil.copy2(path, target)
    task = json.loads(originals[TASK / 'task.json'])
    tiers = json.loads(originals[TASK / 'task-tiers.json'])
    assert task['status'] == 'in_progress'
    assert task['meta']['generation_hold'] is True
    assert task['meta']['runtime_reload_hold'] is True
    note = (
        '\n\n' + HEADING + '\n'
        '用户要求当前道劫文生图/图生图 API 与工作流默认 Turbo。选择件首项/出厂默认统一为'
        '“0 · Turbo 8步”；显式自动按型、原生和viggle保持可选。API元数据steps由6改8，'
        '两画布默认档说明及object-info快照/回归同步；原已正确的三加速蓝图、edit画布及两API模板不重写。'
        '主会话与独立检查均283通过、1装机旧提示词库一致性失败；13类型输入/6镜像/两GUI导出与API一致。'
        '完整Ruff/Pyright存量诊断保留，未冒称总门通过。未安装/重载/生成，既有提示词与参考链问题仍开放，'
        '不关闭AC2/AC4、父任务或tier；收据：' + REPORT + '。\n'
    )
    for name in ('prd.md', 'implement.md'):
        path = TASK / name
        if HEADING not in originals[path]:
            path.write_text(originals[path].rstrip() + note, encoding='utf-8')
    design = TASK / 'design.md'
    if HEADING not in originals[design]:
        design.write_text(originals[design].rstrip() + '\n\n' + HEADING + '\n'
                          '默认值单源为MyQi21SpeedSelect.SPEED_MODES首项；序列化控件/API显式选择优先。'
                          '本轮仅默认顺序、元数据与说明同步，不改select/lazy/装配/采样函数，保留手动档。'
                          'API模板由真实GUI离线导出并比较相等；模型/图片质量与装机验证另行验收。\n', encoding='utf-8')
    task['meta']['defaultTurboRound14'] = {
        'state': 'source-offline-verified-not-deployed', 'report': REPORT,
        'review': 'research/round14-default-turbo/check-report.md',
        'mainVerification': 'research/round14-default-turbo/main-graph-verification.json',
        'testsPassed': 283, 'testsFailed': 1,
        'failure': 'installed qi21_bases.json differs from source; existing assertion retained',
        'defaultMode': '0 · Turbo 8步', 'apiSteps': 8,
        'installationPerformed': False, 'runtimeReloaded': False,
        'generationSubmitted': False, 'parentComplete': False,
    }
    task['meta']['latestEvidenceReport'] = REPORT
    l1 = tiers['tiers'][0]
    assert l1['level'] == 'L1' and l1['status'] == 'in_progress'
    if REPORT not in l1['evidence']:
        l1['evidence'].append(REPORT)
    delivered = 'Round14默认Turbo源码切片：节点首项/元数据/说明同步，283通过+1旧装机库失败；API导出相等，未部署/生成'
    if delivered not in l1['deliveredSlices']:
        l1['deliveredSlices'].append(delivered)
    remaining = 'Round14源码默认Turbo未打包/重载；旧装机提示词库差异及既有模型/参考链/人工验收保持开放'
    if remaining not in l1['remaining']:
        l1['remaining'].append(remaining)
    tiers['latestEvidenceReport'] = REPORT
    (TASK / 'task.json').write_text(json.dumps(task, ensure_ascii=False, indent=2) + '\n')
    (TASK / 'task-tiers.json').write_text(json.dumps(tiers, ensure_ascii=False, indent=2) + '\n')
    start = '## Scenario: QI2.1 saved defaults and generated App template'
    end = '## Scenario: QI2.1 PE extraction and i2i blueprint consistency'
    prefix, section = originals[spec].split(start, 1)
    section, suffix = section.split(end, 1)
    old = '''Speed enum remains `0 · Turbo 8步`; host, embedded subgraph, selector and named
mirrors agree. The selected model route is base→7027
`qwen2.1-detail-fix-2.0.safetensors` at 0.5→7028
`qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors` at 1.0.
Other manual arms preserve their parameters. Internal links and boundary
`linkIds` are reciprocal. Titles describe the actual Fix→Turbo route.'''
    new = '''`MyQi21SpeedSelect.SPEED_MODES` starts with `0 · Turbo 8步`, followed by
`1 · 原生出图`, `2 · viggle`, and `自动 · 按型`; `DEFAULT_MODE` is the first
item. Every type, including free, empty and missing type signals, defaults to
Turbo. Explicit automatic mode retains its type-based native/Turbo routing.
Host, embedded subgraph, selector and named mirrors agree. The current selected
model route is base→7034 `qi21-mikkoani.safetensors` at 0.8→7028
`qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors` at 1.0; the removed
7027 detail-fix loader must not return. BasicGuider and the nine-value official
ManualSigmas sequence execute eight steps. API `SPEC.steps=8`; the compatible
`qwen21-viggle` layout identifier remains unchanged.
Other manual arms preserve their parameters. Internal links and boundary
`linkIds` are reciprocal. Current canvas notes and object-info fixtures describe
the same factory default; a saved explicit choice is not silently migrated.'''
    if old in section:
        section = section.replace(old, new, 1)
    else:
        assert new in section, 'Unexpected spec drift'
    section = section.replace('Base: default Turbo traverses Fix0.5 and official Turbo1.0.',
                              'Base: default Turbo traverses mikkoani0.8 and official Turbo1.0.')
    row = '| missing saved seventh PE switch | conversion/audit fails before posting |'
    extra = '| default mode with setting-card, poster or concept type | Turbo only; no implicit native routing |'
    if extra not in section:
        section = section.replace(row, extra + '\n' + row, 1)
    assertion = ('Cover every canonical type plus free/empty/missing type signals, selector lazy\n'
                 'requests, and mocked t2i/i2i API submissions with caller step values 1/8/40.\n'
                 'Saved API graphs and fresh GUI exports must retain Turbo8.\n')
    if assertion not in section:
        section = section.replace('Audit every product instance and blueprint,', assertion + '\nAudit every product instance and blueprint,', 1)
    spec.write_text(prefix + start + section + end + suffix, encoding='utf-8')
    manifest = [{'path': str(p.relative_to(ROOT)), 'before': hashlib.sha256(originals[p].encode()).hexdigest(),
                 'after': hashlib.sha256(p.read_bytes()).hexdigest()} for p in paths]
    (OUT / 'parent-spec-sync.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'recorded': True, 'files': len(paths), 'task_status': task['status'], 'tier_status': [x['status'] for x in tiers['tiers']]}))


if __name__ == '__main__':
    main()
