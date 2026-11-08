"""Bounded, source-read-only search for the directive-above-assembly layout."""
from pathlib import Path
import copy,json,sys,time,random
import numpy as np
import qi21_main_routes as r

OUT=r.ROOT/'apps/output/automation/qi21-directive-final-1027'
OUT.mkdir(parents=True,exist_ok=True)
doc=json.loads(r.locate('qi21-道劫-i2i.json').read_bytes())
nodes=doc['nodes'];ids=[n['id'] for n in nodes];ix={nid:i for i,nid in enumerate(ids)}
pos=np.array([n['pos'] for n in nodes],float)
original=pos.copy()
wh=np.array([[b[2]-b[0],b[3]-b[1]] for b in map(r.layout_check._occl_box,nodes)])
est=np.array([r.est_size(n) for n in nodes],float)
links=list(r.layout_check._iter_links(doc['links']))
o=np.array([ix[l[1]] for l in links]);t=np.array([ix[l[3]] for l in links]);os=np.array([l[2] for l in links]);ts=np.array([l[4] for l in links])
wi,wj=np.triu_indices(len(links),1)
ni,nj=np.triu_indices(len(nodes),1)
exempt=np.array([n.get('type') in r.layout_check.SPACING_EXEMPT_TYPES for n in nodes])
validspace=~exempt[ni]&~exempt[nj]
nonend=np.ones((len(links),len(nodes)),bool);nonend[np.arange(len(links)),o]=False;nonend[np.arange(len(links)),t]=False

def wires(p,samples):
 a=p[o]+np.stack([wh[o,0],25+20*os],axis=1)
 b=p[t]+np.stack([np.zeros(len(t)),25+20*ts],axis=1)
 k=np.clip(np.abs(b[:,0]-a[:,0])/2,40,200)
 aa=a.copy();aa[:,0]+=k;bb=b.copy();bb[:,0]-=k
 u=np.linspace(0,1,samples)[None,:,None];v=1-u
 return v**3*a[:,None]+3*v*v*u*aa[:,None]+3*v*u*u*bb[:,None]+u**3*b[:,None]

def counts(p,full=True):
 b=p+est
 xov=np.minimum(b[ni,0],b[nj,0])-np.maximum(p[ni,0],p[nj,0]);yov=np.minimum(b[ni,1],b[nj,1])-np.maximum(p[ni,1],p[nj,1])
 overlap=np.count_nonzero((xov>0)&(yov>0))
 spacing=np.count_nonzero(validspace&(((yov>0)&(xov<=0)&(-xov<200))|((xov>0)&(yov<=0)&(-yov<80))))
 left=np.count_nonzero(p[t,0]<=p[o,0]);neg=np.count_nonzero(np.any(p<80,axis=1));order=int(p[ix[400],1]>=p[ix[6],1])
 w=wires(p,41)
 hits=(w[:,:,None,0]>=p[None,None,:,0]-2)&(w[:,:,None,0]<=p[None,None,:,0]+wh[None,None,:,0]+2)&(w[:,:,None,1]>=p[None,None,:,1]-2)&(w[:,:,None,1]<=p[None,None,:,1]+wh[None,None,:,1]+2)
 occ=np.count_nonzero(np.any(hits&nonend[:,None,:],axis=(1,2)))
 if not full:return (occ,overlap,spacing,left,neg,order)
 w=wires(p,24);a=w[wi,:-1,None,:];b=w[wi,1:,None,:];c=w[wj,None,:-1,:];d=w[wj,None,1:,:]
 def cr(o,x,y):return (y[...,0]-o[...,0])*(x[...,1]-o[...,1])-(y[...,1]-o[...,1])*(x[...,0]-o[...,0])
 hit=((cr(c,d,a)>0)!=(cr(c,d,b)>0))&((cr(a,b,c)>0)!=(cr(a,b,d)>0))
 cross=np.count_nonzero(np.any(hit,axis=(1,2)))
 return (int(cross),int(occ),int(overlap),int(spacing),int(left),int(neg),int(order))

def score(c):return c[0]+80*c[1]+150*c[2]+35*c[3]+150*c[4]+200*c[5]+200*c[6]

if __name__=='__main__':
 print('baseline',counts(pos),flush=True)
 rng=random.Random(1027);best=None;start=time.time();runs=0
 movable=[400,6,17,18,12,16,401,4]
 p=original.copy();p[ix[400]]=[3232,3500];cur=counts(p);val=score(cur)
 while time.time()-start<145:
  runs+=1
  q=p.copy();nid=rng.choices(movable,weights=[5,3,2,2,2,1,1,1])[0];i=ix[nid]
  if runs%350==0:
   p=original.copy();p[ix[400]]=[rng.randrange(2200,3400,100),rng.randrange(1800,3700,100)];cur=counts(p);val=score(cur);continue
  step=rng.choice([60,100,160,240,400,700]);axis=rng.randrange(2)
  q[i,axis]+=rng.choice([-1,1])*step
  if not (2070<=q[i,0]<=5800 and 80<=q[i,1]<=5400):continue
  if nid==400 and q[i,0]>=q[ix[6],0]:continue
  c=counts(q);v=score(c);temp=max(.7,10*(1-((runs%350)/350)))
  if v<=val or rng.random()<np.exp(min(0,(val-v)/temp)):p=q;cur=c;val=v
  if c[1:]==(0,0,0,0,0,0) and (best is None or c[0]<best[0]):
   best=(c[0],q.copy());changes={str(nid):q[i].tolist() for i,nid in enumerate(ids) if not np.array_equal(q[i],original[i])}
   print('valid',runs,c,changes,flush=True)
   (OUT/'best.json').write_text(json.dumps({'counts':c,'changes':changes,'positions':{str(nid):q[i].tolist() for i,nid in enumerate(ids)},'runs':runs},indent=2)+'\n')
   if c[0]<=43:break
 print('done',runs,'best',None if best is None else best[0],'seconds',time.time()-start,flush=True)
