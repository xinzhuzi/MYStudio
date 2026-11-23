"""Collect existing031 repair differences and primary static verification."""
from pathlib import Path
import json,hashlib,importlib.util,subprocess,difflib,re
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research';b=r/'chapter031-repair-backup-20261111';vp=root/'apps/build/scripts/chapter031_review_verify_20261111.py'
spec=importlib.util.spec_from_file_location('fr031_verify',vp);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
manifest=json.loads((b/'manifest.json').read_text());inputs=[r/n for n in v.NAMES.values()]+[Path(manifest['source']['path']),root/manifest['source_map']['path'],vp,b/'manifest.json']
start={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}
proc=subprocess.run(['python3','-B',str(vp),'--negative-self-test'],cwd=root,text=True,capture_output=True)
d=json.loads(proc.stdout);end={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs};d.update(actual_exit_code=proc.returncode,command='python3 -B apps/build/scripts/chapter031_review_verify_20261111.py --negative-self-test',input_sha256_start=start,input_sha256_end=end,input_identity_stable=start==end)
assert proc.returncode==0 and d['pass'] and start==end
(r/'chapter031-handoff-verification-20261111.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
changes={};diff=[];nonrows=[]
for key,n in v.NAMES.items():
 a=(b/n).read_text().splitlines();z=(r/n).read_text().splitlines();blocks=[]
 for tag,i,j,x,y in difflib.SequenceMatcher(None,a,z,autojunk=False).get_opcodes():
  if tag!='equal':blocks.append({'kind':tag,'old':[i+1,j],'new':[x+1,y]})
 changes[key]={'path':str(r/n),'blocks':blocks,'non_equal_blocks':len(blocks)}
 diff.extend(difflib.unified_diff(a,z,fromfile=str(b/n),tofile=str(r/n),n=2))
 if key=='I':
  ar=[l for l in a if not re.match(r'^\| \d{3} \|',l)];zr=[l for l in z if not re.match(r'^\| \d{3} \|',l)]
  nonrows=list(difflib.unified_diff(ar,zr,fromfile='before-I-nonrows',tofile='current-I-nonrows',n=1))
(r/'chapter031-repair-differences-20261111.diff').write_text('\n'.join(diff)+'\n')
newshots={};retimed={};soundchanges=[]
# These exact suffixes are production directions following actual performed voice.
tails={('O','A03'):'风声压过',('O','A22b'):'囊口与皮绳轻响。',('G','21b'):'人群脚步接回。',('G','27'):'风声与阵鸣接续；',('G','92'):'呼吸压低；'}
for key in ['O','G']:
 old={x[0]:x for x in v.rows((b/v.NAMES[key]).read_text())};new={x[0]:x for x in v.rows((r/v.NAMES[key]).read_text())}
 newshots[key]=[{'shot':i,'seconds':int(x[2])} for i,x in new.items() if i not in old]
 retimed[key]=[{'shot':i,'before':int(old[i][2]),'after':int(x[2])} for i,x in new.items() if i in old and old[i][2]!=x[2]]
 for i,x in new.items():
  if (i not in old or old[i][4]!=x[4]) and '：' in x[4]:
   s=x[4].split('：',1)[1]
   if (key,i) in tails:s=s.split(tails[key,i],1)[0]
   s=s.replace('晏燎：','')
   count=len(v.norm(s));soundchanges.append({'table':key,'shot':i,'speech':s,'characters':count,'seconds':int(x[2]),'characters_per_second':round(count/int(x[2]),4)})
payload={'differences':changes,'added_shots':newshots,'retimed_original_shots':retimed,'changed_spoken_windows':soundchanges,'changed_window_characters':sum(x['characters'] for x in soundchanges),'max_chars_per_second':max(x['characters_per_second'] for x in soundchanges),'metrics':d['metrics'],'input_sha256':end,'independent_review_pass':False,'review_status':'pending_new_independent_difference_review'}
(r/'chapter031-repair-handoff-20261111.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'exit':proc.returncode,'checks':d['checks'],'negatives':len(d['negative_tests']),'diff_blocks':{k:x['non_equal_blocks'] for k,x in changes.items()},'new_shots':sum(len(x) for x in newshots.values()),'new_seconds':sum(x['seconds'] for values in newshots.values() for x in values),'retimed_net':sum(x['after']-x['before'] for values in retimed.values() for x in values),'voice_windows':len(soundchanges),'voice_chars':payload['changed_window_characters'],'max':max(soundchanges,key=lambda x:x['characters_per_second'])},ensure_ascii=False))
print('\n'.join(nonrows))
