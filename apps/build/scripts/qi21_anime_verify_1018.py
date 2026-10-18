"""Fresh offline evidence for the anime style revision; no generation or Git."""
from pathlib import Path
import difflib, hashlib, json, sys
from qi21_base_swap_tool import ROOT,MANUAL,SOURCE
OUT=ROOT/'apps/output/automation/qi21-anime-1018'
rows=json.loads((OUT/'changes.json').read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
checks=[]
def check(name,ok,detail):
 checks.append({'name':name,'ok':bool(ok),'detail':detail})
def diff(a,b,path=''):
 if type(a)!=type(b):return [(path,a,b)]
 if isinstance(a,dict):
  assert a.keys()==b.keys(),path
  return [row for k in a for row in diff(a[k],b[k],path+'.'+k)]
 if isinstance(a,list):
  assert len(a)==len(b),path
  return [row for i,(x,y) in enumerate(zip(a,b)) for row in diff(x,y,path+f'[{i}]')]
 return [] if a==b else [(path,a,b)]
problems=[]
for r in rows:
 if sha(Path(r['path']).read_bytes())!=r['after']:problems.append(r['path'])
 if sha(Path(r['backup']).read_bytes())!=r['before']:problems.append('backup '+r['path'])
check('all_writes_and_original_backups',not problems,{'files':len(rows),'problems':problems})
srcrow=next(r for r in rows if r['path']==str(SOURCE));before=json.loads(Path(srcrow['backup']).read_text());after=json.loads(SOURCE.read_text())
changes=diff(before,after)
(OUT/'source-field-diff.json').write_text(json.dumps([{'field':p,'before':a,'after':b} for p,a,b in changes],ensure_ascii=False,indent=2)+'\n')
allowed=all(p.startswith(('.art_style_base.','.expand_instruction.system_prompt_zh','.layer_contract.')) or (p.startswith('.types[') and p.endswith(('.positive_text','.rgba_positive'))) for p,a,b in changes)
check('source_changes_limited_to_style_and_application',allowed,{'fields':len(changes)})
cardbefore=next(t for t in before['types'] if t['zh']=='设定卡');cardafter=next(t for t in after['types'] if t['zh']=='设定卡')
check('character_sheet_layout_and_all_fields_retained',cardbefore==cardafter,'完整设定卡本轮逐字段未改；新画风由共享底座生效')
for a,b in zip(before['types'],after['types']):
 check('type_metadata_and_negative_retained:'+a['zh'],{k:v for k,v in a.items() if k not in ['positive_text','rgba_positive']}=={k:v for k,v in b.items() if k not in ['positive_text','rgba_positive']},'画幅、透明默认、配方版本、负面与配器/来源约束保持；只改应用画法')
style=after['art_style_base']['positive_text'];forbidden=['背景','光照','光源','布局','构图','衣物','身体状态','近景','远景','时段']
check('pure_style_layer',style.startswith('美术风格底座：国风二维动漫手绘插画。') and not any(w in style for w in forbidden),{'characters':len(style)})
check('no_anime_or_cel_negative',all(w not in after['art_style_base']['negative_text'] for w in ['动漫','赛璐璐','anime','cel shading']),after['art_style_base']['negative_text'])
graphfields=[]
for r in rows:
 p=Path(r['path'])
 if not p.is_relative_to(ROOT/'apps/backend/engines/comfyui') or p.suffix!='.json':continue
 if '/workflows/' not in str(p) and '/subgraphs/' not in str(p):continue
 delta=diff(json.loads(Path(r['backup']).read_text()),json.loads(p.read_text()))
 ok=all(isinstance(a,str) and isinstance(b,str) and ((a.startswith('美术风格底座：中式手绘') and b==style) or (a==before['art_style_base']['negative_text'] and b==after['art_style_base']['negative_text'])) for path,a,b in delta)
 check('graph_only_prompt_string_changes:'+p.name,ok,{'fields':len(delta)})
 graphfields.extend({'file':str(p.relative_to(ROOT)),'field':path,'before':a,'after':b} for path,a,b in delta)
(OUT/'workflow-field-diff.json').write_text(json.dumps(graphfields,ensure_ascii=False,indent=2)+'\n')
c=json.loads((MANUAL/'ma_sync/runtime-contract.json').read_text());canonical=json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
check('runtime_contract_matches_source',c['modules']['style.gongbi-base']['text']==style and c['localRevision']['styleSourceSha256']==sha(SOURCE.read_bytes()) and c['contractSha256']==sha(canonical),c['contractSha256'])
dist=json.loads((OUT/'distribution.json').read_text())['files'];bad=[x['target'] for x in dist if Path(x['source']).read_bytes()!=Path(x['target']).read_bytes()]
check('revision_disk_copies_equal',not bad,{'targets':len(dist),'problems':bad})
sys.path.insert(0,str(ROOT/'apps/backend'))
from engines.comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase
from engines.comfyui.my_nodes.nodes.my_qi21_prompt_assembly import MyQi21PromptAssembly
subjects={'人物':'一位年轻女修，青玉色道袍，月白腰带，乌黑长发半束，素银簪。','设定卡':'青年刀修，玄色劲装，乌黑长发高束马尾，腰侧黑革刀带悬短刀，短刀完整收在黑鲨皮鞘中。','场景':'清晨的宗门山门，石阶向上延伸，青灰云海位于阶下。'}
assembled=[]
for name,subject in subjects.items():
 result=MyQi21DaojieBase().run(name,透明覆盖=False)
 prompt,negative=MyQi21PromptAssembly().assemble(主体句=subject,BASE=result[0],BASE负面=result[3])
 check('real_assembler:'+name,(prompt.startswith('主体句:'+subject) if name=='设定卡' else prompt.startswith(style)) and prompt.count(style)==1 and subject in prompt,{'width':result[1],'height':result[2],'characters':len(prompt)})
 assembled.append({'type':name,'subject':subject,'prompt':prompt,'negative':negative,'width':result[1],'height':result[2]})
(OUT/'assembled-prompts.json').write_text(json.dumps(assembled,ensure_ascii=False,indent=2)+'\n')
# Read the full document surface locally; report only metadata and matches.
paths=set(MANUAL.rglob('*.md'))|set((ROOT/'docs/prompts/Qwen-Image-2.1').glob('*.md'))|set((ROOT/'docs/prompts').glob('道劫*类型*.md'))
coverage=[];changed={r['path'] for r in rows}
for p in sorted(paths):
 text=p.read_text();hits=[{'line':i,'text':line} for i,line in enumerate(text.splitlines(),1) if any(w in line for w in ['非二次元','偏写实不走','禁止赛璐璐','严禁高饱和动漫','赛璐璐平涂/日式动漫风'])]
 coverage.append({'file':str(p.relative_to(ROOT)),'changed':str(p) in changed,'current_override':'2026-10-18 当前执行口径' in text,'historical_or_conflict_hits':hits})
(OUT/'document-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
primary=[r for r in rows if Path(r['path']).is_relative_to(ROOT) and not Path(r['path']).is_relative_to(ROOT/'apps/release')]
with (OUT/'source-changes.diff').open('w') as out:
 for r in primary:
  p=Path(r['path']);out.writelines(difflib.unified_diff(Path(r['backup']).read_text().splitlines(True),p.read_text().splitlines(True),fromfile='before/'+str(p.relative_to(ROOT)),tofile='after/'+str(p.relative_to(ROOT))))
(OUT/'verification.json').write_text(json.dumps({'ok':all(x['ok'] for x in checks),'checks':checks},ensure_ascii=False,indent=2)+'\n')
report=['# 道劫动漫画风修订（2026-10-18）','', '## 当前底座','',style,'','## 旧版与新版','', '| 项目 | 旧版 | 新版 |','|---|---|---|','| 主次 | 工笔淡彩在先，末尾追加动漫面貌 | 国风二维动漫开篇，传统画法辅助 |','| 造型 | 动漫作为抽象趣味 | 明确概括造型、白描线条、分层色面与简洁明暗色块 |','| 用色 | 清淡雅致与适度提饱和并置 | 丰富明快、主辅点睛层级明确 |','| 分层 | 底座含动态布局 | 布局与背景光照只归类型和来源 |','| 负向 | 排斥赛璐璐、空气透视 | 解除动漫画法冲突，约束摄影式体积塑形 |','', '## 修改范围','',f'- 修改主仓既有源码、手册、工作流与测试 {len(primary)} 个文件；另新增本轮操作脚本 6 件（revision/docs/snapshots/finalize/distribute/verify）；磁盘分发 {len(dist)} 处。', '- 类型中的面部改为动漫概括五官，头发改为清楚发束；道具与背景采用同一动漫线描设色应用。角色事实、主色、武器、伤痕、画幅和配方版本未改。','- 设定卡本轮逐字段保持，分区、位置、视图数量与标题未改。','- 扩写指令按用途保留来源照明，以动漫明暗色块呈现，停止主动增添技术布光与写实体积术语。','- 前端运行时合同与三轨文案、分层契约、风格锚同步；MA原始来源SHA和原文引用继续作为历史证据。','- 当前手册修正动漫禁项；参考研究保留原文但显式声明现行动漫规则优先。官方示例及历史归档不重写。',f'- 文档表面本地扫描 {len(coverage)} 篇，清单见 document-coverage.json；逐文件差异见 source-changes.diff，JSON字段差异见 source-field-diff.json。','', '## 验证','', '- Python：737 passed；前端合同：48 passed；MA内部合同与本地锚一致性通过。',f'- 本报告独立校验 {len(checks)} 项：'+('全部通过。' if all(x['ok'] for x in checks) else '有失败，见 verification.json。'), '- 实际装配器已导出人物、设定卡、场景三种提示词输入，见 assembled-prompts.json；没有提交图像生成任务。','- 已备份全部改动前内容；baseline-vocabulary-check.txt 记录修改前已经存在的树石词汇断言失败。', '', '## 生效与限制','', '- 装机 Resources、已有构建资源、MA及工作室手册镜像、引擎数据和已有对应工作流副本已落盘；本轮未打包、未关闭应用、未重启引擎、未重载用户已开画布。','- ComfyUI节点热读新底座；已开画布的预填文本需要重新打开工作流后显示。前端 ASAR 内联的资产合同没有重新编译，需下次明确打包时进入应用代码。','- 实际画风效果尚未出图检验，不能由文本与测试通过代替。','- 全库磁盘审计另有4处与本次文本修改无关的漂移：两件加速子图的引擎副本、两件 Fisher 工作流用户副本；原样保留，见 canvas-disk-audit.log。', '', '## 主仓文件清单','']
report.extend('- `'+str(Path(r['path']).relative_to(ROOT))+'`：'+'；'.join(r['reasons']) for r in primary)
(OUT/'report.md').write_text('\n'.join(report)+'\n')
print(json.dumps({'ok':all(x['ok'] for x in checks),'checks':len(checks),'primary_files':len(primary),'disk_copies':len(dist),'documents_scanned':len(coverage)},ensure_ascii=False))
assert all(x['ok'] for x in checks),[x for x in checks if not x['ok']]
