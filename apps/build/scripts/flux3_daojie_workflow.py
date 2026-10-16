#!/usr/bin/env python3
"""Build a GUI workflow and expand its exact API graph for FLUX.3 Daojie tests."""
from pathlib import Path
import argparse
import copy
import hashlib
import json
import re
import sys
import uuid

ROOT=Path(__file__).resolve().parents[3]
TASK=ROOT/'.trellis/tasks/10-16-flux3-daojie-ten-types'
WFROOT=ROOT/'apps/backend/engines/comfyui/workflows'
INFO=json.loads((TASK/'research/object-info-after.json').read_text())
SGID='713f37bf-8b6e-4992-a8f7-82dcf7e63a51'
MODEL='qwen3.5-9b-uncensored-hauhaucs-aggressive'
OWNER='flux3-daojie-ten-types-1016'


def sources():
    q=next(WFROOT.rglob('qi21-道劫-t2i.json'))
    f=next(WFROOT.rglob('flux3-文生图.json'))
    e=next((ROOT/'docs/prompts').glob('*主体句示例.md'))
    b=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
    return q,f,e,b


def cases():
    _,_,e,b=sources()
    blocks=re.findall(r'^## (\d+)\.[^\n]*\n.*?^```[^\n]*\n(.*?)^```',e.read_text(),re.M|re.S)
    assert len(blocks)==10
    sys.path.insert(0,str(ROOT/'apps/backend'))
    from engines.comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase
    node=MyQi21DaojieBase();data=json.loads(b.read_text())
    result=[]
    for i,entry in enumerate(t for t in data['types'] if t['zh']!='自由'):
        raw=node.run(base=entry['zh'])
        subject=blocks[i][1].strip()
        # Remove only the redundant legacy layout from this task input; type is authoritative.
        original=subject
        if entry['zh']=='表情差分':
            subject=subject.split('青年刀修，',1)[1]
            subject='青年刀修，'+subject
        result.append({'index':i+1,'type':entry['zh'],'source_sha256':hashlib.sha256(e.read_bytes()).hexdigest(),'source_section':int(blocks[i][0]),'subject_original':original,'subject':subject,'input_adjustment':'Remove legacy redundant grid preamble; canonical type owns layout' if subject!=original else None,'seed':10160001+i,'raw_width':raw[1],'raw_height':raw[2],'width':round(raw[1]/16)*16,'height':round(raw[2]/16)*16})
    return result


def api_graph(case):
    def n(t,**inputs):return {'class_type':t,'inputs':inputs}
    g={
      '400':n('PrimitiveStringMultiline',value=case['subject']),
      '404':n('PrimitiveStringMultiline',value=''),
      '4010':n('MyQi21DaojieBase',base=case['type'],透明覆盖=False),
      '4017':n('MyFlux3DaojieAdapter',BASE=['4010',0],WIDTH=['4010',1],HEIGHT=['4010',2]),
      '4030':n('MyQi21系统提示词'), '4031':n('MyQi21色卡'), '4032':n('MyQi21美术风格底座'),
      '4013':n('MyQi21ApiPE',api_url='http://127.0.0.1:1234',model=MODEL,temperature=0.7,max_tokens=2048,timeout_sec=600,thinking_effort='关闭',AI扩写开关=True,系统提示词=['4030',0],色卡=['4031',0],**{'美术风格底座-正向':['4032',0],'美术风格底座-负向':['4032',1]},正向提示词=['400',0],负向提示词=['404',0],类型句正向=['4017',0],类型句负向=['4010',3],画幅宽=['4017',1],画幅高=['4017',2],透明模式=['4017',3]),
      '4014':n('MyQi21FinalOutput',正向提示词=['4013',0],负向提示词=['4013',1],透明模式=['4013',2]),
      '4110':n('PreviewAny',source=['4014',0]),'4111':n('PreviewAny',source=['4014',1]),
      '1':n('UNETLoader',unet_name='flux3_image_klein_sd_int8_convrot.safetensors',weight_dtype='default'),
      '2':n('CLIPLoader',clip_name='qwen3vl_4b_int8_convrot.safetensors',type='flux3',device='default'),
      '3':n('VAELoader',vae_name='flux2-vae.safetensors'),
      '4':n('CLIPTextEncode',clip=['2',0],text=['4014',0]),
      '5':n('CLIPTextEncode',clip=['2',0],text=['4014',1]),
      '6':n('EmptyFlux2LatentImage',width=['4013',3],height=['4013',4],batch_size=1),
      '7':n('KSampler',model=['1',0],seed=case['seed'],steps=15,cfg=1.0,sampler_name='euler',scheduler='simple',positive=['4',0],negative=['5',0],latent_image=['6',0],denoise=1.0),
      '8':n('VAEDecode',samples=['7',0],vae=['3',0]),
      '9':n('SaveImage',images=['8',0],filename_prefix=f"flux3/ten-types-1016/{case['index']:02d}")}
    return g


def is_ref(v):return isinstance(v,list) and len(v)==2 and isinstance(v[0],str) and isinstance(v[1],int)


def validate_api(graph):
    for key,node in graph.items():
        spec=INFO[node['class_type']];slots={**spec['input'].get('required',{}),**spec['input'].get('optional',{})}
        assert set(spec['input'].get('required',{}))<=set(node['inputs']),(key,'missing required')
        assert set(node['inputs'])<=set(slots),(key,'unknown input')
        for name,value in node['inputs'].items():
            kind=slots[name][0]
            if is_ref(value):
                other,slot=value;assert other in graph and slot<len(INFO[graph[other]['class_type']]['output'])
                actual=INFO[graph[other]['class_type']]['output'][slot]
                assert kind=='*' or actual==kind,(key,name,kind,actual)
            elif isinstance(kind,list):assert value in kind,(key,name,value)
    return True


def gui_node(key,node,pos):
    spec=INFO[node['class_type']];inputs=[];widgets=[];named={}
    slots={**spec['input'].get('required',{}),**spec['input'].get('optional',{})}
    for name,value in node['inputs'].items():
        kind=slots[name][0];typ='COMBO' if isinstance(kind,list) else kind
        if is_ref(value):
            inputs.append({'name':name,'type':typ,'link':None})
        else:
            named[name]=value;widgets.append(value)
            if node['class_type']=='KSampler' and name=='seed':widgets.append('fixed')
    multiline=sum(1 for name in named if (len(slots[name])>1 and slots[name][1].get('multiline')))
    height=max(160,90+30*len(named)+30*len(inputs)+160*multiline)
    if node['class_type']=='MyQi21ApiPE':height=800
    outputs=[{'name':name,'type':kind,'links':[],'slot_index':i} for i,(name,kind) in enumerate(zip(spec['output_name'],spec['output']))]
    return {'id':int(key),'type':node['class_type'],'pos':pos,'size':[540,height],'flags':{},'order':0,'mode':0,'inputs':inputs,'outputs':outputs,'properties':{'Node name for S&R':node['class_type']},'widgets_values':widgets,'widgets_values_named':named,'title':f"[{key}] {spec['display_name']}"}


def build_gui(case):
    template=TASK/'artifacts/gui-template.json'
    if template.exists():
        wf=json.loads(template.read_text())
        nodes=wf['nodes']+[n for sg in wf['definitions']['subgraphs'] for n in sg['nodes']]
        by={str(n['id']):n for n in nodes}
        for key,name,value,index in [('400','value',case['subject'],0),('4010','base',case['type'],0),('7','seed',case['seed'],0),('9','filename_prefix',f"flux3/ten-types-1016/{case['index']:02d}",0)]:
            by[key]['widgets_values_named'][name]=value
            by[key]['widgets_values'][index]=value
        host=next(n for n in wf['nodes'] if n['type']==SGID)
        host['widgets_values']=[case['type']]
        return wf
    api=api_graph(case)
    inner={'4010','4017','4030','4031','4032','4013','4014'}
    # Nodes intentionally in a single row: data dependencies flow strictly left to right.
    order=['4010','4017','4030','4031','4032','4013','4014']
    nodes=[gui_node(k,api[k],[120+i*720,200]) for i,k in enumerate(order)]
    by={str(n['id']):n for n in nodes};links=[];lid=1
    sg_inputs=[{'id':str(uuid.uuid5(uuid.UUID(SGID),name)),'name':name,'type':typ,'linkIds':[],'pos':[20,220+i*40]} for i,(name,typ) in enumerate([('正向提示词','STRING'),('负向提示词','STRING'),('型选择','COMBO')])]
    # Promote type widget into a proper boundary input, without duplicate serialization.
    base=by['4010'];base['inputs'].insert(0,{'name':'base','type':'COMBO','widget':{'name':'base'},'link':None})
    def edge(origin,slot,target,name,typ):
        nonlocal lid
        dst=by[str(target)];j=next(i for i,s in enumerate(dst['inputs']) if s['name']==name)
        links.append({'id':lid,'origin_id':origin,'origin_slot':slot,'target_id':target,'target_slot':j,'type':typ});dst['inputs'][j]['link']=lid
        if origin==-10:sg_inputs[slot]['linkIds'].append(lid)
        else:by[str(origin)]['outputs'][slot]['links'].append(lid)
        lid+=1
    for k in order:
        for name,v in api[k]['inputs'].items():
            if is_ref(v):
                src,slot=v
                if src in inner:edge(int(src),slot,int(k),name,INFO[api[src]['class_type']]['output'][slot])
                else:edge(-10,0 if src=='400' else 1,int(k),name,'STRING')
    edge(-10,2,4010,'base','COMBO')
    sg_outputs=[]
    for i,(name,typ,src,slot) in enumerate([('positive','STRING',4014,0),('negative','STRING',4014,1),('width','INT',4013,3),('height','INT',4013,4)]):
        links.append({'id':lid,'origin_id':src,'origin_slot':slot,'target_id':-20,'target_slot':i,'type':typ});by[str(src)]['outputs'][slot]['links'].append(lid)
        sg_outputs.append({'id':str(uuid.uuid5(uuid.UUID(SGID),name)),'name':name,'type':typ,'linkIds':[lid],'pos':[5200,240+i*40]});lid+=1
    sg={'id':SGID,'version':1,'revision':1,'name':'FLUX.3 道劫提示词与 RGB 画幅','state':{'lastGroupId':0,'lastNodeId':4032,'lastLinkId':lid,'lastRerouteId':0},'config':{},'nodes':nodes,'links':links,'inputs':sg_inputs,'outputs':sg_outputs,'widgets':[case['type']],'inputNode':{'id':-10,'bounding':[0,160,100,220]},'outputNode':{'id':-20,'bounding':[5180,160,160,240]},'groups':[],'extra':{},'last_node_id':4032,'last_link_id':lid}
    host={'id':40,'type':SGID,'pos':[850,300],'size':[600,260],'flags':{},'order':0,'mode':0,'inputs':[{'name':'正向提示词','type':'STRING','link':None},{'name':'负向提示词','type':'STRING','link':None},{'name':'型选择','type':'COMBO','widget':{'name':'型选择'},'link':None}],'outputs':[{'name':o['name'],'type':o['type'],'links':[]} for o in sg_outputs],'widgets_values':[case['type']],'properties':{'subgraph':SGID,'Node name for S&R':SGID,'proxyWidgets':[['4010','base']]},'title':'[40] 道劫十型 · Windows9B扩写 · RGB'}
    coords={'400':[100,200],'404':[100,800],'1':[100,1450],'2':[850,1450],'3':[1600,1450],'4':[2350,200],'5':[2350,850],'6':[3100,1500],'7':[3850,400],'8':[4600,400],'9':[5350,400],'4110':[1600,200],'4111':[1600,800]}
    outer=[gui_node(k,n,coords[k]) for k,n in api.items() if k not in inner]+[host];ob={str(n['id']):n for n in outer};ol=[];lid=1
    for n in outer:
        if n is host:incoming={'正向提示词':['400',0],'负向提示词':['404',0]}
        else:incoming=api[str(n['id'])]['inputs']
        for name,v in incoming.items():
            if not is_ref(v):continue
            src,slot=v
            if src in inner:
                mapped={('4014',0):0,('4014',1):1,('4013',3):2,('4013',4):3}
                slot=mapped[(src,slot)];src='40'
            j=next(i for i,x in enumerate(n['inputs']) if x['name']==name)
            typ=n['inputs'][j]['type'];ol.append([lid,int(src),slot,n['id'],j,typ]);n['inputs'][j]['link']=lid;ob[src]['outputs'][slot]['links'].append(lid);lid+=1
    return {'id':str(uuid.uuid5(uuid.UUID(SGID),'workflow')),'revision':1,'last_node_id':4111,'last_link_id':lid,'nodes':outer,'links':ol,'groups':[],'definitions':{'subgraphs':[sg]},'config':{},'extra':{'frontendVersion':'1.41.20','flux3TaskOwner':OWNER,'ds':{'scale':0.25,'offset':[200,200]}},'version':0.4}


def expand_gui(wf):
    """Flatten each independent functional subgraph while preserving node input names."""
    definitions={s['id']:s for s in wf['definitions']['subgraphs']}
    result={}
    def scope(nodes,links,boundary=None):
        by={n['id']:n for n in nodes}
        ls={l[0]:l for l in links}
        def resolve(src,slot):
            if src==-10:return boundary[slot]
            node=by[src]
            if node['type']=='Reroute':
                l=ls[node['inputs'][0]['link']];return resolve(l[1],l[2])
            if node['type'] in definitions:
                sg=definitions[node['type']];out=sg['outputs'][slot]
                l=next(l for l in sg['links'] if l['id']==out['linkIds'][0])
                return [str(l['origin_id']),l['origin_slot']]
            return [str(src),slot]
        for node in nodes:
            if node['type']=='Reroute':continue
            if node['type'] in definitions:
                sg=definitions[node['type']];values=[]
                for inp in node['inputs']:
                    if inp.get('widget'):values.append(node['widgets_values'][0])
                    else:
                        l=ls[inp['link']];values.append(resolve(l[1],l[2]))
                innerlinks=[[l['id'],l['origin_id'],l['origin_slot'],l['target_id'],l['target_slot'],l['type']] for l in sg['links']]
                scope(sg['nodes'],innerlinks,values)
            else:
                ins=copy.deepcopy(node.get('widgets_values_named',{}))
                for inp in node.get('inputs',[]):
                    if inp.get('link') is not None:
                        l=ls[inp['link']];ins[inp['name']]=resolve(l[1],l[2])
                result[str(node['id'])]={'class_type':node['type'],'inputs':ins}
    scope(wf['nodes'],wf['links'])
    return result


def build():
    cs=cases();wf=build_gui(cs[0]);assert expand_gui(wf)==api_graph(cs[0]);validate_api(expand_gui(wf))
    dest=sources()[1].with_name('flux3-道劫-t2i.json')
    if dest.exists():assert json.loads(dest.read_text()).get('extra',{}).get('flux3TaskOwner')==OWNER
    dest.write_text(json.dumps(wf,ensure_ascii=False,indent=2)+'\n')
    a=TASK/'artifacts';a.mkdir(exist_ok=True)
    (a/'cases.json').write_text(json.dumps(cs,ensure_ascii=False,indent=2)+'\n')
    (a/'source-hashes.json').write_text(json.dumps({str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sources()},ensure_ascii=False,indent=2))
    (a/'integrated-api.json').write_text(json.dumps(expand_gui(wf),ensure_ascii=False,indent=2))
    print(json.dumps({'workflow':str(dest),'cases':len(cs),'api_nodes':len(api_graph(cs[0]))},ensure_ascii=False))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('command',choices=['build','validate']);a=p.parse_args()
    if a.command=='build':build()
    else:
        cs=json.loads((TASK/'artifacts/cases.json').read_text());wf=json.loads(sources()[1].with_name('flux3-道劫-t2i.json').read_text());assert expand_gui(wf)==api_graph(cs[0]);validate_api(expand_gui(wf));print('GUI/API equivalence and live I/O contract passed')
