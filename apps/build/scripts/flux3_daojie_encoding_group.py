"""Encapsulate the standard FLUX text encoder as an independent functional subgraph."""
import copy
import uuid
ENCID='91eaeeb1-852c-42ed-9ffc-2bb3ea53b99c'


def apply(wf):
    if any(s['id']==ENCID for s in wf['definitions']['subgraphs']):return wf
    by={n['id']:n for n in wf['nodes']};members=[by[k] for k in [2,4,5]]
    wf['nodes']=[n for n in wf['nodes'] if n['id'] not in [2,4,5,4200,4201]]
    wf['links']=[l for l in wf['links'] if l[1] not in [2,4,5,4200,4201] and l[3] not in [2,4,5,4200,4201]]
    for n in members:
        for i in n['inputs']:i['link']=None
        for o in n['outputs']:o['links']=[]
    members[0]['pos']=[100,500];members[1]['pos']=[900,200];members[2]['pos']=[900,1000]
    # Stable declared slot order for the standard nodes.
    for n in members[1:]:n['inputs'].sort(key=lambda x:0 if x['name']=='clip' else 1)
    links=[{'id':1,'origin_id':2,'origin_slot':0,'target_id':4,'target_slot':0,'type':'CLIP'},{'id':2,'origin_id':2,'origin_slot':0,'target_id':5,'target_slot':0,'type':'CLIP'},{'id':3,'origin_id':-10,'origin_slot':0,'target_id':4,'target_slot':1,'type':'STRING'},{'id':4,'origin_id':-10,'origin_slot':1,'target_id':5,'target_slot':1,'type':'STRING'},{'id':5,'origin_id':4,'origin_slot':0,'target_id':-20,'target_slot':0,'type':'CONDITIONING'},{'id':6,'origin_id':5,'origin_slot':0,'target_id':-20,'target_slot':1,'type':'CONDITIONING'}]
    mb={n['id']:n for n in members}
    for l in links:
        if l['origin_id'] in mb:mb[l['origin_id']]['outputs'][l['origin_slot']]['links'].append(l['id'])
        if l['target_id'] in mb:mb[l['target_id']]['inputs'][l['target_slot']]['link']=l['id']
    inputs=[{'id':str(uuid.uuid5(uuid.UUID(ENCID),name)),'name':name,'type':'STRING','linkIds':[3+i],'pos':[80,240+i*40]} for i,name in enumerate(['positive','negative'])]
    outputs=[{'id':str(uuid.uuid5(uuid.UUID(ENCID),'out'+name)),'name':name,'type':'CONDITIONING','linkIds':[5+i],'pos':[1800,240+i*40]} for i,name in enumerate(['positive','negative'])]
    sg={'id':ENCID,'version':1,'revision':1,'name':'FLUX.3 正负文本编码','state':{'lastGroupId':0,'lastNodeId':5,'lastLinkId':6,'lastRerouteId':0},'config':{},'nodes':members,'links':links,'inputs':inputs,'outputs':outputs,'widgets':[],'inputNode':{'id':-10,'bounding':[80,160,100,200]},'outputNode':{'id':-20,'bounding':[1780,160,160,200]},'groups':[],'extra':{},'last_node_id':5,'last_link_id':6}
    wf['definitions']['subgraphs'].append(sg)
    lid=max(l[0] for l in wf['links'])+1
    host={'id':41,'type':ENCID,'pos':[3100,2600],'size':[540,180],'flags':{},'order':0,'mode':0,'inputs':[{'name':name,'type':'STRING','link':lid+i} for i,name in enumerate(['positive','negative'])],'outputs':[{'name':name,'type':'CONDITIONING','links':[lid+2+i]} for i,name in enumerate(['positive','negative'])],'properties':{'subgraph':ENCID,'Node name for S&R':ENCID,'proxyWidgets':[]},'widgets_values':[],'title':'[41] FLUX.3 正负文本编码'}
    wf['nodes'].append(host)
    for i in range(2):wf['links'].append([lid+i,40,i,41,i,'STRING'])
    sampler=by[7]
    for i,name in enumerate(['positive','negative']):
        slot=next(j for j,v in enumerate(sampler['inputs']) if v['name']==name);sampler['inputs'][slot]['link']=lid+2+i
        wf['links'].append([lid+2+i,41,i,7,slot,'CONDITIONING'])
    for i in range(2):by[40]['outputs'][i]['links']=[lid+i]
    by[1]['pos']=[3100,1800];by[6]['pos']=[3100,4000];by[7]['pos']=[4600,2600];by[3]['pos']=[4600,5000];by[8]['pos']=[6100,2600];by[9]['pos']=[7600,2600]
    wf['last_link_id']=max(l[0] for l in wf['links']);return wf
