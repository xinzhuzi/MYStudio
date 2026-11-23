"""Collect existing032 repairs, their differences and fresh handoff evidence."""
from pathlib import Path
import json,hashlib,importlib.util,subprocess,difflib
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research'
vp=root/'apps/build/scripts/chapter032_review_verify_20261111.py'
spec=importlib.util.spec_from_file_location('fr032_verify',vp);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)
b=json.loads((r/'chapter032-review-repair-backup-20261111.json').read_text())
original={k:Path(b['drafts'][n]['backup']).read_text() for k,n in v.NAMES.items()}
red=v.verify_chapter032_review(original)
assert all(not x for x in red.values())
proc=subprocess.run(['python3','-B',str(vp)],cwd=root,text=True,capture_output=True)
d=json.loads(proc.stdout);d['actual_exit_code']=proc.returncode;d['command']='python3 -B apps/build/scripts/chapter032_review_verify_20261111.py';d['original_eight_group_regression']=red
(r/'chapter032-handoff-verification-20261111.json').write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
assert proc.returncode==0 and d['pass'],d['failures']
changes={};all_diff=[]
for k,n in v.NAMES.items():
 a=original[k].splitlines();z=(r/n).read_text().splitlines();blocks=[]
 for tag,i,j,x,y in difflib.SequenceMatcher(None,a,z,autojunk=False).get_opcodes():
  if tag!='equal':blocks.append({'kind':tag,'old':[i+1,j],'new':[x+1,y]})
 changes[k]={'path':str(r/n),'blocks':blocks,'non_equal_blocks':len(blocks)}
 all_diff.extend(difflib.unified_diff(a,z,fromfile=b['drafts'][n]['backup'],tofile=str(r/n),n=2))
(r/'chapter032-repair-differences-20261111.diff').write_text('\n'.join(all_diff)+'\n')
m=json.loads((r/'chapter032-review-repair-shot-map-20261111.json').read_text())['old_to_new']
shot_rows=v.rows((r/v.NAMES['sh']).read_text());new=[int(x[0]) for x in shot_rows if int(x[0]) not in m.values()]
oldrows={int(x[0]):x for x in v.rows(original['sh'])};byid={int(x[0]):x for x in shot_rows}
seconds_in_added=sum(int(byid[i][2]) for i in new)
retimed=[{'old':i,'new':m[str(i)],'before':int(x[2]),'after':int(byid[m[str(i)]][2])} for i,x in oldrows.items() if x[2]!=byid[m[str(i)]][2]]
markers={35:'袖布擦手、',39:'旁白起于绞住、',46:'脚步、人声和',49:'街声延续。',76:'草叶挤压声；',115:'干叶摩擦；',122:'旁白随结落下，'}
voices=[]
for i,x in byid.items():
 if x[4].startswith('VS（'):
  s=x[4].split('：',1)[1]
  if i in markers:s=s.split(markers[i],1)[0]
  chars=len(v.normalized_speech(s));voices.append({'shot':i,'text':s,'characters':chars,'seconds':int(x[2]),'characters_per_second':round(chars/int(x[2]),4)})
payload={'differences':changes,'added_shots':new,'added_shot_seconds':seconds_in_added,'retimed_original_shots':retimed,'voice_windows':voices,'narration_characters':sum(x['characters'] for x in voices),'maximum_paper_characters_per_second':max(x['characters_per_second'] for x in voices),'unit_seconds':d['unit_seconds'],'shot_seconds':d['shot_seconds'],'input_sha256':d['input_sha256_end'],'independent_review_pass':False,'review_status':'pending_new_independent_difference_review'}
(r/'chapter032-repair-handoff-20261111.json').write_text(json.dumps(payload,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'exit':proc.returncode,'eight_groups':sum(d['groups'].values()),'handoff_checks':len(d['handoff_checks']),'negative_controls':len(d['negative_controls']),'diff_blocks':{k:x['non_equal_blocks'] for k,x in changes.items()},'added_shots':len(new),'added_seconds':seconds_in_added,'retimed':retimed,'narration_chars':payload['narration_characters'],'max_chars_s':payload['maximum_paper_characters_per_second']},ensure_ascii=False))
