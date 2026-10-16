"""Verify revision integrity without Git or generation; emit concise review artifacts."""
from pathlib import Path
from datetime import datetime
import ast, collections, difflib, hashlib, json, re, urllib.request
import yaml
from qi21_prompt_revision import ROOT, OUT, sha
rows=json.loads((OUT/'changes.json').read_text())
dist=json.loads((OUT/'distribution.json').read_text())
targets={x['target'] for x in dist['files']}
primary=[x for x in rows if x['path'] not in targets]
by_path={x['path']:x for x in rows}
checks=[]
def check(name,ok,detail):
 checks.append({'name':name,'ok':bool(ok),'detail':detail})
def load(p):return json.loads(Path(p).read_text())
def differences(a,b,p=''):
 if type(a)!=type(b):return [(p,a,b)]
 if isinstance(a,dict):
  out=[]
  for k in sorted(a.keys()|b.keys()):
   if k not in a or k not in b:out.append((p+'.'+k,a.get(k),b.get(k)))
   else:out+=differences(a[k],b[k],p+'.'+k if p else k)
  return out
 if isinstance(a,list):
  if len(a)!=len(b):return [(p,a,b)]
  return [v for i,(x,y) in enumerate(zip(a,b)) for v in differences(x,y,f'{p}[{i}]')]
 return [] if a==b else [(p,a,b)]
bad=[]
for row in rows:
 p=Path(row['path'])
 if not p.exists() or sha(p.read_bytes())!=row['after']:bad.append(str(p))
 if row['before'] is not None and sha(Path(row['backup']).read_bytes())!=row['before']:bad.append('backup:'+str(p))
check('changed_files_and_original_backups',not bad,{'files':len(rows),'errors':bad})
bad=[x['target'] for x in dist['files'] if Path(x['source']).read_bytes()!=Path(x['target']).read_bytes()]
check('distribution_byte_identity',not bad,{'targets':len(targets),'errors':bad})
asset_rows=load(OUT/'asset-field-changes.json');actual=[];counts={}
for row in primary:
 p=Path(row['path'])
 if p.parent.name!='store':continue
 old=load(row['backup']);new=load(p);diff=differences(old,new)
 actual.extend((str(p),k,a,b) for k,a,b in diff)
 key={'characters.json':'characters','scenes.json':'scenes','props.json':'items'}[p.name]
 counts[p.name]=len(new['state'][key])
 expected={(x['field'],x['before'],x['after']) for x in asset_rows if x['file']==str(p)}
 check('asset_only_reviewed_fields:'+p.name,set(diff)==expected,{'changed_fields':len(diff),'records':counts[p.name]})
check('asset_total',len(actual)==20 and sum(counts.values())==75,{'fields':len(actual),'records':counts,'edited_records':len({(x['file'],x['id']) for x in asset_rows}),'id_media_and_other_fields':'unchanged by recursive comparison'})
M=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
b=load(M/'json/qi21_bases.json');c=load(M/'ma_sync/runtime-contract.json')
canonical=json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
check('runtime_contract_fingerprints',sha(canonical)==c['contractSha256'] and c['localRevision']['styleSourceSha256']==sha((M/'json/qi21_bases.json').read_bytes()),{'contract':c['contractSha256']})
flowchecks=[]
for row in primary:
 p=Path(row['path'])
 if p.suffix!='.json' or not ('/workflows/' in str(p) or '/subgraphs/' in str(p)):continue
 new=load(p);old=load(row['backup'])
 # All pre-existing links must remain, with only purpose input links appended.
 for graph in new.get('definitions',{}).get('subgraphs',[]):
  og=next(g for g in old.get('definitions',{}).get('subgraphs',[]) if g['id']==graph['id'])
  beforelinks=og.get('links',[]);afterlinks=graph.get('links',[])
  check('old_subgraph_links:'+p.name+':'+str(graph['id']),all(l in afterlinks for l in beforelinks),{'before':len(beforelinks),'after':len(afterlinks)})
  purposes=[(i,x) for i,x in enumerate(graph.get('inputs',[])) if x['name']=='组装用途']
  if purposes:
   i,slot=purposes[0];assert i==len(graph['inputs'])-1
   link=next(l for l in graph['links'] if l['id']==slot['linkIds'][0]);node=next(n for n in graph['nodes'] if n['id']==link['target_id'])
   ok=link['origin_id']==-10 and link['origin_slot']==i and node['inputs'][link['target_slot']]['name']=='组装用途' and node['inputs'][link['target_slot']]['link']==link['id'] and graph['state']['lastLinkId']>=link['id']
   names=['BASE','BASE负面','主体句','主体句负面','锁层A全文','组装用途'];ok=ok and dict(zip(names,node['widgets_values']))==node['widgets_values_named'] and node['widgets_values_named']['组装用途']=='局部编辑'
   check('purpose_boundary_and_widget_order:'+p.name,ok,{'input_slot':i,'link':link['id'],'node':node['id']})
   host=next(n for n in new['nodes'] if n['type']==graph['id'])
   check('host_purpose_default:'+p.name,host['widgets_values'][-1]=='局部编辑' and host['widgets_values_named']['组装用途']=='局部编辑',{'default':host['widgets_values'][-1]})
 # Compare every pre-existing sampler/schedule/speed node (including nested graphs).
 def sampling(d):
  out={}
  for graph in [d]+d.get('definitions',{}).get('subgraphs',[]):
   for node in graph.get('nodes',[]):
    if re.search('sampl|sigma|schedul|speed',node.get('type',''),re.I):out[(graph.get('id','root'),node['id'])]=node
  for k,v in d.items():
   if isinstance(v,dict) and re.search('sampl|sigma|schedul|speed',v.get('class_type',''),re.I):out[('api',k)]=v
  return out
 check('sampling_settings_unchanged:'+p.name,sampling(old)==sampling(new),{'nodes':len(sampling(new))})
 flowchecks.append(str(p))
# Review the entire relevant document surface, including unmodified references.
q=ROOT/'docs/prompts/Qwen-Image-2.1'
docs=list(M.rglob('*.md'))+list(q.glob('*.md'))+list((ROOT/'docs/prompts').glob('道劫*.md'))
for name in ['qwen-image-2-1-prompter','qwen-image-prompt-en','daojie-charsheet-prompter']:
 docs+=list((ROOT/'.agents/skills'/name).rglob('*.md'))
docs+=list((ROOT/'docs/comfyui-kb').rglob('Qwen-Image-2.1-文生图.md'))
docs=sorted(set(docs))
coverage=[];yamlbad=[];hardbad=[]
hard=re.compile('全文 300-800 字符|底色永远是浅净|光型契约\\(平光|衣物始终完整可穿|衣物必须完整可穿|同一画面左至右并排四视图|必须为「四宫格」|必须使用四宫格')
keywords=re.compile('均匀平光|21:9|400[–—-]500|40\\s*步|同.*seed.*身份|CG.*默认|浅净平涂底')
for p in docs:
 text=p.read_text();changed=str(p) in by_path;hits=[]
 if text.startswith('---\n'):
  try:
   end=text.index('\n---',4);data=yaml.safe_load(text[4:end]);assert isinstance(data,dict)
  except Exception as e:yamlbad.append({'path':str(p),'error':str(e)})
 for i,line in enumerate(text.splitlines(),1):
  if keywords.search(line):hits.append({'line':i,'text':line[:300]})
  if p.is_relative_to(M) and hard.search(line):hardbad.append({'path':str(p),'line':i,'text':line})
 if p.name=='lora_stack.md':reason='K2 LoRA 来源与基模兼容说明；非 Qwen 提示词执行合同，保留来源记录。'
 elif p.name=='art_faction_palette.md':reason='阵营职责配色索引；没有本轮布局、编辑用途或全局光照冲突，无需改动。'
 elif p.parent==q and p.name.startswith(('01','02','03','05','06')):reason='官方机制或历史实验保留；页首及相关章节已限定范围，现行用法指向07–09和JSON真源。'
 elif p.name=='07_九型配方.md' or (p.parent==ROOT/'docs/prompts' and p.name.startswith('道劫')):reason='日期实验/K2历史材料保留；已增现行入口和历史适用范围，未把旧参数改造成实拍结论。'
 elif '/references/' in str(p):reason='官方配方与通用能力参考；语言字数仅适用于官方PE配方，术语和示例按任务选择。'
 else:reason='现行合同或配套手册，已同步本轮画法/用途/布局/来源事实边界。' if changed else '通用示例/能力说明，核查后未发现本轮需改的道劫执行合同。'
 coverage.append({'path':str(p),'changed':changed,'review':reason,'keyword_hits':hits})
check('frontmatter_valid',not yamlbad,{'errors':yamlbad})
check('manual_obsolete_hard_rules_removed',not hardbad,{'errors':hardbad})
initial=load(OUT/'document-scan-before.json');missing=[x['path'] for x in initial if str(ROOT/x['path']) not in by_path]
check('initial_document_hits_addressed',not missing,{'initial_documents':len(initial),'unaddressed':missing})
check('manual_coverage',len(list(M.rglob('*.md')))==25,{'manual_documents':25,'changed':sum(x['changed'] for x in coverage if Path(x['path']).is_relative_to(M))})
check('test_logs', '55 passed' in (OUT/'backend-tests.log').read_text() and '94 passed' in (OUT/'frontend-tests.log').read_text(),{'python':55,'vitest':94})
layer=load(OUT/'layer-scan-after.json');sync=load(OUT/'ma-internal-check.json')
check('layer_and_internal_sync',not layer['conflicts'] and all(x['count']==0 for x in layer['clash'].values()) and sync['ok'],{'type_clashes':len(layer['clash']),'conflicts':layer['conflicts'],'ma_check':'internal only; external historical source not overwritten'})
probe={}
for endpoint in ['queue','object_info']:
 try:
  with urllib.request.urlopen('http://127.0.0.1:17001/'+endpoint,timeout=2) as response:probe[endpoint]={'status':response.status}
 except Exception as exc:probe[endpoint]={'error':str(exc)}
result={'created':datetime.now().astimezone().isoformat(),'ok':all(x['ok'] for x in checks),'checks':checks,'counts':{'primary_existing_files':len(primary),'modified_documents':sum(x['changed'] for x in coverage),'documents_reviewed':len(coverage),'distribution_targets':len(targets),'asset_fields':len(actual),'asset_records_edited':len({(x['file'],x['id']) for x in asset_rows})},'engine_probe':probe,'limits':['未生图；仅允许viggle 9步双段，未启用其它慢档','未运行浏览器graphToPrompt','未打包；app.asar内的前端代码与内联合同未更新','仅同步本轮改动的资源文件，未整树覆盖'],'workflow_files':flowchecks}
(OUT/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
(OUT/'document-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')
md=['# 文档整体核查','',f'共核查 {len(coverage)} 篇，修改 {sum(x["changed"] for x in coverage)} 篇；每篇结论如下。','', '| 文件 | 本轮修改 | 核查结论 |','|---|---|---|']
for x in coverage:
 p=Path(x['path']);md.append(f'| [{p.relative_to(ROOT)}]({p}) | {"是" if x["changed"] else "否"} | {x["review"]} |')
(OUT/'document-coverage.md').write_text('\n'.join(md)+'\n')
with (OUT/'source-changes.diff').open('w') as output:
 for x in primary:
  if not x['backup']:continue
  output.writelines(difflib.unified_diff(Path(x['backup']).read_text().splitlines(True),Path(x['path']).read_text().splitlines(True),fromfile=x['backup'],tofile=x['path']))
print(json.dumps({'ok':result['ok'],'counts':result['counts'],'failed':[x for x in checks if not x['ok']],'engine':probe},ensure_ascii=False))
raise SystemExit(0 if result['ok'] else 1)
