"""Sync current responsibility documentation and the app's compiled prompt contract."""
from qi21_style_type_revision_1016 import ROOT,OUT,SOURCE,save,save_json,sha
from pathlib import Path
import json
base=SOURCE.parent.parent
source=json.loads(SOURCE.read_text())
p=base/'json/prompt_layering.json'
d=json.loads(p.read_text())
for key in ('p2_three_level','p3_slot'):
 d['principles'][key]=source['layer_contract']['principles'][key]
d['layers']['style_base']['owns']['负面·全局']='只包含画风与成像工艺负面；人体、文字及背景缺陷归类型句。viggle BasicGuider 不消费独立负向，必要限制写正向。'
d['layers']['type_base']['owns']['环境·画法']='类型句规定背景呈现：人物与叙事图按来源场景组织近远景；场景与概念图按用途分层并保留净空；透明素材主体以外为透明区域，实际场景、底色色相与时段由主体句提供。'
d['layers']['type_base']['owns']['光·强度档']='类型句规定照明规则：设定图采用便于辨认的均匀漫射光；剧情与美宣按来源场景、时段和叙事照明。主体句填具体光源、方向、色温与落点。'
d['layers']['type_base']['owns']['解剖与部件规则(人物系)']='类型句规定来源状态保留：年龄、体型、衣物磨损、尘土、血痕、器物缺损和肢体状态依来源呈现；多视图逐格一致。具体事实由主体句供给。'
d['light_mood_asymmetry']['light']='照明规则归类型句，来源时段、光源方向、色温与落点归主体句。画法底座不包含照明、背景或具体状态；局部编辑保留未变照明。'
d['style_ui']=source['layer_contract']['style_ui']
save_json(p,d)
p=base/'json/README.md'
s=p.read_text()
a=s.index('> **底座职责（2026-10-16 纠正）**：');b=s.index('\n',a)
s=s[:a]+'> **底座职责（2026-10-16 纠正）**：`art_style_base.positive_text` 只描述绘画语言与成像工艺，保留“成像工艺干净，线条与罩染层次清晰。”；`negative_text` 只约束风格与成像工艺。背景、光照和状态呈现规则归 `types[].positive_text`，透明回退同步使用 `rgba_positive`，主体句填写具体来源事实。风格节点只展示“美术风格／负向词表”两框，主口输出纯风格正文；背景件、透明件与协议框退出风格节点。旧四段存档只兼容读取画法和风格负向，背景段不再装配。'+s[b:]
s=s.replace('通用成像工艺)+全局负面词','通用成像工艺)+风格与成像工艺负向词')
s=s.replace('透明路头尾句(中英)与W1收束句','透明路英文头尾、`subject_isolation` 承载句与旧W1收束句')
s=s.replace('透明路格式锁——仅 rgba_default 型持有;ApiPE 极简公式体(头英句+主体句+本字段+尾英句)。纯框架零绘画词:平涂/罩染/设色/背景语言不得入内(1008 R3定谳:富装配17句画背景命令以6.7~8.3:1淹没透明指令)', '透明路类型句——透明默认五型持有；极简回退保留构图、均匀漫射光和来源状态规则。不得加入实体背景、平涂底色或重复画法；最终输出层统一追加英文透明头尾')
s=s.replace('道具/多视图/高清人脸/表情差分四型 true','道具/多视图/高清人脸/表情差分/设定卡五型 true')
s=s.replace('构图格式锁/环境画法/风格应用句/光强度档/多彩行', '构图格式锁/背景呈现/照明/来源状态保留/风格应用句/多彩行')
save(p,s)
p=base/'art_prompt/art_subject_ten_types.md'
s=p.read_text().replace('构图格式锁／画幅参数／背景策略／型级负面','构图格式锁／画幅参数／背景策略／照明规则／来源状态保留规则／型级负面')
s=s.replace('全局负面，装配时自动携带','风格与成像工艺负向，装配时自动携带')
save(p,s)
p=base/'prefix.md'
s=p.read_text()
s=s.replace('### 2. 工笔结构与照明职责','### 2. 类型句的背景、照明与状态职责')
s=s.replace('工笔结构：细稳铁线描交代轮廓与结构，矿物色分染罩染塑形；视觉焦点清楚，远景随空间退开。设定图采用均匀漫射光，剧情图按来源事实确定明暗与光源，不把浅底和平光作为全型要求。', '工笔结构：细稳铁线描交代轮廓与结构，矿物色分染罩染塑形。背景分层、远近虚实、空气透视与净空安排由类型句决定；主体句提供实际场景。设定图采用均匀漫射光，剧情图按来源事实确定明暗与光源；状态保留规则归类型句，具体磨损、血痕和身体状态由主体句依来源填写。以上内容不进入第1项美术风格底座。')
s=s.replace('成片质量：线条与罩染层次清晰，主体、材质和关键部件可读；物体的污渍与磨损服从来源事实。', '成片质量：线条与罩染层次清晰，成像工艺干净。')
s=s.replace('> 以下为现行职责。MA 原始快照', '> 以下第1项是美术风格底座，第2–7项属于类型规则或来源事实，第8项是成像工艺；不合并成风格全文。MA 原始快照')
save(p,s)
p=base/'ma_sync/runtime-contract.json'
d=json.loads(p.read_text())
d['modules']['finish.quality']['text']='成片质量：线条与罩染层次清晰，成像工艺干净。'
track_rules={
 'person':'人物类型句：背景和照明依来源场景与时段；衣物磨损、尘土、血痕和身体状态依来源事实保留。',
 'scene':'场景类型句：光源方向、明暗和天气依来源场景与时段；建筑、地物的完好或破损状态依来源事实保留。',
 'prop':'器物类型句：背景与照明依来源用途；器物的断裂、缺损、磨损、积尘和血痕依来源事实保留。',
}
for track,text in track_rules.items():
 module=d['modules']['style.gongbi-track.'+track]
 module['text']+=' '+text
 module['revisionSource']={'path':'json/qi21_bases.json#types[]','revision':'2026-10-16：三轨类型模块承载背景、照明与来源状态规则；source保留历史基线登记。'}
d['localRevision']['styleSourceSha256']=sha(SOURCE.read_bytes())
d['localRevision']['styleBoundary']='美术风格底座只定义绘画语言与成像工艺；背景、照明和来源状态规则归类型模块，具体事实归主体句。'
for track in track_rules:
 key='style.gongbi-track.'+track
 if key not in d['localRevision']['modules']:d['localRevision']['modules'].append(key)
material={k:v for k,v in d.items() if k!='contractSha256'}
d['contractSha256']=sha(json.dumps(material,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
save_json(p,d)
# Every current boundary annotation receives the same explicit type/subject distinction.
old='共同底座只统一画法；设定图用漫射光，剧情图的明暗、光源、磨损、血痕和肢体状态服从来源事实。'
new='美术风格底座只统一绘画语言与成像工艺；背景、光照和状态呈现规则归类型句，主体句填写具体来源事实。设定型使用均匀漫射光，剧情型按场景和时段照明，透明回退也保留本型状态规则。'
roots=[base,ROOT/'docs/prompts/Qwen-Image-2.1']
coverage=[]
for root in roots:
 for p in sorted(root.rglob('*.md')):
  s=p.read_text()
  if old in s:save(p,s.replace(old,new))
  coverage.append({'path':str(p),'lines':len(s.splitlines()),'updated_boundary':old in s})
# Constitution has no shared top annotation: insert one compact current responsibility note.
p=next((ROOT/'docs/prompts/Qwen-Image-2.1').iterdir().__iter__()) if False else next(p for p in (ROOT/'docs/prompts/Qwen-Image-2.1').iterdir() if p.name.startswith('07-'))
s=p.read_text();lines=s.splitlines()
lines.insert(2,'> **2026-10-16 三层职责**：美术风格底座只定义绘画语言与成像工艺；背景、光照、来源状态保留规则归类型句；主体句只填写本图的具体场景、光源和状态事实。风格节点仅展示美术风格与负向词表。')
save(p,'\n'.join(lines)+'\n')
(OUT/'document-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
print('scanned',len(coverage),'documents; updated contracts, manual and current boundary annotations')
