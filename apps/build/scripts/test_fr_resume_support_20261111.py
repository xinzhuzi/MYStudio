"""Exercise the actual resume CLI on isolated data, without touching real drafts."""
from pathlib import Path
import json,hashlib,subprocess,tempfile,shutil,sys
script=Path(__file__).with_name('fr_resume_check_20261110.py').resolve()
fixture=Path(tempfile.mkdtemp(prefix='fr-resume-support-'))
script_copy=fixture/'apps/build/scripts/fr_resume_check_20261110.py';script_copy.parent.mkdir(parents=True);shutil.copy2(script,script_copy)
task=fixture/'.trellis/tasks/10-27-script-narrative-translation-cure';research=task/'research';research.mkdir(parents=True)
source=fixture/'source.md';source.write_text('source unchanged')
source_sha=hashlib.sha256(source.read_bytes()).hexdigest()
files={}
for role in ['screenplay','director-plan','storyboard']:
 p=fixture/(role+'.md');p.write_text(role+' unchanged');b=p.read_bytes();files[role]={'path':str(p),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
support=fixture/'execution-support.md';support.write_text('paper v1');b=support.read_bytes();support_entry={'path':str(support),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b)}
fresh={'pass':True,'source_sha256':source_sha,'input_sha256':{k:v['sha256'] for k,v in files.items()},'execution_support_sha256':support_entry['sha256']}
fresh_name='chapter025-mainfresh-20261110.json';(research/fresh_name).write_text(json.dumps(fresh))
ledger={'baseline':'baseline.json','volume1':{'chapters':[{'chapter':25,'status':'offline_content_closed_current_sha','current_independent_pass':True,'main_fresh_exit_code':0,'evidence':[fresh_name],'files':files,'execution_support':support_entry}],'current_run_closed_chapters':[25],'historical_reused_closed_chapters':[]},'volume2':{'status':'not_started_pending_volume1_closure'}}
(research/'fr-volumes-current-20261110.json').write_text(json.dumps(ledger));(research/'baseline.json').write_text(json.dumps({'volumes':[{'chapters':[{'chapter':25,'path':str(source),'sha256':source_sha}]}]}));(task/'task.json').write_text(json.dumps({'offlineTrack':{'ledger':'research/fr-volumes-current-20261110.json'}}))
results=[]
for name,contents,expected_exit,expected_closed in [('unchanged_supported_chapter','paper v1',0,[25]),('changed_support_same_length','paper v2',1,[])]:
 support.write_text(contents)
 run=subprocess.run([sys.executable,'-B',str(script_copy)],capture_output=True,text=True)
 data=json.loads(run.stdout)
 passed=run.returncode==expected_exit and data['reusable_closed_chapters']==expected_closed and data['pass']==(expected_exit==0)
 results.append({'case':name,'pass':passed,'actual_exit':run.returncode,'actual_reusable':data['reusable_closed_chapters'],'errors':data['errors']})
support.write_text('paper v1')
ledger['volume1']['chapters'][0].pop('execution_support')
(research/'fr-volumes-current-20261110.json').write_text(json.dumps(ledger))
run=subprocess.run([sys.executable,'-B',str(script_copy)],capture_output=True,text=True)
data=json.loads(run.stdout)
results.append({'case':'missing_support_ledger_entry','pass':run.returncode==1 and data['reusable_closed_chapters']==[] and not data['pass'],'actual_exit':run.returncode,'actual_reusable':data['reusable_closed_chapters'],'errors':data['errors']})
print(json.dumps({'pass':all(r['pass'] for r in results),'fixture':str(fixture),'cases':results},ensure_ascii=False,indent=2))
sys.exit(0 if all(r['pass'] for r in results) else 1)
