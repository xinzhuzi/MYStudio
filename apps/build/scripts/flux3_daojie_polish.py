"""Deterministic production layout for the task-owned FLUX Daojie graph."""
from pathlib import Path
import json
import sys
ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'.agents/skills/node-graph/tools'))
import layout_check as lc


def apply(wf):
    sg=wf['definitions']['subgraphs'][0];outer={n['id']:n for n in wf['nodes']};inner={n['id']:n for n in sg['nodes']}
    # Inspection outputs belong with the prompt chain so no duplicate outer fan-out.
    for nid,slot in [(4110,0),(4111,1)]:
        if nid in outer:
            n=outer.pop(nid);wf['nodes'].remove(n);sg['nodes'].append(n);inner[nid]=n
            link=next(l for l in wf['links'] if l[3]==nid);wf['links'].remove(link)
            outer[40]['outputs'][slot]['links'].remove(link[0])
            lid=max(l['id'] for l in sg['links'])+1
            sg['links'].append({'id':lid,'origin_id':4014,'origin_slot':slot,'target_id':nid,'target_slot':0,'type':'*'})
            inner[4014]['outputs'][slot]['links'].append(lid);n['inputs'][0]['link']=lid
    positions={400:[900,3000],404:[900,3600],40:[1700,3000],1:[3100,600],2:[100,1000],3:[4600,7600],4:[3100,2000],5:[3100,4300],6:[3100,6500],7:[4600,3000],8:[6100,3000],9:[7600,3000]}
    for nid,pos in positions.items():outer[nid]['pos']=pos
    # Negative encoder receives prompt above CLIP; serialize names and link slots together.
    neg=outer[5]
    old=neg['inputs'][:];neg['inputs'].sort(key=lambda x:0 if x['name']=='text' else 1)
    for l in wf['links']:
        if l[3]==5:l[4]=next(i for i,x in enumerate(neg['inputs']) if x['name']==old[l[4]]['name'])
    # Route negative CLIP below the input column, preserving monotonic x flow.
    if 4200 not in outer:
        link=next(l for l in wf['links'] if l[1]==2 and l[3]==5);oldid=link[0]
        outer[2]['outputs'][0]['links'].remove(oldid)
        lid=max(l[0] for l in wf['links'])+1
        for nid,pos in [(4200,[750,7400]),(4201,[2800,7400])]:
            n={'id':nid,'type':'Reroute','pos':pos,'size':[60,30],'flags':{},'order':0,'mode':0,'inputs':[{'name':'','type':'*','link':lid}],'outputs':[{'name':'','type':'CLIP','links':[]}],'properties':{}}
            if nid==4200:
                wf['links'].append([lid,2,0,nid,0,'CLIP']);outer[2]['outputs'][0]['links'].append(lid)
            else:
                wf['links'].append([lid,4200,0,nid,0,'CLIP']);outer[4200]['outputs'][0]['links'].append(lid)
            wf['nodes'].append(n);outer[nid]=n;lid+=1
        link[1]=4201;outer[4201]['outputs'][0]['links'].append(oldid)
    # Preserve the optimized, zero-crossing prompt-chain layout and place preview fan-out at right.
    for nid,pos in [(4110,[6500,200]),(4111,[6500,1200])]:inner[nid]['pos']=pos
    for i,o in enumerate(sg['outputs']):o['pos']=[7500,300+i*40]
    sg['outputNode']['bounding']=[7480,200,160,300]
    sg['state']['lastNodeId']=max(n['id'] for n in sg['nodes']);sg['state']['lastLinkId']=max(l['id'] for l in sg['links'])
    sg['last_node_id']=sg['state']['lastNodeId'];sg['last_link_id']=sg['state']['lastLinkId']
    wf['last_node_id']=max(n['id'] for n in wf['nodes']);wf['last_link_id']=max(l[0] for l in wf['links'])
    return wf

if __name__=='__main__':
    p=next((ROOT/'apps/backend/comfyui/workflows').rglob('flux3-道劫-t2i.json'));wf=json.loads(p.read_text());apply(wf);p.write_text(json.dumps(wf,ensure_ascii=False,indent=2)+'\n');print(json.dumps(lc.check_workflow(wf),ensure_ascii=False,indent=2))
