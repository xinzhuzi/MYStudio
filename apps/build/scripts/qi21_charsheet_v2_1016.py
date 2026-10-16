"""Iterate only the card type after inspecting v1 failures."""
from pathlib import Path
import json,shutil,hashlib
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016'
p=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
s=p.read_text();d=json.loads(s);c=next(t for t in d['types'] if t['zh']=='设定卡');old=c['positive_text']
a='朝画面右侧的纯九十度侧面平视'
b='纯九十度侧面平视（鼻尖、胸口与脚尖均指向画面右边缘，仅见一侧眼睛）'
assert old.count(a)==1
new=old.replace(a,b,1)
a='衣褶/裙摆：使用宽幅平静布面，正面长结构褶疏落两到四条。'
b='服装形制、长短、袖型、裤装与裙装逐项服从主体来源：劲装保持贴身束袖束腰与可辨的双腿裤装，长袍或裙装只在来源确有该形制时呈现；衣褶疏落且顺随实际衣片结构。'
assert new.count(a)==1;new=new.replace(a,b,1)
a='主体设色配比：主体明文服装与配器主色为第一主色，以大面积稳定基底承托，中等强度色作主体层次，少量高识别色仅作点睛。'
b='主体设色配比：各区服装与配器以主体明文主色大面积铺陈，深色衣装保持深色基底，亮部仅用于结构转折；辅色与点睛色服从来源。配器按主体命名的类别与长短绘制，短刀保持短鞘比例，挂载连接件与实际佩挂位置清楚。'
assert new.count(a)==1;new=new.replace(a,b,1)
c['positive_text']=new;c['rgba_positive']=new
paths=[p]+[Path(r['path']) for r in json.loads((OUT/'mirror-data-sync.json').read_text())]
receipt=[]
for target in paths:
 before=target.read_text();obj=json.loads(before);idx=next(i for i,t in enumerate(obj['types']) if t['zh']=='设定卡')
 assert obj['types'][idx]['positive_text']==old,target
 obj['types'][idx]=c
 backup=OUT/'v2-backups'/target.relative_to('/');backup.parent.mkdir(parents=True,exist_ok=True);assert not backup.exists()
 shutil.copy2(target,backup);assert target.read_text()==before
 data=json.dumps(obj,ensure_ascii=False,indent=2)+'\n';target.write_text(data)
 receipt.append({'path':str(target),'before':hashlib.sha256(before.encode()).hexdigest(),'after':hashlib.sha256(data.encode()).hexdigest()})
(OUT/'v2-changes.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
print('card v2 synced',len(paths))
