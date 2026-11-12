"""Persist terminal agent failures and transfer partial draft ownership to root."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil,difflib
root=Path(__file__).resolve().parents[3];t=root/'.trellis/tasks/10-27-script-narrative-translation-cure';r=t/'research'
paths=[r/'fr-volumes-current-20261110.json',t/'task.json',t/'offline-progress.md',t/'prd.md',r/'fr-volumes-resume-20261110.md'];old={p:p.read_bytes() for p in paths};d=json.loads(old[paths[0]])
errors={31:'53d20319-8646-4a3f-96f0-f9a2b0851e11',32:'bb377956-aba0-426a-bcfb-a78680427a7f',33:'68a8ea4b-2772-4243-baef-510c171c35c4'}
snapshot={}
for no,request_id in errors.items():
 c=next(x for x in d['volume1']['chapters'] if x['chapter']==no)
 assert c['owner']==f'/root/fr{no:03d}_targeted_repair'
 items={**c['files'],'execution_support':c['execution_support']};snapshot[str(no)]={}
 for k,v in items.items():
  p=Path(v['path']);raw=p.read_bytes();snapshot[str(no)][k]={'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),'changed_since_registered':hashlib.sha256(raw).hexdigest()!=v['sha256']}
 c['interrupted_writer']={'agent':c['writer'],'status':'errored','reason':'429 Too Many Requests; exceeded retry limit','request_id':request_id,'observed_at':datetime.now(timezone.utc).isoformat()}
 c['owner']='/root';c['writer']='/root';c['status']='partial_repair_primary_takeover' if any(v['changed_since_registered'] for v in snapshot[str(no)].values()) else 'verified_findings_repair_pending'
 c['next_action']='Retain already-written work; primary reads differences and verifies before any further edit. No replay of mutation scripts or full review. New independent difference review and primary fresh still required.'
 c['partial_snapshot']='fr-rate-limit-partial-snapshot-20261111.json'
(r/'fr-rate-limit-partial-snapshot-20261111.json').write_text(json.dumps(snapshot,ensure_ascii=False,indent=2)+'\n')
summary='当前42章闭合（001—030、259—270）直接复用。031/032/033修复代理均因429终止，错误ID和现盘部分成果指纹已登记，所有权归主会话；保留已写修复，先核差异与自验缺口，不重放修改脚本或全文初审，再接独审和主fresh。全卷历史对账不重复。'
d['as_of']=datetime.now(timezone.utc).isoformat();d['next_action']='42 reusable closed.031/032/033 writers terminal429; partial snapshot recorded; root owns pending work. Preserve existing repairs, inspect differences and close verification gaps; no mutation replay/full-review duplication.'
j=json.loads(old[t/'task.json']);j['offlineTrack']['last_checkpoint']=d['next_action'];out={paths[0]:json.dumps(d,ensure_ascii=False,indent=2)+'\n',t/'task.json':json.dumps(j,ensure_ascii=False,indent=2)+'\n'}
for p,prefix in [(t/'offline-progress.md','> 最新状态：'),(t/'prd.md','> **2026-11-11 最新离线进度**')]:
 lines=old[p].decode().splitlines();hits=[i for i,l in enumerate(lines) if l.startswith(prefix)];assert len(hits)==1;lines[hits[0]]=prefix+summary;out[p]='\n'.join(lines)+'\n'
p=paths[-1];out[p]=old[p].decode()+'\n'+summary+' 本条取代此前在途快照。\n'
b=r/('fr-rate-limit-backup-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'));b.mkdir()
for p in paths:assert p.read_bytes()==old[p];shutil.copy2(p,b/p.name)
for p in paths:p.write_text(out[p])
for no,items in snapshot.items():print(no, 'changed_files',sum(x['changed_since_registered'] for x in items.values()))
