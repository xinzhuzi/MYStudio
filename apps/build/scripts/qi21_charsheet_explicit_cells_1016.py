"""Make all six card cells explicit, retaining subject/style separation."""
from pathlib import Path
import json,shutil,hashlib
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016';M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';P=M/'json/qi21_bases.json'
sha=lambda b:hashlib.sha256(b).hexdigest();changes=[]
def write(p,data):
 old=p.read_bytes()
 if old==data:return
 b=OUT/'explicit-cells-backups'/p.resolve().relative_to('/');b.parent.mkdir(parents=True,exist_ok=True);assert not b.exists(),b
 shutil.copy2(p,b);assert p.read_bytes()==old;p.write_bytes(data);changes.append({'path':str(p),'backup':str(b),'before':sha(old),'after':sha(data)})
original=json.loads(P.read_text());card=next(t for t in original['types'] if t['zh']=='设定卡');old=card['positive_text']
layout=('同一角色的横向角色设定卡，固定六个图像区，每区各一幅图。左侧约占总宽三分之一、贯穿全高，右侧约占总宽三分之二，分为上七成高、下三成高两排。'
'左侧整列：主视觉全身立绘，头顶到脚底完整入画，自然站姿。'
'右上排左格：正面全身像，脸与胸口正对镜头、双肩对称，头顶到脚底完整入画。'
'右上排中格：纯九十度侧面全身像，仅见一侧眼睛、双肩前后重合，头顶到脚底完整入画。'
'右上排右格：背面全身像，后脑与背部朝向镜头，头顶到脚底完整入画。'
'右下排左格：面部近景，取景从完整头顶至锁骨，五官、发际与发饰清楚。'
'右下排右格：腰部局部特写，取景从腰部至胯部，展示该角色实际腰带或腰封、衣片衔接和既有配器的佩挂连接结构。'
'右上三格等宽，三视图均为标准站姿、人物等高、头顶与脚底分别对齐；右下两格等宽。全卡恰好四幅全身像、一幅面部近景和一幅局部特写，六区分隔清楚、各守位置。')
card['positive_text']='\n'.join([layout,*old.splitlines()[1:]]);card['rgba_positive']=card['positive_text']
card['recipe_version']='v0.3(1016 固定六区逐格位置与取景，实图验证见本轮报告)'
for p in [P]+[Path(r['path']) for r in json.loads((OUT/'mirror-data-sync.json').read_text())]:
 obj=json.loads(p.read_text());i=next(i for i,t in enumerate(obj['types']) if t['zh']=='设定卡');assert obj['types'][i]['positive_text']==old,p
 obj['types'][i]=card;write(p,(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode())
# Keep the source fingerprint current; no art-style module changes.
source_hash=sha(P.read_bytes());old_contract=None;new_contract=None
for row in json.loads((OUT.parent/'qi21-five-method-style-1016/sync-changes.json').read_text()):
 p=Path(row['path'])
 if p.name!='runtime-contract.json':continue
 obj=json.loads(p.read_text());prev=obj['contractSha256'];obj['localRevision']['styleSourceSha256']=source_hash
 obj['contractSha256']=sha(json.dumps({k:v for k,v in obj.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
 if new_contract:assert new_contract==obj['contractSha256'] and old_contract==prev
 old_contract=prev;new_contract=obj['contractSha256'];write(p,(json.dumps(obj,ensure_ascii=False,indent=2)+'\n').encode())
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';s=p.read_text();assert s.count(old_contract)==1;write(p,s.replace(old_contract,new_contract,1).encode())
(OUT/'layout-text-v7-explicit-cells.txt').write_text(card['positive_text']+'\n');(OUT/'explicit-cells-changes.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n')
print('updated',len(changes),'files; layout chars',len(layout),'type chars',len(card['positive_text']))
