"""Apply the reviewed, user-authorized prompt data contract revisions."""
from pathlib import Path
import json,hashlib
from qi21_prompt_revision import ROOT, json_write, replace
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
p=M/'json/prompt_layering.json'; d=json.loads(p.read_text()); d['updated']='2026-10-16'
d['truth_sources']['assembly_line']='新建资产=主体句+类型句+画法；局部编辑=编辑指令；画风转换=编辑指令+画法'
d['assembly_order']['edit_purposes']={'新建资产':'主体句、类型句、美术风格底座依次装配','局部编辑':'仅编辑指令；未变内容引用输入图保留','画风转换':'编辑指令与画法；保留参考图构图、照明和来源事实'}
s=d['layers']['style_base']['owns']; s['风格·全部定义']='二维数字绘画；工笔、白描、连环画、传统设色；铁线描提按与矿物色分染罩染。画法清晰不等于物体崭新。'; s['光·类型契约']='共同底座不锁光型或背景明暗；光照服从用途、场景与时段。'; s['负面·全局']='保留质量和风格负面接口；viggle 的 BasicGuider 不消费负向，必要约束须在正向说明。'
t=d['layers']['type_base']['owns']; t['构图/镜头·全部']='新建资产的布局、画幅与视图数量唯一归类型句；道具按可识别用途的观察面展示；主体句不重复横排模板。'; t['光·强度档']='设定图采用便于辨认的均匀漫射光；剧情与美宣按场景时段和叙事照明。'; t['解剖与部件规则(人物系)']='年龄、体型、肢体与衣物状态服从来源事实；设定图保持视图间身份和尺度一致。'; t['负面·型级增补']='仅列真实不需要的伪影；不得排除来源要求的断臂、磨损、血痕或夜景光。'
s=d['layers']['subject_sentence']; s['owns']['光·参数四要素']='新建剧情图写光源、方向、色与落点；局部编辑保持输入图光照，除非本次明确修改。透明素材维持透明背景，不注入场景背景。'; s['forbidden'][-2:]=['必要限制优先写可观察的数量、状态、部件关系；编辑可用明确的保留或排除指令，不依赖负向采样。','修饰链宜拆成短句；每名词仅一个修饰不是模型硬限制。']
for row in d['segment_matrix']:
 if row['segment']=='氛围/光': row.update(style_base='不锁光型',type_base='设定图漫射光；剧情按用途',subject='来源时段、光源与神态；局部编辑保留未变照明')
d['light_mood_asymmetry'].update(_doc='照明与氛围按用途和事实分配',light='画法共同，光照不全局统一。设定图照明归类型层，剧情光源和时段归主体句，局部编辑保留原照明。')
d['cross_rules'][1]='必要限制优先表达成可观察状态；局部编辑明确保留未变项。viggle 不消费负向，不能把必需限制只放负向。'
d['cross_rules'][2]='覆盖原则：来源事实优先；文生图身份段同源，图生图引用实际输入图保留身份，不重描未变属性。'
d['cross_rules'][4]='同源纪律：身份与器物设计使用同源事实；固定 seed 仅用于控制变量对照，不能保证跨图身份一致。'
d['color_fusion']['roles_translation']['base_ink']='底色与明暗服从场景和时段；墨线属于画法，不要求所有背景浅色。'
json_write(p,d,'同步完整版三层契约与三用途、事实照明、负向能力边界')
p=M/'ma_sync/runtime-contract.json'; d=json.loads(p.read_text()); b=json.loads((M/'json/qi21_bases.json').read_text())
texts={'style.gongbi-base':b['art_style_base']['positive_text'],'reference.denoise':'参考图处理：保留人物身份、器物设计、构图、照明，以及来源中的磨损、尘土、血痕和肢体状态；仅处理压缩伪影与重复纹理等成像缺陷。','finish.quality':'成片质量：线条与罩染层次清晰，主体、材质和关键部件可读；物体的污渍与磨损服从来源事实。'}
texts['negative.universal']=d['modules']['negative.universal']['text'].replace('污垢、','').replace('好莱坞电影光、','')
for k,v in texts.items():
 d['modules'][k]['text']=v
 d['modules'][k]['revisionSource']={'path':'json/qi21_bases.json' if k=='style.gongbi-base' else 'prefix.md','revision':'2026-10-16 用户授权的 MYStudio 提示词修订；source 保留 MA 历史基线登记'}
d['localRevision']={'updated':'2026-10-16','scope':'MYStudio 本地画法、参考图保留与质量模块修订；maSources 与 module.source 为继承基线，不声明与外部 MA 逐字一致。','modules':list(texts),'styleSourceSha256':hashlib.sha256((M/'json/qi21_bases.json').read_bytes()).hexdigest()}
d['contractSha256']=hashlib.sha256(json.dumps({k:v for k,v in d.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()
json_write(p,d,'应用运行合同去全局平光浅底和剧情去污，登记本地修订来源并重算指纹')
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'
replace(p,'88bd58dff6980da5d4b731d3ae1874459e258f679493d46d49d388ae98fc41f1',d['contractSha256'],'重锚本地修订合同指纹')
replace(p,'toContain("浅净哑光平涂底")','toContain("背景的色相、明暗与光源服从场景和时段")','验证剧情照明服从事实')
p=ROOT/'apps/backend/comfyui/my_nodes/tests/test_my_qi21_prompt_assembly.py'
replace(p,'7eaaabffcec166f2',hashlib.sha256(b['art_style_base']['positive_text'].encode()).hexdigest()[:16],'共同画法默认值指纹随真源重锚')
print('updated contracts and anchors')
