"""Read-only bounded refinement around the valid directive ordering."""
import qi21_directive_solver as s
import time,random,json,math
rng=random.Random(2771)
base=s.original.copy();base[s.ix[400]]=[2840,3400];base[s.ix[12]]=[2870,2300]
p=base.copy();val=s.score(s.counts(p));best=(val,p.copy());start=time.time();runs=0
movable=[400,6,17,18,12,16,401,4,505,4015,171,9,10,11,7,20,3]
while time.time()-start<90:
 runs+=1
 if runs%700==0:p=best[1].copy();val=best[0]
 q=p.copy()
 for nid in rng.sample(movable,1 if rng.random()<.8 else 2):
  i=s.ix[nid];step=rng.choice([20,40,80,120,200,300,500]);axis=rng.randrange(2);q[i,axis]+=rng.choice([-1,1])*step
 c=s.counts(q);v=s.score(c)
 temp=max(.8,3*(1-runs%700/700))
 if v<=val or rng.random()<math.exp(min(0,(val-v)/temp)):p=q;val=v
 if v<best[0]:
  best=(v,q.copy());print('best',runs,c,flush=True)
 if c[0]<=43 and not any(c[1:]):
  changes={str(n):q[i].tolist() for i,n in enumerate(s.ids) if not s.np.array_equal(q[i],s.original[i])}
  d=s.copy.deepcopy(s.doc)
  for n in d['nodes']:n['pos']=q[s.ix[n['id']]].tolist()
  official=s.r.layout_check.check_workflow(d)[0]['counts']
  print('found',official,changes,flush=True)
  if all(official[k]==0 for k in official if k!='crossings') and official['crossings']<=43:
   s.OUT.joinpath('direct-minimal.json').write_text(json.dumps({'counts':official,'changes':changes},indent=2)+'\n');break
print('done',runs,'best',best[0],'seconds',time.time()-start,flush=True)
