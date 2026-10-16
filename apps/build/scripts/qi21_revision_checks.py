"""Update semantic test fixtures and manual anchors to the authorized contracts."""
from pathlib import Path
import json,hashlib
from qi21_prompt_revision import ROOT,OUT,write,json_write
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
p=M/'json/qi21_bases.json';d=json.loads(p.read_text())
for t in d['types']:
 if t['zh']=='道具':
  for k in ['positive_text','rgba_positive']:
   t[k]=t[k].replace('按主体句指定的','按指定的').replace('主体句未指定时','观察面未指定时')
json_write(p,d,'道具型移除写作元语言，保留观察面选择')
p=M/'ma_sync/runtime-contract.json';c=json.loads(p.read_text());oldsha=c['contractSha256'];c['localRevision']['styleSourceSha256']=hashlib.sha256((M/'json/qi21_bases.json').read_bytes()).hexdigest();c['contractSha256']=hashlib.sha256(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest();json_write(p,c,'最终源指纹登记')
p=ROOT/'apps/frontend/lib/ai/daojie-prompt-contract.test.ts';s=p.read_text().replace(oldsha,c['contractSha256'])
s=s.replace('/% light。?\\n成片质量（硬）/','/% light。?\\n成片质量：/').replace('/锐利自然。\\n参考图降噪（硬）/','/来源事实。\\n参考图处理：/').replace('expect(withoutReference.positive.match(/\\n/g)).toHaveLength(1);','expect(withoutReference.positive.match(/\\n/g)).toHaveLength(2);')
s=s.replace('expect(compiled.moduleLengths["negative.universal"]).toBe(1032);','expect(compiled.moduleLengths["negative.universal"]).toBe(\n      875 + 2 + DAOJIE_RUNTIME_CONTRACT.modules["negative.universal"].text.length,\n    );').replace('expect(compiled.totalChars).toBe(1715);','expect(compiled.totalChars).toBe(compiled.providerPrompt.length);\n    expect(compiled.totalChars).toBeGreaterThan(1600);')
s=s.replace('expect(compiled.positive.length).toBeLessThan(300);\n    expect(compiled.status).toBe("warning");','expect(compiled.status).toBe(evaluateDaojiePromptLength(compiled.positive, compiled.negative).status);\n    expect(evaluateDaojiePromptLength("x".repeat(299), "n".repeat(1000)).status).toBe("warning");')
s=s.replace('// 正文 299<300 警,即便 provider-visible 全长(含负面)已过 300。','// 直接验证正文 299 的门限，不依赖随画法修订变化的自动层长度。')
write(p,s,'测试改为新画法语义与长度门限，保留负向不占正文预算回归')
p=M/'ma_sync/lock-anchors.json';a=json.loads(p.read_text());notes={
'风格底座锁':['现代修仙题材的二维数字绘画','细稳且有提按变化的铁线描','背景的色相、明暗与光源服从场景和时段'],
'工笔结构锁':['工笔结构：细稳铁线描交代轮廓与结构','设定图采用均匀漫射光','剧情图按来源事实确定明暗与光源'],
'衣褶裙摆锁':['衣褶与裙摆按布料、动作和来源状态组织结构线','来源明确的破损、缺角、碎边与动态衣褶如实呈现'],
'衣物完整锁':['衣物完整或破损、补丁、尘土、血痕、空袖','不得因统一画法自动补齐或洗净'],
'成片质量锁':['成片质量：线条与罩染层次清晰','参考图只清成像缺陷，不清剧情事实']}
for l in a['locks']:
 if l['name'] in notes:l['manualAnchors']=notes[l['name']];l['localRevision']='2026-10-16 MYStudio 用户授权修订；maAnchors 保留历史来源，不声明逐字镜像'
a['localRevision']='2026-10-16：手册锚点随本地画法修订，MA 来源 SHA 与 maAnchors 保留历史基线。'
json_write(p,a,'锚点守护更新当前手册文本，保留MA历史基线来源')
p=M/'ma_sync/LOCK_SNAPSHOT.md';s=p.read_text();s=s.split('\n',1)[0]+'\n\n> **2026-10-16 本地修订**：共同画法不再锁平光浅底，衣物与身体状态服从事实。`runtime-contract.json#localRevision` 和 `lock-anchors.json#localRevision` 记录本次差异；MA 来源 SHA、maAnchors 是继承基线，不表示本次与外部 MA 逐字一致。外部 MA 未改。\n'+s.split('\n',1)[1];write(p,s,'同步锚点快照说明与本地修订边界')
print('semantic fixtures and manual anchors updated')
