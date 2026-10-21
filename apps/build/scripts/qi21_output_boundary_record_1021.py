"""Append Round15 source evidence without closing parent tiers or runtime holds."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation'
REL = 'research/round15-i2i-output-error'
REPORT = f'{REL}/resolution-report.md'
summary = 'Round15前端output源码修复：用途路由移入子图4022并真实BOOLEAN穿界，root19仅走线；i2i/蓝图/API同步，303回归、真实隔离前端三画布导出及独立复核通过；未安装/重载/生成，不关闭父任务与hold。'
for name in ('task.json', 'task-tiers.json'):
    path = TASK / name
    raw = path.read_bytes()
    doc = json.loads(raw)
    backup = TASK / REL / 'backups' / (hashlib.sha256(raw).hexdigest() + '.json')
    if not backup.exists():
        shutil.copy2(path, backup)
    assert backup.read_bytes() == raw
    if name == 'task.json':
        assert doc['status'] == 'in_progress'
        if summary not in doc.get('notes', ''):
            doc['notes'] = summary + ' ' + doc.get('notes', '')
        related = doc.setdefault('relatedFiles', [])
        full = str((TASK / REPORT).relative_to(ROOT))
        if full not in related:
            related.append(full)
    else:
        assert [(t['level'], t['status']) for t in doc['tiers']] == [('L1', 'in_progress'), ('L2', 'open'), ('L3', 'open')]
        tier = doc['tiers'][0]
        for entry in (REPORT, f'{REL}/main-verification.json', f'{REL}/check-report.md'):
            if entry not in tier['evidence']:
                tier['evidence'].append(entry)
        if summary not in tier['deliveredSlices']:
            tier['deliveredSlices'].append(summary)
        remaining = 'Round15仅源码与前端导出验收；尚未对当前用户画布/装机副本重载、排队执行或真实生成验收；父任务、AC2/AC4与一般hold继续开放。'
        if remaining not in tier['remaining']:
            tier['remaining'].append(remaining)
        doc['latestEvidenceReport'] = REPORT
    rendered = (json.dumps(doc, ensure_ascii=False, indent=2) + '\n').encode()
    assert path.read_bytes() == raw, 'concurrent task change'
    path.write_bytes(rendered)
print('Round15 evidence appended; parent tiers/status retained')
