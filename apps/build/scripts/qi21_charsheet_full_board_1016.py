"""Apply the approved full character-board type and whole-type PE preservation."""
from pathlib import Path
import hashlib,json,shutil
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/daojie-charsheet-full-board-1016'
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
receipts=[]
def save(p,text):
    before=p.read_bytes(); after=text.encode()
    if before==after:return
    b=OUT/'backups'/p.relative_to(ROOT);b.parent.mkdir(parents=True,exist_ok=True)
    assert not b.exists(),b
    shutil.copy2(p,b);assert p.read_bytes()==before
    p.write_bytes(after)
    receipts.append({'path':str(p),'backup':str(b),'before':hashlib.sha256(before).hexdigest(),'after':hashlib.sha256(after).hexdigest()})
p=M/'json/qi21_bases.json';d=json.loads(p.read_text());old=json.loads(p.read_text());c=next(t for t in d['types'] if t['zh']=='设定卡')
assert '固定六个图像区' in c['positive_text']
positive=(OUT/'type-positive.txt').read_text().strip()
c.update(positive_text=positive,rgba_positive=positive,aspect_ratio='21:9 (Ultrawide)',megapixels=3.0,rgba_default=False,
    purpose='完整横向角色设定板：主视觉、来源资料与五枚色样、正侧背三视图、两幅头部近景、四幅逐格人物细节，以及武器、材质、装备、能力四个底部专项区。位置、数量、取景由类型句明确；未知能力留空标注，灵兽另附板。默认不透明。',
    postprocess='核对逐区位置、数量、角色及物件一致性；校对中文标签与来源资料，能力未设定时不虚构效果；文字错误可后期修正。灵兽按来源另做附板。',
    recipe_version='v0.4(1016 完整设定板逐区逐格版，待新实图验收)')
c['negative_text']=c['negative_text'].replace('实体背景，背景景物，','')
assert {**d,'types':[t for t in d['types'] if t['zh']!='设定卡']}=={**old,'types':[t for t in old['types'] if t['zh']!='设定卡']}
save(p,json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=ROOT/'apps/backend/comfyui/my_nodes/nodes/my_qi21_api_pe.py';s=p.read_text()
s=s.replace('# 设定卡首段为固定版式；首稿、补发和模型救回均须原样保留。','# 设定卡完整类型句为固定版式；多段中的逐格细节、资料与专项区均须保留。')
assert s.count('layout = type_pos.splitlines()[0].strip()')==1
s=s.replace('layout = type_pos.splitlines()[0].strip()','layout = type_pos.strip()')
s=s.replace('设定卡版式丢失或改写:类型句首段须逐字保留','设定卡版式丢失或改写:完整类型句须逐字保留')
s=s.replace('[设定卡版式锁] 类型句首段逐字保留，仅润色人物描述，不增减图像区、视图、文字或色卡。','[设定卡版式锁] 完整类型句所有段落逐字保留，仅润色人物描述；不得省略或改写资料、色样、三视图、逐格细节与底部专项区，来源未提供的能力与物件不得补造。')
save(p,s)
p=ROOT/'apps/backend/comfyui/my_nodes/tests/test_qi21_charsheet_six_zone.py';s=p.read_text()
s=s.replace("assert '固定六个图像区' in card['positive_text']","assert '完整横向角色设定板' in card['positive_text']")
s=s.replace("assert '四幅全身像、一幅面部近景和一幅局部特写' in card['positive_text']","assert '四幅全身人物、两幅头部近景、四幅人物细节' in card['positive_text']")
s=s.replace("card['positive_text'].splitlines()[0]","card['positive_text']")
s=s.replace("assert '固定六个图像区' in original","assert '完整横向角色设定板' in original")
s=s.replace("original.replace('固定六个图像区', '固定九个图像区', 1)","original.replace('右栏第三行固定四格', '右栏第三行固定六格', 1)")
s=s.replace("good.replace('固定六个图像区', '固定九个图像区', 1)","good.replace('底部第三区为装备结构', '底部第三区为表情差分', 1)")
save(p,s)
p=ROOT/'apps/backend/comfyui/my_nodes/tests/test_flux3_daojie_adapter.py';s=p.read_text();assert '"设定卡": "固定六个图像区"' in s
save(p,s.replace('"设定卡": "固定六个图像区"','"设定卡": "完整横向角色设定板"'))
p=ROOT/'apps/backend/comfyui/my_nodes/tests/test_my_qi21_base.py';s=p.read_text()
s=s.replace('RGBA_DEFAULT_TYPES = {"道具", "人物多视图", "高清人脸", "表情差分", "设定卡"}  # 1016 终审翻真:设定卡入列(透明底档案卡)','RGBA_DEFAULT_TYPES = {"道具", "人物多视图", "高清人脸", "表情差分"}  # 1016 完整设定板默认不透明')
import math
wh=tuple(round(v/8)*8 for v in (math.sqrt(3*1024*1024*21/9),math.sqrt(3*1024*1024*9/21)))
s=s.replace('"设定卡": (1672, 944)',f'"设定卡": {wh}')
s=s.replace('# 1015 设定卡=16:9/1.5MP(native_px 同场景档宽高,公式路独立钉)','# 1016 完整设定板=21:9/3MP，默认不透明；公式路独立钉。')
save(p,s)
(OUT/'source-changes.json').write_text(json.dumps(receipts,ensure_ascii=False,indent=2)+'\n')
print('updated',len(receipts),'type chars',len(positive),'native dimensions',wh)
