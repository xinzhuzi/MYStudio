"""Replay the user's saved generation, pinning final text for an isolated style A/B.
No production graph rewiring; both requests retain saved graph, model, seed and sampler.
"""
from pathlib import Path
import copy
import hashlib
import json
import shutil
import struct
import sys
import urllib.parse
import urllib.request
import urllib.error
import uuid

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/qi21-painterly-ab-1016'
SAVED=ROOT/'apps/output/automation/qi21-render-style-diagnosis-1016-00003'
MANUAL=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
IP=next(p for p in Path('/Users/zhengbingjin/Project/IP').iterdir() if p.name=='漫影工作室')
port=json.loads((IP/'comfyui/manifest.json').read_text())['engine']['port']
BASE=f'http://127.0.0.1:{port}'
ORIGINAL=next(p for p in (IP/'comfyui/output').iterdir() if p.name=='QI21道劫文生图__00003_.png')
NEW=('美术风格底座：中国传统工笔设色与彩色连环画语言的二维手绘数字插画。'
     '白描式线条主导形体结构，轮廓线与内部结构线共同承担造型，线条细稳连贯、轻重富有节奏；'
     '色彩以清晰色面、分染与层层罩染塑形，明暗融入设色层次，笔触与边缘保留清楚的手绘笔性，材质统一于线描设色语言；'
     '采用中国传统色体系，以丰富多彩的设色为主，多色相并陈且协调统一，主色统领、辅色呼应、点睛色突出，饱和度与对比度受控且层级分明。'
     '成像工艺干净，线条与罩染层次清晰。')
sha=lambda b:hashlib.sha256(b).hexdigest()
def dump(p,d):p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def get(endpoint):
    with urllib.request.urlopen(BASE+endpoint,timeout=15) as r:return json.load(r)


def prepare():
    OUT.mkdir(parents=True,exist_ok=True)
    graph=json.loads((SAVED/'saved-prompt.json').read_text())
    old=graph['6:4032']['inputs']['美术风格']
    final=graph['401']['inputs']['正向终稿']
    current=json.loads((MANUAL/'json/qi21_bases.json').read_text())['art_style_base']['positive_text']
    assert old==current, 'GLM/source changed; inspect before updating.'
    assert final.count(old)==1
    width,height=struct.unpack('>II',ORIGINAL.read_bytes()[16:24])
    graphs={}
    for arm,style in [('A_old',old),('B_new',NEW)]:
        g=copy.deepcopy(graph)
        # Pin original final text at the SAME encoder input. Keep live source/PE out of the experimental variable.
        g['4015']['inputs']['prompt']=final.replace(old,style)
        g['4']['inputs'].update(width=width,height=height)
        g['8']['inputs']['filename_prefix']='QI21_style_AB_1016/'+arm
        dump(OUT/(arm+'.api.json'),g)
        (OUT/(arm+'.positive.txt')).write_text(g['4015']['inputs']['prompt']+'\n')
        graphs[arm]=g
    g0,g1=copy.deepcopy(graphs['A_old']),copy.deepcopy(graphs['B_new'])
    assert g0['4015']['inputs'].pop('prompt').replace(old,NEW)==g1['4015']['inputs'].pop('prompt')
    g0['8']['inputs'].pop('filename_prefix');g1['8']['inputs'].pop('filename_prefix')
    assert g0==g1
    for cls in sorted({n['class_type'] for n in graph.values()}):
        info=get('/object_info/'+urllib.parse.quote(cls))[cls]
        for nid,node in graph.items():
            if node['class_type']!=cls:continue
            declared={k for group in ('required','optional') for k in info['input'].get(group,{})}
            # Extra legacy display fields are harmless; retained to replay the saved request verbatim.
            required=info['input'].get('required',{})
            missing={k for k,v in required.items() if k not in node['inputs']
                     and not (v[0]=='COMFY_AUTOGROW_V3' and v[1].get('template',{}).get('min')==0)}
            assert not missing,(nid,missing)
    dump(OUT/'experiment.json',{'source_image':str(ORIGINAL),'source_image_sha256':sha(ORIGINAL.read_bytes()),
         'width':width,'height':height,'seed':graph['7:7014']['inputs']['value'],'mode':graph['7:7015']['inputs']['mode'],
         'old_style':old,'new_style':NEW,'only_experimental_variable':'美术风格底座全文','common_changes':'固定编码器最终文本与原图尺寸，输出文件前缀分臂','graph_equality_except_prompt_and_output':True})
    (OUT/'old-style.txt').write_text(old+'\n');(OUT/'new-style.txt').write_text(NEW+'\n')
    shutil.copy2(ORIGINAL,OUT/'original-reference.png')
    print(json.dumps({'prepared':True,'dimensions':[width,height],'seed':graph['7:7014']['inputs']['value'],'nodes':len(graph)},ensure_ascii=False))


def submit(arm):
    queue=get('/queue');assert not queue['queue_running'] and not queue['queue_pending'],'Shared engine busy; do not interleave.'
    g=json.loads((OUT/(arm+'.api.json')).read_text())
    request=urllib.request.Request(BASE+'/prompt',data=json.dumps({'prompt':g,'client_id':'qi21-style-ab-'+str(uuid.uuid4()),'extra_data':{'extra_pnginfo':{'style_ab':{'arm':arm,'experiment':json.loads((OUT/'experiment.json').read_text()),'authoritative_graph':'PNG prompt metadata; original canvas intentionally omitted because encoder text is pinned'}}}}).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request,timeout=30) as r:result=json.load(r)
    except urllib.error.HTTPError as e:
        print(e.read().decode()[:3000]);raise
    assert not result.get('node_errors'),result
    dump(OUT/(arm+'.submission.json'),result)
    print(arm,result)


def poll(arm):
    pid=json.loads((OUT/(arm+'.submission.json')).read_text())['prompt_id']
    h=get('/history/'+pid)
    if pid not in h:
        q=get('/queue');print(json.dumps({'arm':arm,'status':'running_or_queued','running':len(q['queue_running']),'pending':len(q['queue_pending'])}));return
    entry=h[pid];dump(OUT/(arm+'.history.json'),entry)
    status=entry['status'];assert status.get('status_str')=='success',status
    images=entry['outputs']['8']['images'];assert len(images)==1
    rec=images[0]
    url=BASE+'/view?'+urllib.parse.urlencode(rec)
    with urllib.request.urlopen(url,timeout=30) as r:data=r.read()
    assert data.startswith(b'\x89PNG\r\n\x1a\n')
    (OUT/(arm+'.png')).write_bytes(data)
    dump(OUT/(arm+'.result.json'),{'prompt_id':pid,'status':status,'image':rec,'sha256':sha(data),'local':str(OUT/(arm+'.png'))})
    print(json.dumps({'arm':arm,'status':'success','path':str(OUT/(arm+'.png'))},ensure_ascii=False))


if __name__=='__main__':
    {'prepare':prepare,'submit':lambda:submit(sys.argv[2]),'poll':lambda:poll(sys.argv[2])}[sys.argv[1]]()
