#!/usr/bin/env python3
"""Render one saved-canvas character-card probe and persist exact execution evidence."""
from pathlib import Path
import argparse
import copy
import hashlib
import importlib.util
import json
import time
import urllib.parse
import urllib.request

from qwen21_bridge_template_build import flatten_canvas, selected_graph, check_object_info, engine_base, object_info

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/daojie-charsheet-six-zone-1016'
SOURCE=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'


def request(base,path,payload=None):
    req=urllib.request.Request(base+path,data=json.dumps(payload).encode() if payload is not None else None,
        headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--name',required=True)
    ap.add_argument('--seed',type=int,default=10161001)
    ap.add_argument('--pe',action='store_true')
    ap.add_argument('--opaque',action='store_true',help='Probe opaque generation without changing the saved workflow')
    ap.add_argument('--resume',action='store_true')
    args=ap.parse_args();case=OUT/args.name;case.mkdir(parents=True,exist_ok=True)
    base=engine_base()
    if args.resume:
        submission=json.loads((case/'submission.json').read_text());pid=submission['prompt_id']
        graph=json.loads((case/'api.json').read_text())
    else:
        assert not (case/'submission.json').exists(),'Use --resume to follow this submitted job'
        queue=request(base,'/queue');assert not queue['queue_running'] and not queue['queue_pending'],'Shared engine queue occupied'
        schema=object_info();(case/'object-info.json').write_text(json.dumps(schema,ensure_ascii=False))
        canvas=next((ROOT/'apps/backend/engines/comfyui/workflows').rglob('qi21-道劫-t2i.json'))
        wf=json.loads(canvas.read_text());root={n['id']:n for n in wf['nodes']}
        root[6]['widgets_values'][0]='设定卡';root[6].setdefault('widgets_values_named',{})['型选择']='设定卡'
        root[7]['widgets_values'][0]='2 · viggle';root[7].setdefault('widgets_values_named',{})['速度档位']='2 · viggle'
        root[7]['widgets_values'][1]=args.seed;root[7]['widgets_values_named']['seed']=args.seed
        doc=next(p for p in (ROOT/'docs/prompts').iterdir() if p.name=='道劫_类型主体句示例.md')
        import re
        subject=re.search(r'^## 10\.[^\n]*\n.*?^```[^\n]*\n(.*?)^```',doc.read_text(),re.M|re.S).group(1).strip()
        root[400]['widgets_values'][0]=subject
        if 'widgets_values_named' in root[400]:
            for k in root[400]['widgets_values_named']:root[400]['widgets_values_named'][k]=subject
        graph=flatten_canvas(wf,schema)
        for node in graph.values():
            if node['class_type']=='MyQi21ApiPE':node['inputs']['AI扩写开关']=args.pe
            if args.opaque and node['class_type'] in ['MyQi21ApiPE','MyQi21FinalOutput']:
                node['inputs']['透明模式']=False
            if node['class_type']=='SaveImage':node['inputs']['filename_prefix']=f'charsheet-six-zone-1016/{args.name}'
        graph=selected_graph(graph,['8','401']);check_object_info(graph,schema)
        assert not any(n['class_type']=='SeedVR2VideoUpscaler' for n in graph.values())
        (case/'canvas.json').write_text(json.dumps(wf,ensure_ascii=False,indent=2)+'\n')
        (case/'api.json').write_text(json.dumps(graph,ensure_ascii=False,indent=2)+'\n')
        (case/'source.json').write_bytes(SOURCE.read_bytes())
        queue=request(base,'/queue');assert not queue['queue_running'] and not queue['queue_pending'],'Shared engine queue became occupied'
        response=request(base,'/prompt',{'prompt':graph,'client_id':'charsheet-six-zone-1016','extra_data':{'extra_pnginfo':{'workflow':wf}}})
        pid=response['prompt_id'];submission={'prompt_id':pid,'engine':base,'submitted_at':time.time(),'seed':args.seed,'pe':args.pe,'opaque':args.opaque}
        (case/'submission.json').write_text(json.dumps(submission,indent=2)+'\n')
    print('queued',pid,case,flush=True)
    start=time.time();last=0
    while time.time()-start<3600:
        history=request(base,'/history/'+pid)
        if pid in history:
            entry=history[pid];(case/'history.json').write_text(json.dumps(entry,ensure_ascii=False,indent=2)+'\n')
            assert entry['status']['status_str']=='success',entry['status']
            assert entry['prompt'][2]==graph,'Executed graph differs from submission'
            images=entry['outputs']['8']['images'];assert len(images)==1,images
            item=images[0];url=base+'/view?'+urllib.parse.urlencode(item)
            with urllib.request.urlopen(url,timeout=30) as response:png=response.read()
            (case/'output.png').write_bytes(png)
            from PIL import Image
            image=Image.open(case/'output.png')
            preview=entry['outputs'].get('401',{})
            (case/'final-prompt.txt').write_text(''.join(preview.get('positive',[]))+'\n')
            (case/'result.json').write_text(json.dumps({'prompt_id':pid,'success':True,'mode':image.mode,
                'size':image.size,'sha256':hashlib.sha256(png).hexdigest(),'engine_file':item,
                'elapsed_seconds':round(time.time()-start,2)},ensure_ascii=False,indent=2)+'\n')
            print('DONE',pid,image.size,image.mode,case/'output.png',flush=True);return
        if time.time()-last>40:
            q=request(base,'/queue');print('running',pid,'elapsed',round(time.time()-start),
                'queue',len(q['queue_running']),len(q['queue_pending']),flush=True);last=time.time()
        time.sleep(5)
    raise TimeoutError(f'Job still pending; resume same prompt_id {pid}')


if __name__=='__main__':main()
