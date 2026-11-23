"""One-time historical audit registration; preserve every manuscript."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import shutil

root = Path(__file__).resolve().parents[3]
t = root / '.trellis/tasks/10-27-script-narrative-translation-cure'
r = t / 'research'
b = json.loads((r / 'fr-volumes-baseline-20261110.json').read_text())
p = r / 'fr-volumes-current-20261110.json'
c = json.loads(p.read_text())
bs = {x['chapter']: x for x in b['volumes'][0]['chapters']}
bd = {x['chapter']: x for x in b['volume1_drafts']}
cd = {x['chapter']: x for x in c['volume1']['chapters']}
inputs = []
for n in range(81, 101):
    s = bs[n]
    h = hashlib.sha256(Path(s['path']).read_bytes()).hexdigest()
    assert h == s['sha256']
    inputs.append((n, 'source', s['path'], h))
    for role, f in bd[n]['files'].items():
        fp = Path(f['path'])
        h = hashlib.sha256(fp.read_bytes()).hexdigest()
        assert h == f['sha256'] == cd[n]['files'][role]['sha256']
        assert fp.stat().st_size == f['bytes'] == cd[n]['files'][role]['bytes']
        assert f['path'] == cd[n]['files'][role]['path']
        inputs.append((n, role, str(fp), h))
    assert cd[n]['status'] == 'pending_evidence_audit'
assert len(inputs) == 80
digest = hashlib.sha256(''.join(f'{n}\t{role}\t{path}\t{h}\n' for n, role, path, h in inputs).encode()).hexdigest()
assert digest == '46742790b2674ae5469b5146d4e0b4dd6d65a3456e84583d4291cfa91ae1ee20'
report = {'pass': True, 'recorded_at_utc': datetime.now(timezone.utc).isoformat(), 'checks_passed': 80, 'protected_80_digest': digest, 'inputs': [{'chapter': n, 'role': role, 'path': path, 'sha256': h} for n, role, path, h in inputs], 'reviewer': '/root/fr_history_081_100', 'main_point_checks': ['volume-one-resume-1102.md:3825', 'volume-one-resume-1102.md:3827', 'volume-one-resume-1102.md:3831', 'volume-one-resume-1102.md:5648', 'volume-one-resume-1102.md:5650', 'volume-one-resume-1102.md:5652', 'volume-one-resume-1102.md:5654', 'volume-one-resume-1102.md:5656', 'chapter092-source-map-1103.md:20', 'chapter098-source-map-1103.md:26'], 'boundary': 'Main current-input identity and selected historical claims only; full semantic review not repeated; agent structural verification separate.'}
evidence = r / 'fr-history-081-100-mainfresh-20261110.json'
assert not evidence.exists()
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
backup = r / ('fr-audit081-100-metadata-backup-' + stamp)
backup.mkdir()
paths = [p, t / 'offline-progress.md', t / 'task.json', t / 'prd.md', r / 'fr-volumes-resume-20261110.md']
for path in paths:
    shutil.copy2(path, backup / path.name)
evidence.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
for n in range(81, 101):
    cd[n].update(status='historical_evidence_audited_content_review_pending', evidence_audit_date='2026-11-10', evidence_audit='fr-history-evidence-081-100-20261110.md', evidence_audit_scope='Research top-level chapter reports and relevant volume sections; no historical chat search or manuscript rereview.', next_action='Reuse existing revisions including later096-100 patches; complete missing current full content review and subsequent main fresh. Do not rerun prior repair scripts.')
c['volume1']['historical_evidence_audited_chapters'] = sorted(set(c['volume1']['historical_evidence_audited_chapters']) | set(range(81, 101)))
for n, p2, p3 in [(6, 3, 1), (7, 2, 1)]:
    cd[n].update(status='targeted_repair_in_progress', writer=f'/root/fr{n:03d}_targeted_repair', evidence=[f'chapter{n:03d}-independent-full-20261110.md'], p2_groups_open=p2, p3_groups_open=p3, next_action='Full review complete. Repair confirmed findings only, then different independent targeted reviewer and main fresh; no repeat full review of unchanged input.')
c['as_of'] = datetime.now(timezone.utc).isoformat()
c['evidence_audit_in_progress'] = {'chapters': list(range(101, 121)), 'reviewer': '/root/fr_history_101_120', 'scope': 'historical evidence identity only'}
c['next_action'] = '006/007 targeted repairs underway. Historical audit001-100 complete;101-120 underway. Reuse17 closed chapters001-005 and259-270.'
p.write_text(json.dumps(c, ensure_ascii=False, indent=2) + '\n')
p = t / 'offline-progress.md'
s = p.read_text()
old = '|第一卷其余章|'
assert s.count(old) == 1
s = s.replace(old, '|081—100历史证据|对账完成；主核80/80输入SHA匹配，已有修订及096—100后补沿用|[对账报告](research/fr-history-evidence-081-100-20261110.md)、[主指纹核验](research/fr-history-081-100-mainfresh-20261110.json)|缺当前全文独审及其后主fresh；不回退旧预算；下批101起|\n' + old)
old = '004／005已闭合，当前17章可复用。006、007分别由 `/root/fr006_current_review`、`/root/fr007_current_review` 只读全文审阅；`/root/fr_history_081_100` 对账081—100历史证据。当前无在途写稿；001—005、259—270与001—080历史对账均从待办中跳过。'
assert s.count(old) == 1
s = s.replace(old, '当前17章可复用。006、007全文独审已完成，分别为3P2＋1P3组、2P2＋1P3；主已核源裁定，由 `/root/fr006_targeted_repair`、`/root/fr007_targeted_repair` 各自独占本章三稿局修。详 [006独审](research/chapter006-independent-full-20261110.md)、[007独审](research/chapter007-independent-full-20261110.md)，只接定点修后独审和主fresh，不重做同版全文审阅。081—100历史对账已闭合，`/root/fr_history_101_120` 只读对账下一批。001—005、259—270与001—100历史对账均从待办中跳过。')
p.write_text(s)
p = t / 'task.json'
j = json.loads(p.read_text())
j['offlineTrack']['last_checkpoint'] = '2026-11-10:17 closed chapters retained.006/007 full reviews completed and confirmed findings recorded; exclusive targeted repair writers active, independent postfix/main fresh still pending. Historical audit001-100 complete with latest80/80 SHA;101-120 readonly audit underway. Do not repeat completed unchanged work.'
p.write_text(json.dumps(j, ensure_ascii=False, indent=2) + '\n')
p = t / 'prd.md'
s = p.read_text()
assert s.count('001—080章历史证据对账完成') == 1
s = s.replace('001—080章历史证据对账完成', '001—100章历史证据对账完成', 1)
old = '本批无在途写稿，内容独审从006、历史对账从081接续'
assert s.count(old) == 1
s = s.replace(old, '006/007全文独审已完成并登记确证问题，目前各章局修在途，修后独审及主fresh待续；历史对账101—120在途', 1)
p.write_text(s)
p = r / 'fr-volumes-resume-20261110.md'
s = p.read_text()
assert s.count('001—080历史证据对账也已落盘') == 1
s = s.replace('001—080历史证据对账也已落盘', '001—100历史证据对账也已落盘', 1)
old = '下一内容章006、历史证据批081起。'
assert s.count(old) == 1
s = s.replace(old, '006/007全文独审已落盘，确证缺口正由分章执行者局修；下一步为不同审阅者定点复核及主fresh。历史证据101—120在途。', 1)
p.write_text(s)
print(json.dumps({'pass': True, 'checks_passed': 80, 'protected_80_digest': digest, 'history_audited_through': 100, 'current_closed_count': 17, 'repairs_in_progress': [6, 7], 'audit_in_progress': [101, 120]}, ensure_ascii=False))
