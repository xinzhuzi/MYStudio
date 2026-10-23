"""Resolve residual conflicting templates found by the post-edit audit."""
import json,hashlib
from qi21_prompt_revision import ROOT,OUT,json_write,write
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'; p=M/'json/qi21_bases.json'; d=json.loads(p.read_text())
remove=set('扇贝状裙摆，分叉袍摆，分离飘带，下摆缺角，风碎流苏，乞丐破衣，撕裂下摆，碎边，破洞，磨损补丁，虫蛀布面，垂挂碎条，绳捆破布，刻意破烂造型，拉扯衣袍，分裂衣袍，分叉衣袍，破破烂烂'.split('，'))
for t in d['types']:
 for k in ['positive_text','bg_positive','purpose']:
  if isinstance(t.get(k),str):
   t[k]=t[k].replace('均匀柔光，平涂的底','照明与底色服从场景时段').replace('均匀柔光，画面饱满有焦点张力','光源与明暗服从来源事实，画面保留焦点张力').replace('底色浅净，','底色随场景时段，').replace('底座只锁浅净','底座不锁背景明暗')
 if t['zh']=='道具':remove_prop={'俯视仰视','角度歪斜'}
 else:remove_prop=set()
 t['negative_text']='，'.join(x for x in t.get('negative_text','').split('，') if x not in remove|remove_prop)
d['layer_contract']['doc']='apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/prompt_layering.json'
for s in d['layer_contract']['segments']:
 if s['segment']=='氛围/光': s['types']='设定图漫射光；剧情按用途';s['subject']='时段、光源、方向、色与落点；局部编辑保留未变光照'
d['color_lexicon']['roles']['note']=d['color_lexicon']['roles']['note'].replace('base(底)由美术风格底座锁定浅净平涂工艺','base(底)随用途、场景和时段确定').replace('从色卡选取多种协调彩线色','保持细稳墨线，颜色服从来源事实')
json_write(p,d,'复扫清场景美宣概念型残留平光浅底、衣物负向冲突及道具俯视禁项')
# Re-anchor local source fingerprint after final data edits.
p=M/'ma_sync/runtime-contract.json'; c=json.loads(p.read_text()); c['localRevision']['styleSourceSha256']=hashlib.sha256((M/'json/qi21_bases.json').read_bytes()).hexdigest(); prev=c['contractSha256']; c['contractSha256']=hashlib.sha256(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest();json_write(p,c,'更新修订源指纹')
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';write(p,p.read_text().replace(prev,c['contractSha256']),'指纹随最终数据对齐')
# Refresh all matching snapshots from the baseline (style/type/system) without touching sampling.
ledger=json.loads((OUT/'changes.json').read_text()); row=next(x for x in ledger if x['path']==str(M/'json/qi21_bases.json')); old=json.loads(__import__('pathlib').Path(row['backup']).read_text()); mapping={}
for k,v in old['art_style_base'].items():
 if isinstance(v,str) and k in d['art_style_base']:mapping[v]=d['art_style_base'][k]
for ot,nt in zip(old['types'],d['types']):
 for k,v in ot.items():
  if isinstance(v,str) and k in ['positive_text','rgba_positive','bg_positive','purpose','negative_text']:mapping[v]=nt.get(k,v)
mapping[old['expand_instruction']['system_prompt_zh']]=d['expand_instruction']['system_prompt_zh']
def transform(v):
 if isinstance(v,dict): return {k:transform(x) for k,x in v.items()}
 if isinstance(v,list):return [transform(x) for x in v]
 return mapping.get(v,v) if isinstance(v,str) else v
for p in (ROOT/'apps/backend/comfyui/workflows').rglob('qi21-道劫-?2i.json'):
 w=transform(json.loads(p.read_text()))
 for g in [w]+w['definitions']['subgraphs']:
  for n in g['nodes']:
   if n['type'] in ['Note','MarkdownNote'] and n['id']==402 and 'i2i' in p.name:
    n['widgets_values']=['道劫图生图：先核对实际输入图数量；单图自然指称，多图用 <imageN> 分工。组装用途：局部编辑仅拼操作和保留项，画风转换加画法，新建资产加类型与画法。默认单图换上衣颜色；未使用参考槽保持旁路。仅用 viggle 9 步双段，失败不切慢档。规范：docs/prompts/Qwen-Image-2.1/09-图生图指令写作规范.md；十型手册：apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/art_prompt/art_subject_ten_types.md。']
 json_write(p,w,'复扫刷新型文与扩写教材快照；图生图速查同步用途、引用和viggle限定')
print('refined residual contracts')
