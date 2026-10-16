"""Shorter closed-layout iteration after v2 duplicated the side view."""
from pathlib import Path
import json,shutil,hashlib
ROOT=Path(__file__).resolve().parents[3];OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016'
p=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json';d=json.loads(p.read_text());c=next(t for t in d['types'] if t['zh']=='设定卡');old=c['positive_text']
layout='同一角色的横向角色设定卡，固定六个图像区。左侧四成宽：一幅主视觉全身立绘。右侧六成宽分两排：上排七成高，等宽三格，左格正面全身、中格朝画面右边的纯侧面全身（鼻尖指向右边缘）、右格背面全身；下排三成高，等宽两格，左格面部近景、右格腰部衣装与佩挂连接结构局部特写。全卡四幅全身像、一幅面部近景和一幅局部特写，六区各一图，分隔清楚。右上三视图标准站姿等高，头顶与脚底分别对齐。'
c['positive_text']=layout+'\n各区同一脸型、发型、服装和配器。服装形制、袖型与长短服从主体：劲装为束袖束腰上衣和双腿裤装；主色原样保留，玄色为近黑色。配器类别、长度与材质按主体事实，短刀配短鞘。局部特写只取自身真实结构。\n细线与薄染交代衣片结构，衣褶疏落；伤痕、旧损、污渍、血痕、残缺与空袖依来源逐区保留。发丝分组，手部与持物接触清楚，佩挂连接件承担重量。均匀漫射光便于辨认结构，主体明文主色统领、辅色呼应、少量点睛色。'
c['rgba_positive']=c['positive_text']
receipt=[]
for target in [p]+[Path(r['path']) for r in json.loads((OUT/'mirror-data-sync.json').read_text())]:
 before=target.read_text();obj=json.loads(before);idx=next(i for i,t in enumerate(obj['types']) if t['zh']=='设定卡');assert obj['types'][idx]['positive_text']==old,target
 obj['types'][idx]=c;b=OUT/'v3-backups'/target.relative_to('/');b.parent.mkdir(parents=True,exist_ok=True);assert not b.exists();shutil.copy2(target,b);assert target.read_text()==before
 after=json.dumps(obj,ensure_ascii=False,indent=2)+'\n';target.write_text(after);receipt.append({'path':str(target),'before':hashlib.sha256(before.encode()).hexdigest(),'after':hashlib.sha256(after.encode()).hexdigest()})
(OUT/'v3-changes.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n');print('v3 card length',len(c['positive_text']))
