"""Keep prior results as history; synchronize the stopped acceptance batch."""
from pathlib import Path
import json
import shutil
repo=Path(__file__).resolve().parents[3]
task=repo/'.trellis/tasks/10-25-daojie-director-rule-conflict-validation'
r=task/'research'
b=task/'backups/acceptance42-documents'
b.mkdir(exist_ok=True)
summary=('追加42次已获批准，累计上限156。首批实际新增5次（115–119），累计119/156、剩37次。'
         'P5剧本硬门通过，但P5规划模型审核漏报新增声源/钩索消失/高度变化，主会话判FAIL；'
         'R3剧本格式门拒绝，另有平放尸体提前。已停两卡下游，未启动其余五卡、未重试。'
         '本轮fresh 11文件261测试及typecheck exit0，账本/依赖离线6测试通过。'
         'AC5仍开放，task保持in_progress。当前报告research/acceptance42-review-1026.md。')
def save(p,text):
 target=b/'__'.join(p.relative_to(repo).parts)
 assert not target.exists()
 shutil.copy2(p,target)
 p.write_text(text)
for name in ('prd.md','design.md','implement.md'):
 p=task/name;s=p.read_text();head,tail=s.split('\n',1)
 s=head+'\n\n## 追加42次首批结果（当前，失败即停）\n\n'+summary+'\n\n以下按时间保留先前范围和收据，114/114为追加前快照。\n'+tail
 if name=='prd.md':
  lines=s.splitlines()
  for i,line in enumerate(lines):
   if line.startswith('- [ ] AC5'):
    lines[i]='- [ ] AC5 (R4，语义质量门未过): '+summary
  s='\n'.join(lines)+'\n'
 save(p,s)
p=task/'task.json';d=json.loads(p.read_text());assert d['status']=='in_progress' and d['completedAt'] is None
d['notes']=summary+'\n以下为之前notes：'+d['notes'];save(p,json.dumps(d,ensure_ascii=False,indent=2)+'\n')
for name in ('current-model-protocol.md','verification.md','resume-verification.md','chain-generation-and-install-review-1026.md'):
 p=r/name;s=p.read_text();head,tail=s.split('\n',1)
 save(p,head+'\n\n## 追加42次首批结果（当前）\n\n'+summary+'\n\n以下为追加前快照，不能当当前调用计数。\n'+tail)
for name in ('implement.jsonl','check.jsonl'):
 p=task/name;rows=[json.loads(line) for line in p.read_text().splitlines() if line]
 rows.append({'file':str((r/'acceptance42-review-1026.md').relative_to(repo)),'reason':'追加42次实际5次首批失败；模型审核漏报与主会话否决、余额37及失败即停规则'})
 save(p,''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows))
m=repo/'.trellis/tasks/archive/2026-10/10-25-daojie-story-skill-canon-alignment/prd.md';s=m.read_text()
save(m,s+'\n\n### 追加42次首批验收结果（1026，只追加）\n\n'+summary+' 仅移交结果，不改母档旧勾选、状态或历史结论。\n')
for name in ('acceptance42-offline-tests','acceptance42-focused','acceptance42-prepare','acceptance42-regression','acceptance42-typecheck'):
 p=r/(name+'.exit');assert not p.exists();p.write_text('0\n')
print('current documents synchronized; no completion or archive')
