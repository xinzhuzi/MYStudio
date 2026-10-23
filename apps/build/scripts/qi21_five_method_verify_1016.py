"""Read-only verification of the approved style rollout and preservation boundaries."""
from pathlib import Path
import hashlib,importlib.util,json,re,sys,urllib.request,urllib.parse
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/qi21-five-method-style-1016'
MANUAL=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
SOURCE=MANUAL/'json/qi21_bases.json'
sha=lambda b:hashlib.sha256(b).hexdigest()
new=(OUT/'new-style.txt').read_text().rstrip('\n');old=(OUT/'old-style.txt').read_text().rstrip('\n')
rows=json.loads((OUT/'sync-changes.json').read_text());checks=[]
def check(name,condition,detail=None):
 checks.append({'check':name,'passed':bool(condition),'detail':detail})

for r in rows:
 p=Path(r['path']);data=p.read_bytes()
 graph=p.suffix=='.json' and ('workflows' in p.parts or 'subgraphs' in p.parts)
 expected=r['after']
 if graph and r['group']=='deploy' and '--installed' in sys.argv:
  # Packaging refreshes older installed graphs from the current repository,
  # preserving independent changes already present before this style rollout.
  marker='comfyui/' if '/Contents/Resources/' in str(p) else 'custom_nodes/my-nodes/'
  tail=str(p).split(marker,1)[1]
  repo=ROOT/'apps/backend/comfyui'/('my_nodes/'+tail if marker.startswith('custom_nodes') else tail)
  expected=sha(repo.read_bytes())
 check('deployed-source-bytes' if expected!=r['after'] else 'planned-bytes',sha(data)==expected,str(p))
 if p.name=='qi21_bases.json':check('mirror-style',json.loads(data)['art_style_base']['positive_text']==new,str(p))
 if graph and r['group']=='repo':
  check('workflow-style-only',data.decode().replace(new,old)==Path(r['backup']).read_text(),str(p))

before=json.loads((OUT/'backups/qi21_bases.before-source.json').read_text());after=json.loads(SOURCE.read_text())
check('source-style-verbatim',after['art_style_base']['positive_text']==new,len(new))
check('all-eleven-type-entries-unchanged',before['types']==after['types'],len(after['types']))
check('style-negative-unchanged',before['art_style_base']['negative_text']==after['art_style_base']['negative_text'])
for key in before.keys()|after.keys():
 if key not in ('art_style_base','layer_contract'):check('other-source-field-unchanged',before.get(key)==after.get(key),key)

for p in [Path(r['path']) for r in rows if Path(r['path']).name=='runtime-contract.json']:
 c=json.loads(p.read_text());digest=sha(json.dumps({k:v for k,v in c.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
 check('contract-hash',digest==c['contractSha256'],str(p))
 check('contract-source-hash',c['localRevision']['styleSourceSha256']==sha(SOURCE.read_bytes()),str(p))
 check('contract-style',c['modules']['style.gongbi-base']['text']==new,str(p))

scope=set()
for rel in ['qi21-painterly-ab-1016/document-coverage.json','qi21-color-hierarchy-1016/document-coverage-full.json']:
 scope.update(Path(r['path']) for r in json.loads((OUT.parent/rel).read_text()))
coverage=[]
for p in sorted(scope):
 t=p.read_text();coverage.append({'path':str(p),'sha256':sha(p.read_bytes()),'old_style_count':t.count(old),'new_style_count':t.count(new)})
check('active-document-old-style-absent',all(not r['old_style_count'] for r in coverage),len(coverage))
(OUT/'document-coverage.json').write_text(json.dumps(coverage,ensure_ascii=False,indent=2)+'\n')

nodefile=ROOT/'apps/backend/comfyui/my_nodes/nodes/my_qi21_bases_text.py'
spec=importlib.util.spec_from_file_location('style_rollout_probe',nodefile);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
node=mod.MyQi21美术风格底座();payload=node.output();default=node.INPUT_TYPES()['optional']['美术风格'][1]['default']
check('node-input-default',default==new,str(mod._BASES_JSON))
check('node-output-result',payload['result'][0]==new)
check('node-ui-payload',payload['ui']['bases_text']==[new])

for label,log in [('baseline','backend-baseline.log'),('after','backend-tests-after-deploy.log')]:
 failed=re.findall(r'^FAILED (\S+)',(OUT/log).read_text(),re.M)
 if label=='baseline':baseline=set(failed)
 else:check('no-new-qwen-backend-failures',set(failed)==baseline,{'baseline':len(baseline),'after':len(failed)})

app=next(p for p in Path('/Applications').iterdir() if p.name=='漫影工作室.app')
installed=app/'Contents/Resources'
installed_data=installed/'studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
check('installed-source-bytes',installed_data.read_bytes()==SOURCE.read_bytes(),str(installed_data))

if '--installed' in sys.argv:
 build=next((ROOT/'apps/release/build/mac-arm64/mac-arm64').glob('*.app'))/'Contents/Resources'
 for base,label in [(build,'built'),(installed,'installed')]:
  p=base/'studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
  check(label+'-source-bytes',p.read_bytes()==SOURCE.read_bytes(),str(p))
 check('installed-asar-matches-build',sha((build/'app.asar').read_bytes())==sha((installed/'app.asar').read_bytes()),sha((installed/'app.asar').read_bytes()))
 # Observe the live node registration only when the managed engine is running.
 home=next(p for p in (Path.home()/'Library/Application Support').iterdir() if p.name=='漫影工作室')/'comfyui'
 manifest=json.loads((home/'manifest.json').read_text());port=manifest['engine']['port']
 try:
  url=f'http://127.0.0.1:{port}/object_info/'+urllib.parse.quote('MyQi21美术风格底座')
  data=json.load(urllib.request.urlopen(url,timeout=5))
  text=data['MyQi21美术风格底座']['input']['optional']['美术风格'][1]['default']
  check('live-object-info-default',text==new,{'port':port,'length':len(text)})
 except OSError as e:checks.append({'check':'live-object-info-default','passed':None,'detail':str(e)})

result={'approved_style':new,'style_length':len(new),'source_sha256':sha(SOURCE.read_bytes()),'files_changed':len(rows),'repo_files':sum(r['group']=='repo' for r in rows),'mirror_files':sum(r['group']=='deploy' for r in rows),'checks':checks,'ok':all(r['passed'] is not False for r in checks)}
(OUT/'verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'ok':result['ok'],'checks':len(checks),'failed':[r for r in checks if r['passed'] is False],'not_observed':[r for r in checks if r['passed'] is None],'style_length':len(new)},ensure_ascii=False,indent=2))
sys.exit(0 if result['ok'] else 1)
