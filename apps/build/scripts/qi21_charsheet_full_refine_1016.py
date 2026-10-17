"""Refine the four observed full-board rendering deviations without reducing content."""
from pathlib import Path
import json,shutil,hashlib,re
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-full-board-1016';PREV=OUT.parent/'daojie-charsheet-six-zone-1016';M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';rows=[]
sha=lambda b:hashlib.sha256(b).hexdigest()
def save(p,new):
 old=p.read_bytes();b=OUT/'refine-backups'/str(p).lstrip('/');b.parent.mkdir(parents=True,exist_ok=True);assert not b.exists();shutil.copy2(p,b);assert p.read_bytes()==old;p.write_bytes(new)
 rows.append({'path':str(p),'backup':str(b),'before':sha(old),'after':sha(new)})
def dump(o):return (json.dumps(o,ensure_ascii=False,indent=2)+'\n').encode()
p=M/'json/qi21_bases.json';d=json.loads(p.read_text());card=next(t for t in d['types'] if t['zh']=='设定卡');oldcard=json.loads(json.dumps(card))
replacements={
 '左栏下方为人物资料与配色方案，占该栏高度约两成：':'左栏下方为人物资料与配色方案，占该栏高度约两成，资料与色样整块排在主立绘脚底以下：',
 '完整呈现发饰、手部、鞋履与佩挂物。':'完整呈现发饰、手部、鞋履与佩挂物；每格全身像从头到脚完整收在第一行矩形内，头脚各留边距，三幅人物均在第一行下边界之上结束。第二行只容纳两幅头部近景。',
 '右侧上下排列握柄与护手特写、鞘口与连接结构特写。':'右侧恰好两格：右上格为握柄与护手特写，右下格为鞘口与连接结构特写，共两幅局部图。',
 '完整武器两端均入画，局部图与完整图对应同一件武器。':'完整武器两端均入画，局部图与完整图对应同一件武器；来源为收鞘态时，完整图与所有局部图均保持收鞘态。',
 '人物脸型、发型、服装剪裁、鞋履、配饰和武器在所有视图中一致；':'人物脸型、发型、服装剪裁、鞋履、配饰和武器在所有视图中一致；服装袖型、衣长与裤裙形制服从主体，主体为劲装时呈束袖束腰上衣与分开的双腿裤装，武器长短和材质服从主体；'
}
for key in ('positive_text','rgba_positive'):
 for a,b in replacements.items():assert card[key].count(a)==1,a;card[key]=card[key].replace(a,b)
card['recipe_version']='v0.4r2(1016 完整板实图后补分区边界、资料位置、武器局部数与劲装形制，待再验收)'
save(p,dump(d));(OUT/'type-positive-v1.txt').write_text(oldcard['positive_text']+'\n');(OUT/'type-positive.txt').write_text(card['positive_text']+'\n')
homes=[M]
for row in json.loads((PREV/'mirror-data-sync.json').read_text()):
 p=Path(row['path']);o=json.loads(p.read_text());i=next(i for i,t in enumerate(o['types']) if t['zh']=='设定卡');assert o['types'][i]==oldcard;o['types'][i]=card;save(p,dump(o))
 if p.parent.name=='json':homes.append(p.parent.parent)
for home in homes:
 p=home/'ma_sync/runtime-contract.json';o=json.loads(p.read_text());o['localRevision']['styleSourceSha256']=sha((home/'json/qi21_bases.json').read_bytes());o['contractSha256']=sha(json.dumps({k:v for k,v in o.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode());save(p,dump(o))
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';s=p.read_text();m=re.search(r'expect\(DAOJIE_RUNTIME_CONTRACT.contractSha256\)\.toBe\([\s\S]*?"([a-f0-9]{64})"',s);assert m
h=json.loads((M/'ma_sync/runtime-contract.json').read_text())['contractSha256'];save(p,(s[:m.start(1)]+h+s[m.end(1):]).encode())
(OUT/'refine-changes.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n');print('refined and synced',len(rows),'type chars',len(card['positive_text']))
