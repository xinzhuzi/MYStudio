"""Migrate only the reviewed asset prompt fields; preserve entity/media data."""
from pathlib import Path
import json,copy,re
from qi21_prompt_revision import OUT, json_write
S=next(p/'store' for p in Path('/Users/zhengbingjin/Project/IP').iterdir() if p.name=='MA')
rows=[]
for fn,key in [('characters.json','characters'),('scenes.json','scenes'),('props.json','items')]:
 p=S/fn; d=json.loads(p.read_text()); before=copy.deepcopy(d)
 def put(obj,field,value,loc):
  assert field in obj
  if obj[field]!=value:
   rows.append({'file':str(p),'id':obj['id'],'name':obj.get('name'),'field':loc+'.'+field,'before':obj[field],'after':value});obj[field]=value
 for i,x in enumerate(d['state'][key]):
  if fn=='characters.json':
   s=x.get('visualTraits','')
   if '同一画面从左至右并排四视图' in s:
    # Exact template boundary; all identity/body/clothing facts before it remain.
    a=s.index('同一画面从左至右并排四视图'); s=s[:a]
    for token in ['宣纸白纯色背景','纯色宣纸白背景','纯宣纸白背景']:
     if token in s:s=s[:s.index(token)].rstrip('，,；;。 ')
    if '特写视图仅取头肩:' in s:s=s[:s.index('特写视图仅取头肩:')].rstrip('，,；;。 ')
    put(x,'visualTraits',s+'。',f'state.{key}[{i}]')
   for j,v in enumerate(x.get('variations',[])):
    if v['id']=='var-chapter-001-dugu-grey-town':
     for field in ['visualPrompt','visualPromptZh']:put(v,field,'将画中独孤剑尘调整为灰衫入镇态：灰衫沾有矿尘，背负油布剑包。保持人物面部身份、体态、发型、服装形制、姿势、构图、光照和原有画法不变，其余内容保持原样。',f'state.{key}[{i}].variations[{j}]')
  elif x['id']=='scene-derived-chapter-001-yuelai-room-talk':
   for field in ['visualPrompt','visualPromptZh']:put(x,field,'以输入图中悦来客栈的建筑与材质风貌为参考，新建客栈斗室夜谈的室内场景，承载断剑显露与归元认人的剧情。斗室空间与夜间明暗服从场景来源事实；参考图用于客栈风貌，不保留大堂的房间布局。',f'state.{key}[{i}]')
  elif x['id']=='prop-derived-chapter-001-guiyuan-half-drawn':
   put(x,'visualPrompt','将画中归元断剑的油布解开，使半截断剑露出。保持器物轮廓、比例、材质、结构、已有磨损、构图、光照和原有画法不变，其余内容保持原样。',f'state.{key}[{i}]')
 if d!=before:json_write(p,d,'仅迁移提示词：清旧横排布局、三条衍生模板按人物场景道具用途重写，媒体和事实字段保留')
(OUT/'asset-field-changes.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')
print('asset prompt fields:',len(rows),'unique records:',len(set((r['file'],r['id']) for r in rows)))
