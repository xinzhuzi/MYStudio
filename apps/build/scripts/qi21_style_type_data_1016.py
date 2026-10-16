"""Move rendering context to type clauses, keeping drawing language in style."""
from qi21_style_type_revision_1016 import ROOT, OUT, SOURCE, save_json
import json

old = json.loads(SOURCE.read_text())
data = json.loads(SOURCE.read_text())
style = data['art_style_base']
style['_doc'] = '只定义传统绘画经现代游戏美术重组的绘画语言与成像工艺；不包含主体状态、背景、光照、构图或透明承载。背景、照明与来源状态规则在 types[]；透明输出包装在 rgba。负向词只约束画风与成像工艺，viggle BasicGuider 不消费独立负向条件。'
data['rgba']['subject_isolation'] = style.pop('rgba_text')
style.pop('positive_ground_text')
style.pop('positive_style_text')
moved = ['水印', '多手指', '文字错误', 'UI 界面', 'logo', '均匀锐化背景', '背景高频线描']
style['negative_text'] = '，'.join(t for t in style['negative_text'].split('，') if t not in moved)
rules = {
 '人物': '背景明暗与照明服从来源场景和时段，光源方向与人物受光一致；身体状态依来源设定呈现。',
 '场景': '光源方向、色温与明暗关系服从来源场景、时段和天气；建筑与地物的完好、残破、积尘和受损状态依来源呈现。远景以概括形体、淡墨和软边退开，保留空气透视与场景净空。',
 '道具': '器物设定图采用便于辨认结构的均匀漫射光；来源规定的断裂、缺损、磨损、积尘与血痕按实际状态呈现。透明底时主体以外为透明区域；关闭透明时背景采用主体句指定的简洁底色。',
 '分镜剧情图': '背景色相、明暗与光源服从来源场景、时段和天气，人物与环境受光一致；身体与物件的具体状态依来源事件呈现。远景以概括形体、淡墨和软边退开，保留空气透视与叙事所需净空。',
 '概念气氛图': '光源方向、色温与明暗关系服从来源场景、时段和天气；主体与环境的完好、破损、积尘及其他具体状态依来源呈现。远景以概括形体、淡墨和软边退开，保留空气透视与场景净空。',
}
lean = {
 '道具': '器物设定图采用便于辨认结构的均匀漫射光；器物的断裂、缺损、磨损、积尘与血痕依来源状态呈现。',
 '人物多视图': '设定图采用便于辨认结构的均匀漫射光；衣物磨损、污渍、血痕与身体缺失依来源状态逐格保留。',
 '高清人脸': '头肩设定图采用便于辨认结构的均匀漫射光；可见范围内的伤痕、污渍、血痕与身体状态依来源设定呈现。',
 '表情差分': '各格采用一致的均匀漫射光；可见范围内的伤痕、污渍、血痕与身体缺失依来源状态逐格保留。',
 '设定卡': '各分区采用便于辨认结构的一致均匀漫射光；衣物磨损、污渍、血痕与身体缺失依来源状态逐格保留。',
}
for t in data['types']:
 name = t['zh']
 if name == '道具':
  for key in ('positive_text','rgba_positive'):
   t[key] = t[key].replace('器物主体完整居中，占画面大部', '器物可见范围完整入画并居中，占画面大部')
 if name in rules:
  t['positive_text'] += '\n' + rules[name]
 if name in lean:
  t['rgba_positive'] += lean[name]
 for tok in moved:
  if tok in ('均匀锐化背景','背景高频线描') and t['rgba_default']:
   continue
  current = t['negative_text'].split('，')
  if tok not in current:
   t['negative_text'] += '，' + tok
 if name == '人物':
  t['purpose'] = t['purpose'].replace('底色色相由主体句按设定指定（底座默认暖白系浅净平涂，魔道冷灰底走手册暗色分支）', '背景与光照规则由本类型句承载，主体句指定场景、时段与具体光源；美术风格底座不规定背景或明暗')
 if name == '美宣':
  t['purpose'] = t['purpose'].replace('衣褶破损族、', '')
contract = data['layer_contract']
contract['assembly_order']['positive'][0] = 't2i:[400]主体句 + [4010]types[].positive_text(背景、照明、来源状态规则；透明开剔除中文透明声明) + [4032]纯美术风格正文 → [4013]MyQi21ApiPE 扩写 → [4014]FinalOutput(统一透明包装)'
contract['principles']['p2_three_level'] = '美术风格底座定义画法与成像工艺；类型句定义背景、光照、状态呈现规则；主体句提供来源事实和具体参数。'
contract['principles']['p3_slot'] = '类型句定义用途与呈现规则，主体句填具体事实；美术风格底座不描述对象、状态、背景、光照或透明格式。'
contract['style_ui'] = '美术风格底座仅展示美术风格与负向词表；两个 STRING 出口不变，新输出不含拆件标记。旧四段存档只读取风格与负向，背景件不再装配。'
OUT.mkdir(parents=True, exist_ok=True)
(OUT/'data-before.json').write_text(json.dumps(old,ensure_ascii=False,indent=2)+'\n')
save_json(SOURCE, data)
(OUT/'type-changes.json').write_text(json.dumps([
 {'zh': a['zh'], 'fields': {k:{'before':a.get(k), 'after':b.get(k)} for k in b if a.get(k)!=b.get(k)}}
 for a,b in zip(old['types'],data['types']) if a != b],ensure_ascii=False,indent=2)+'\n')
print('updated style/rgba/layer_contract and',sum(a!=b for a,b in zip(old['types'],data['types'])),'types')
