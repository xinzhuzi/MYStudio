"""Extract user intent and bounded history chunks without replaying tool logs."""
import collections
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.trellis/tasks/10-27-script-narrative-translation-cure/research/fr-history-20261110'
SOURCES = [
    Path('/Users/zhengbingjin/.codex/sessions/2026/11/02/rollout-2026-11-02T18-13-08-01a19bbf-9b83-7e22-a594-c8d10cba6818.jsonl'),
    Path('/Users/zhengbingjin/.codex/sessions/2026/11/05/rollout-2026-11-05T15-40-43-01a1aaa7-2778-74e1-9cfb-53438b716784.jsonl'),
]
OUT.mkdir(exist_ok=True)
users=[]; manifest=[]
for si, source in enumerate(SOURCES,1):
    digest=hashlib.sha256(); messages=[]; counts=collections.Counter(); total=0
    with source.open('rb') as stream:
        for ln, raw in enumerate(stream,1):
            digest.update(raw); total+=len(raw); record=json.loads(raw); counts[record['type']]+=1
            payload=record.get('payload',{})
            if record['type']=='response_item' and payload.get('type')=='message':
                role=payload.get('role'); phase=payload.get('phase','')
                text='\n'.join(p.get('text','') for p in payload.get('content',[]) if isinstance(p,dict))
                if role not in ('user','assistant'):continue
                if text.startswith(('<codex_internal_context','# AGENTS.md','<environment_context')):continue
                text=re.sub(r'\bsk-[A-Za-z0-9_-]{12,}\b','[REDACTED]',text)
                text=re.sub(r'\b[A-Za-z0-9]{32}\.[A-Za-z0-9]{16}\b','[REDACTED]',text)
                text=re.sub(r'(?i)(api[_ -]?key\s*[=:]\s*)\S+',r'\1[REDACTED]',text)
                header=f'### source{si}:{ln} | {record.get("timestamp")} | {role} | {phase}\n\n'
                if role=='user':users.append(header+text+'\n')
                messages.append(header+text+'\n')
    chunks=[]
    for i in range(0,len(messages),100):
        dest=OUT/f'source{si}-messages-{i+1:04d}-{min(i+100,len(messages)):04d}.md'
        dest.write_text('\n'.join(messages[i:i+100]));chunks.append(dest.name)
    manifest.append({'source':str(source),'bytes':total,'lines':ln,'sha256':digest.hexdigest(),'counts':dict(counts),'visible_messages':len(messages),'chunks':chunks})
(OUT/'user-requests.md').write_text('\n'.join(users))
(OUT/'manifest.json').write_text(json.dumps({'sources':manifest,'user_requests':len(users)},ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'user_requests':len(users),'user_bytes':(OUT/'user-requests.md').stat().st_size,'sources':[{'lines':m['lines'],'messages':m['visible_messages'],'chunks':len(m['chunks'])} for m in manifest]},ensure_ascii=False))
