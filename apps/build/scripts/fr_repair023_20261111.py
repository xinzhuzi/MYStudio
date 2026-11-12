"""One-time, nine-line clarification of three source-grounded execution cues."""
from pathlib import Path
from datetime import datetime,timezone
import json,hashlib,shutil
root=Path(__file__).resolve().parents[3];r=root/'.trellis/tasks/10-27-script-narrative-translation-cure/research';b=json.loads((r/'fr-volumes-baseline-20261110.json').read_text());c=json.loads((r/'fr-volumes-current-20261110.json').read_text());row=next(x for x in c['volume1']['chapters'] if x['chapter']==23);src=next(x for x in b['volumes'][0]['chapters'] if x['chapter']==23);assert row['status']=='current_full_independent_review_in_progress'
changes=[('鲁械拄半截枯枝挪近，抓住晏燎腕子，翻掌查看。晏燎在他看清红痕后将手抽回，动作牵到旧伤，嘴角紧一下。鲁械看向刚才绊倒人的树根，摇头。','鲁械说完“让我看看”，才拄半截枯枝挪近，抓住晏燎腕子，翻掌查看，再问“嚯”起至“你确定没事”的话。晏燎先答“真没事”，随后抽回手，动作牵到旧伤，嘴角紧一下，再接“又不是第一次受伤了”及后文。鲁械看向刚才绊倒人的树根，摇头。'),('老修士将归元推回年轻独孤怀里，掌心拍他的肩。','老修士将归元推回年轻独孤怀里；“剑还在，人就别先死”说完后，掌心才拍他的肩。')]
other=[('鲁械先拄枝移位，再抓腕翻掌，晏燎抽手牵痛后才看树根。','鲁械先说“让我看看”再拄枝移位、抓腕翻掌并问印痕；晏燎答“真没事”后抽手，才接“又不是”及后文，最后鲁械看树根。'),('只用推剑与拍肩两个可辨动作，把三十年前和现在分开。','推剑入怀后说劝活原话，话完才拍肩；这两个动作与中间同一次发声连续，把三十年前和现在分开。')]
director=[('独孤回答不能很快，经脉警告放慢，晏燎的哦收得轻。','独孤答“不能”要干脆利落，随后经脉警告放慢，晏燎的“哦”收得轻。')]
outputs={};inputs={'source':src};manifest_changes={}
for kind,z in row['files'].items():
 p=Path(z['path']);old=p.read_text();assert hashlib.sha256(p.read_bytes()).hexdigest()==z['sha256'];new=old;replacements=changes+(other if kind!='screenplay' else [])+(director if kind=='director-plan' else [])
 for a,d in replacements:assert new.count(a)==1,(kind,a);new=new.replace(a,d,1)
 oldlines=old.splitlines(keepends=True);newlines=new.splitlines(keepends=True);assert len(oldlines)==len(newlines)
 diff=[i for i,(a,d) in enumerate(zip(oldlines,newlines),1) if a!=d];assert len(diff)==({'screenplay':2,'director-plan':5,'storyboard':2}[kind]);outputs[kind]=new;inputs[kind]=z;manifest_changes[kind]={'lines':diff,'replacements':[{'before':a,'after':d} for a,d in replacements]}
assert hashlib.sha256(Path(src['path']).read_bytes()).hexdigest()==src['sha256']
bk=r/'chapter023-review-backup-20261111';assert not bk.exists();bk.mkdir();manifest={'recorded_at_utc':datetime.now(timezone.utc).isoformat(),'inputs':{},'changes':manifest_changes}
for kind,z in inputs.items():
 p=Path(z['path']);raw=p.read_bytes();rec={'path':str(p),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
 if kind!='source':
  dest=bk/p.name;shutil.copy2(p,dest);assert dest.read_bytes()==raw;rec['backup_path']=str(dest)
 manifest['inputs'][kind]=rec
(bk/'inputs.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
for kind,new in outputs.items():Path(inputs[kind]['path']).write_text(new)
print(json.dumps({'pass':True,'changed_lines':{k:v['lines'] for k,v in manifest_changes.items()},'end_sha256':{k:hashlib.sha256(Path(z['path']).read_bytes()).hexdigest() for k,z in inputs.items()}},ensure_ascii=False))
