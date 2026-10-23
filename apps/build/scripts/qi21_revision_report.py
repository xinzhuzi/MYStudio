"""Render the exact change ledger and verified limits into the user delivery report."""
from pathlib import Path
import json,collections
from qi21_prompt_revision import ROOT,OUT
v=json.loads((OUT/'verification.json').read_text());assert v['ok']
rows=json.loads((OUT/'changes.json').read_text());d=json.loads((OUT/'distribution.json').read_text());targets={x['target'] for x in d['files']};primary=[x for x in rows if x['path'] not in targets]
coverage=json.loads((OUT/'document-coverage.json').read_text());assets=json.loads((OUT/'asset-field-changes.json').read_text());concurrent=json.loads((OUT/'concurrent-changes.json').read_text());node=json.loads((OUT/'runtime-node-readonly.json').read_text())
def link(p,label=None):
 p=Path(p);return f'[{label or p.name}](<{p}>)'
def dump(name):return link(OUT/name)
c=v['counts']
text=['# 《道劫》Qwen-Image-2.1 提示词修订交付','',f'核验时间：{v["created"]}。本轮现有源文件/资产库共 {c["primary_existing_files"]} 件，另同步 {c["distribution_targets"]} 个资源副本；范围内扫描核查 {c["documents_reviewed"]} 篇文档，修改 {c["modified_documents"]} 篇。所有原文件的首次修改前备份均保留。','',
'## 具体改了什么','',
'1. **共同画法**：收窄为二维数字绘画、工笔/白描细线、矿物色分染罩染和传统设色。均匀漫射光归设定图；剧情图背景、明暗、光源、磨损、矿尘、血痕和身体状态服从来源，不再全局强加平光浅底、洗净衣服或补齐肢体。',
'2. **布局与类型**：人物多视图采用当前1:1四区，旧21:9横排退为历史记录；道具按主要识别面选择视角，不一律侧视、水平或四宫格。类型层负责布局，主体句只写身份与本图事实。',
'3. **编辑用途**：装配节点增加“新建资产 / 局部编辑 / 画风转换”。旧调用默认新建资产；i2i主流与独立子图默认局部编辑。局部编辑不再追加类型、全局画法和负面；画风转换仅补画法。新控件、子图边界连线、宿主值与命名镜像同步。',
'4. **提示词写法**：自定义链默认中文，长度按复杂度，不把官方PE-T2I英文400–500词规则当模型硬门。关键条件以正向状态表达；固定seed用于对照，不保证身份一致。viggle低CFG不依赖负面槽保证效果；仅保留viggle 9步双段验证入口。',
'5. **应用与衍生模板**：修正应用清理器把剧情光转平光、纸质感转浅底的逻辑；同步MA本地运行合同及指纹，保留外部MA历史来源标识。人物、场景、道具衍生分别按真实用途重写；新建斗室不错误继承客栈大堂布局。',
'6. **整体文档补漏**：总纲、色彩、留白、场景/道具模板及导演手册均核查；清除凑字数、全局浅底、局部编辑重设背景等遗留要求。K2旧步数/LoRA配方、官方原文和日期实验保留并标明范围。设定卡辅助技能默认道劫二维工笔，CG/3D/真人仅按用户显式要求启用。','',
'## 文档覆盖','',f'完整逐篇结果：{dump("document-coverage.md")}；机器可读：{dump("document-coverage.json")}。','',
'| 范围 | 扫描篇数 | 修改篇数 |','|---|---:|---:|']
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng';q=ROOT/'docs/prompts/Qwen-Image-2.1'
groups=[('道劫手册',lambda p:p.is_relative_to(M)),('Qwen机制与用法文档',lambda p:p.parent==q),('道劫同级历史/示例文档',lambda p:p.parent==ROOT/'docs/prompts'),('技能及参考资料',lambda p:p.is_relative_to(ROOT/'.agents/skills')),('提示词工程参考页',lambda p:p.is_relative_to(ROOT/'docs/comfyui-kb'))]
for label,pred in groups:
 subset=[x for x in coverage if pred(Path(x['path']))];text.append(f'| {label} | {len(subset)} | {sum(x["changed"] for x in subset)} |')
text+=['','最初扫描命中的17篇均已处理。未修改的篇目逐篇说明保留理由；关键词扫描命中不等于现行冲突，官方英文配方、历史平光底座、宽银幕美宣比例等均在覆盖表中按语义区分。','',
'## 资产库逐字段变化','',
'23个角色、27个场景、25个道具，共75条记录。递归对比备份：仅20个已列明提示词字段变化，涉及18条记录；ID、媒体路径、图片、数量及其他字段未变。此前入库排除名单未被本轮操作改变。','',
'| 资产 | 字段 | 改动 |','|---|---|---|']
for x in assets:
 why='移除末尾旧横排四图/背景模板，保留人物身份事实' if x['field'].endswith('visualTraits') else '按本类衍生用途重写操作与保留项'
 text.append(f'| {x["name"]}（{x["id"]}） | `{x["field"]}` | {why} |')
text+=['',f'每字段完整前后文本：{dump("asset-field-changes.json")}。','',
'## 现有源文件与资产库完整修改清单','',
'下表含本轮生产文件、文档、原有测试及资产文字；副本另列于分发清单。','',
'| 文件 | 修改内容 |','|---|---|']
for x in primary:
 p=Path(x['path']);label=str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else str(p)
 text.append('| '+link(p,label)+' | '+'；'.join(x['changes']).replace('|','／').replace('\n',' ')+' |')
text+=['','## 新增辅助文件','',
'本地脚本用于分批修订、备份、核查和报告，不代表生成任务已经执行。迁移脚本依赖当时锚点，不建议重复运行；验证脚本可重复运行。','']
new=sorted(set((ROOT/'apps/build/scripts').glob('qi21_revision_*.py'))|{ROOT/'apps/build/scripts/qi21_prompt_revision.py',ROOT/'apps/backend/comfyui/my_nodes/tests/test_qi21_edit_purpose.py'})
for p in new:text.append('- '+link(p,str(p.relative_to(ROOT))))
text+=['','## 分发与实际生效范围','',f'已逐字节核验 {len(targets)} 个目标与对应源文件一致；目标和来源列表见 {dump("distribution.json")}。包括装机资源、当前构建资源、实际项目/默认用户手册、引擎家数据及装配节点。只同步本轮修改的文件，未整树覆盖。','',
'只读查询运行中的17001引擎，装配节点已注册，三用途输入与预期一致：'+dump('runtime-node-readonly.json')+'。本轮没有启动或重启引擎，也没有提交生图任务。','',
'**未打包**：资源文件与手册已同步；前端TypeScript和内联合同的编译代码仍需重新打包后进入app.asar。当前已打开工作流是否刷新、浏览器graphToPrompt以及真实生图尚未验证。','',
'## 并行变化保留说明','',
'最终哈希审计发现另有设定卡修订：rgba_default改true，强化恰好三个正侧背视角、透明底和配器形状约束，并更新对应测试与05文档。变更作者未确定；这些变化予以保留，**不归为本轮原创修改**。引擎数据位同样出现该修订。其来源指纹、资源副本和测试锚已整合核对。','',
'观测快照与哈希：'+dump('concurrent-changes.json')+'。未覆盖回旧设定卡。','',
'## 验证结果与限制','',
'| 验证 | 结果与证据 |','|---|---|',
'| Python装配、用途、类型、透明协议 | 55项通过：'+dump('backend-tests.log')+' |',
'| 前端合同、提示词清理、手册合同 | 94项通过：'+dump('frontend-tests.log')+' |',
'| TypeScript类型检查 | npm run typecheck退出0：'+dump('typecheck.log')+' |',
'| 修改生产TS文件ESLint | 退出0：'+dump('lint-focused.log')+' |',
'| 三层冲突与11型撞词 | conflicts空，11型均0：'+dump('layer-scan-after.json')+' |',
'| MA同步内部合同 | 内部检查通过，外部MA源未改：'+dump('ma-internal-check.json')+' |',
'| 资产/源文件/备份/分发/指纹 | 全部通过：'+dump('verification.json')+' |',
'| 工作流静态结构 | 旧连线保留，用途边界、宿主默认与widget顺序一致，采样配置与备份相同 |',
'| Markdown frontmatter | 解析通过，新增说明均在YAML闭合之后 |',
'| 真实视觉A/B及完整发布门 | 未运行，不能据此宣称视觉效果或完整媒体链闭环通过 |','',
'前端清理函数的影响分析此前为HIGH（影响资产生成与四宫格调用）；本轮只修改对应措辞，相关回归已通过。两路子代理因工具任务正文异常未执行文件操作，本轮修改与最终验证由主代理完成。','',
'## 核对与备份入口','',
'- 全量文件变更台账与原始SHA：'+dump('changes.json'),
'- 首次修改前备份目录：'+link(OUT/'backups'),
'- 源文件完整差异：'+dump('source-changes.diff'),
'- 最终静态验证：'+dump('verification.json'),
]
(OUT/'report.md').write_text('\n'.join(text)+'\n')
print(json.dumps({'report':str(OUT/'report.md'),'counts':c,'new_scripts_and_test':len(new)},ensure_ascii=False))
