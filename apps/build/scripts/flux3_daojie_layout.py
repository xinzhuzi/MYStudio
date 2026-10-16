"""Task-local deterministic layout optimization; exact checker remains the acceptance gate."""
from pathlib import Path
import copy
import importlib.util
import json
import random
import sys
import numpy as np

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'.agents/skills/node-graph/tools'))
import layout_check as lc


def optimize_scope(nodes,links,sg,seed):
    rng=random.Random(seed);by={n['id']:n for n in nodes}
    edges=[(lid,a,sa,b,sb) for lid,a,sa,b,sb in lc._iter_links(links) if a in by and b in by]
    # Match serialized input order to graph families; names preserve the execution ABI.
    if 4013 in by:
        n=by[4013];old=n['inputs'][:]
        names=['系统提示词','色卡','美术风格底座-正向','美术风格底座-负向','正向提示词','负向提示词','类型句正向','画幅宽','画幅高','透明模式','类型句负向']
        n['inputs'].sort(key=lambda x:names.index(x['name']))
        for l in links:
            if l['target_id']==4013:l['target_slot']=next(i for i,v in enumerate(n['inputs']) if v['name']==old[l['target_slot']]['name'])
        edges=[(lid,a,sa,b,sb) for lid,a,sa,b,sb in lc._iter_links(links) if a in by and b in by]
    depth={n:0 for n in by}
    for _ in by:
        for _,a,_,b,_ in edges:depth[b]=max(depth[b],depth[a]+1)
    for k,n in by.items():n['pos']=[100+depth[k]*1400,100+rng.randrange(0,10)*500]
    ids=list(by);index={n:i for i,n in enumerate(ids)}
    widths=np.array([lc._size_wh(by[n]['size'])[0] for n in ids]);heights=np.array([lc._size_wh(by[n]['size'])[1] for n in ids])
    ai=np.array([index[a] for _,a,_,b,_ in edges]);bi=np.array([index[b] for _,a,_,b,_ in edges]);ass=np.array([sa for _,a,sa,b,sb in edges]);bss=np.array([sb for _,a,sa,b,sb in edges])
    pairs=[(i,j) for i in range(len(edges)) for j in range(i+1,len(edges))]
    x=np.array([by[n]['pos'][0] for n in ids],dtype=float);y=np.array([by[n]['pos'][1] for n in ids],dtype=float)
    def score(yy):
        start=np.stack([x[ai]+widths[ai],yy[ai]+25+ass*20],axis=1)
        end=np.stack([x[bi],yy[bi]+25+bss*20],axis=1)
        t=np.linspace(0,1,24)[None,:,None];k=np.clip(abs(end[:,0]-start[:,0])/2,40,200)
        p1=start.copy();p1[:,0]+=k;p2=end.copy();p2[:,0]-=k
        lines=(1-t)**3*start[:,None,:]+3*(1-t)**2*t*p1[:,None,:]+3*(1-t)*t*t*p2[:,None,:]+t**3*end[:,None,:]
        cross=0
        for i,j in pairs:
            a=lines[i,:-1,None,:];b=lines[i,1:,None,:];c=lines[j,None,:-1,:];d=lines[j,None,1:,:]
            cr=lambda p,q,r:(q[...,0]-p[...,0])*(r[...,1]-p[...,1])-(q[...,1]-p[...,1])*(r[...,0]-p[...,0])
            if np.any(((cr(a,b,c)>0)!=(cr(a,b,d)>0))&((cr(c,d,a)>0)!=(cr(c,d,b)>0))):cross+=1
        occl=0
        for e,(_,a,_,b,_) in enumerate(edges):
            for n,idx in index.items():
                if n in (a,b):continue
                pts=lines[e]
                if np.any((pts[:,0]>x[idx]-2)&(pts[:,0]<x[idx]+widths[idx]+2)&(pts[:,1]>yy[idx]-2)&(pts[:,1]<yy[idx]+heights[idx]+2)):occl+=1
        overlap=0
        for i in range(len(ids)):
            for j in range(i+1,len(ids)):
                if abs(x[i]-x[j])<max(widths[i],widths[j])+200 and yy[i]<yy[j]+heights[j]+100 and yy[j]<yy[i]+heights[i]+100:overlap+=1
        return cross*10+occl*40+overlap*100
    best=y.copy();bestscore=score(best);current=best.copy();s=bestscore
    for iteration in range(5000):
        trial=current.copy();i=rng.randrange(len(ids))
        if rng.random()<0.35:
            j=rng.randrange(len(ids));trial[i],trial[j]=trial[j],trial[i]
        else:trial[i]=max(100,trial[i]+rng.choice([-1200,-600,-300,-100,100,300,600,1200]))
        value=score(trial);temp=max(.4,12*(1-iteration/5000))
        if value<=s or rng.random()<np.exp(min(0,(s-value)/temp)):current=trial;s=value
        if value<bestscore:best=trial.copy();bestscore=value
        if bestscore==0:break
    for n,i in index.items():by[n]['pos']=[int(x[i]),int(best[i])]
    if sg:
        right=max(n['pos'][0]+n['size'][0] for n in nodes)+300
        for i,o in enumerate(sg['outputs']):o['pos']=[right,300+i*40]
        sg['outputNode']['bounding']=[right-20,200,160,300]
        for i,o in enumerate(sg['inputs']):o['pos']=[80,300+i*40]
        sg['inputNode']['bounding']=[80,200,100,250]
    return bestscore


def apply(wf):
    for i,(name,nodes,_,sg) in enumerate(lc._scopes(wf)):
        links=sg['links'] if sg else wf['links']
        print('optimizing',name,flush=True)
        score=optimize_scope(nodes,links,sg,1016+i)
        print('approximate score',score,flush=True)
    return wf


if __name__=='__main__':
    p=next((ROOT/'apps/backend/engines/comfyui/workflows').rglob('flux3-道劫-t2i.json'))
    wf=json.loads(p.read_text());assert wf['extra']['flux3TaskOwner']=='flux3-daojie-ten-types-1016'
    apply(wf);p.write_text(json.dumps(wf,ensure_ascii=False,indent=2)+'\n')
    r=lc.check_workflow(wf);print(json.dumps(r,ensure_ascii=False,indent=2))
