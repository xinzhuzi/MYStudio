#!/usr/bin/env python3
"""Serial FLUX.3 Windows runner with explicit PE gate and durable prompt receipts."""
import argparse
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import time

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('flux_workflow',HERE/'flux3_daojie_workflow.py')
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
TASK=w.TASK


def remote(code):
    p=subprocess.run([sys.executable,str(HERE/'flux3_daojie_ssh.py'),'--timeout','45'],input=code,text=True,capture_output=True)
    if p.returncode:raise RuntimeError(p.stderr+p.stdout)
    return json.loads(p.stdout)


PRE='''import json,urllib.request,base64,hashlib
from pathlib import Path
h=next(p/'comfyui' for p in Path('E:/IP').iterdir() if (p/'comfyui/manifest.json').exists())
work=Path('E:/IP/flux3-ten-types-1016')
def get(path):return json.load(urllib.request.urlopen('http://127.0.0.1:17000'+path,timeout=10))
'''

def submit(graph,wf,folder,stage):
    payload={'prompt':graph,'client_id':w.OWNER,'extra_data':{'extra_pnginfo':{'workflow':wf}}}
    request=folder/(stage+'-prompt.json');request.write_text(json.dumps(payload,ensure_ascii=False,indent=2))
    result=remote(PRE+'\npayload='+repr(payload)+'\nfolder=work/'+repr(folder.name)+'''\nfolder.mkdir(parents=True,exist_ok=True)
q=get('/queue');assert not q['queue_running'] and not q['queue_pending'],'Queue occupied'
(folder/'''+repr(stage+'-prompt.json')+''').write_text(json.dumps(payload,ensure_ascii=False,indent=2),encoding='utf-8')
req=urllib.request.Request('http://127.0.0.1:17000/prompt',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
try:
 with urllib.request.urlopen(req,timeout=15) as response:r=json.load(response)
except urllib.error.HTTPError as error:
 raise RuntimeError(error.read().decode())
(folder/'''+repr(stage+'-submission.json')+''').write_text(json.dumps(r),encoding='utf-8')
print(json.dumps(r))
''')
    assert result.get('prompt_id') and not result.get('node_errors'),result
    (folder/(stage+'-submission.json')).write_text(json.dumps(result,indent=2))
    print(stage+' submitted '+result['prompt_id'],flush=True)
    return result['prompt_id']


def wait(prompt_id,folder,stage,deadline):
    while time.time()<deadline:
        result=remote(PRE+'\npid='+repr(prompt_id)+'''\nhistory=get('/history/'+pid)
if pid in history:
 item=history[pid]
 (work/'''+repr(folder.name)+'/'+repr(stage+'-history.json')+''').write_text(json.dumps(item,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps({'done':True,'history':item},ensure_ascii=True))
else:print(json.dumps({'done':False,'queue':get('/queue')}))
''')
        if result['done']:
            history=result['history'];(folder/(stage+'-history.json')).write_text(json.dumps(history,ensure_ascii=False,indent=2))
            assert history['status']['status_str']=='success' and history['status']['completed'],history['status']
            return history
        print(stage+' waiting '+prompt_id,flush=True);time.sleep(8)
    raise TimeoutError('Type deadline reached; existing job retained, no next submission')


def run(kind):
    cs=json.loads((TASK/'artifacts/cases.json').read_text());case=next(c for c in cs if c['type']==kind)
    folder=TASK/'artifacts'/f"{case['index']:02d}";folder.mkdir(exist_ok=True)
    (folder/'input.json').write_text(json.dumps(case,ensure_ascii=False,indent=2))
    wf=w.build_gui(case);g=w.expand_gui(wf);w.validate_api(g)
    pe_keys={'400','404','4010','4017','4030','4031','4032','4013','4014','4110','4111'}
    pe={k:v for k,v in g.items() if k in pe_keys}
    deadline=time.time()+1800
    pidfile=folder/'pe-submission.json'
    pid=json.loads(pidfile.read_text())['prompt_id'] if pidfile.exists() else submit(pe,wf,folder,'pe')
    history=wait(pid,folder,'pe',deadline)
    ui=history['outputs']['4013'];status=ui['api_pe_status'][0]
    assert status.startswith('AI扩写OK:'+w.MODEL) and '云端' not in status,status
    # PreviewAny yields final-output text; encoder must consume these exact strings.
    pos=history['outputs']['4110']['text'][0];neg=history['outputs']['4111']['text'][0]
    assert isinstance(pos,str) and pos.strip()
    if case['index']!=1:
        g={k:v for k,v in g.items() if k not in pe_keys}
        g['4']['inputs']['text']=pos;g['5']['inputs']['text']=neg
        g['6']['inputs']['width']=case['width'];g['6']['inputs']['height']=case['height']
    renderfile=folder/'render-submission.json'
    rid=json.loads(renderfile.read_text())['prompt_id'] if renderfile.exists() else submit(g,wf,folder,'render')
    rendered=wait(rid,folder,'render',deadline)
    if case['index']==1:
        assert rendered['outputs']['4013']['api_pe_status'][0]==status
        assert rendered['outputs']['4110']['text'][0]==pos and rendered['outputs']['4111']['text'][0]==neg
    out=rendered['outputs']['9']['images'];assert len(out)==1
    result=remote(PRE+'\nmeta='+repr(out[0])+'''\np=h/'output'/meta['subfolder']/meta['filename']
assert p.resolve().is_relative_to((h/'output/flux3/ten-types-1016').resolve())
from PIL import Image
im=Image.open(p)
print(json.dumps({'image_path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'mode':im.mode,'size':list(im.size),'payload':base64.b64encode(p.read_bytes()).decode()}))
''')
    payload=base64.b64decode(result.pop('payload'));(folder/'image.png').write_bytes(payload)
    assert hashlib.sha256(payload).hexdigest()==result['sha256']
    assert result['mode']=='RGB' and result['size']==[case['width'],case['height']],result
    receipt={**case,**result,'pe_prompt_id':pid,'prompt_id':rid,'api_pe_status':status,'expanded_positive':ui['api_pe_pos'][0],'expanded_negative':ui['api_pe_neg'][0],'final_positive':pos,'final_negative':neg,'history_status':'success','visual_status':'pending','visual_notes':[]}
    (folder/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2))
    remote(PRE+'\nreceipt='+repr(receipt)+'\n(work/'+repr(folder.name)+"/'receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')\nprint(json.dumps({'ok':True}))")
    print(json.dumps({'ok':True,'type':kind,'prompt_id':rid,'size':result['size'],'sha256':result['sha256']},ensure_ascii=False),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('command',choices=['build','validate','run-windows','verify-receipts'])
    p.add_argument('--type',help='Exact Chinese type key; required for run-windows')
    a=p.parse_args()
    if a.command=='run-windows':
        if not a.type:p.error('run-windows requires --type')
        run(a.type)
    elif a.command=='build':w.build()
    elif a.command=='validate':
        cs=json.loads((TASK/'artifacts/cases.json').read_text())
        wf=json.loads(w.sources()[1].with_name('flux3-道劫-t2i.json').read_text())
        assert w.expand_gui(wf)==w.api_graph(cs[0])
        for case in cs:w.validate_api(w.expand_gui(w.build_gui(case)))
        from flux3_daojie_verify import check_sources
        drift=check_sources()
        print(json.dumps({'graph_contract_ok':True,'documented_reference_drift':drift},ensure_ascii=False))
    else:
        from flux3_daojie_verify import verify
        sys.exit(0 if verify() else 1)
