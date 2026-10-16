"""Read-only public model discovery; stores provider evidence in the active task."""
import concurrent.futures
import json
from pathlib import Path
import requests

OUT=Path('.trellis/tasks/10-16-flux3-daojie-ten-types/research')
jobs=[('hf-flux3','https://huggingface.co/api/models',{'search':'flux3','limit':100,'full':'true'}),('hf-gongbi','https://huggingface.co/api/models',{'search':'gongbi','limit':30,'full':'true'}),('hf-baimiao','https://huggingface.co/api/models',{'search':'baimiao','limit':20,'full':'true'}),('hf-asian','https://huggingface.co/api/models',{'search':'klein asian','limit':20,'full':'true'}),('civ-gongbi','https://civitai.com/api/v1/models',{'query':'gongbi','limit':15}),('civ-asian','https://civitai.com/api/v1/models',{'query':'Asian','limit':20}),('civ-flux3','https://civitai.com/api/v1/models',{'query':'Flux 3','limit':20}),('hf-flux3-hyphen','https://huggingface.co/api/models',{'search':'flux-3','limit':100,'full':'true'})]

def fetch(job):
 name,url,params=job
 try:
  r=requests.get(url,params=params,timeout=25);r.raise_for_status();d=r.json();(OUT/('lora-'+name+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2))
  if isinstance(d,list):summary=[{'id':x['id'],'tags':x.get('tags',[])} for x in d]
  else:summary=[{'id':x['id'],'name':x['name'],'versions':[{'id':v['id'],'name':v['name'],'baseModel':v['baseModel']} for v in x['modelVersions'][:2]]} for x in d['items']]
  return name,summary
 except Exception as e:return name,{'error':str(e)}
if __name__=='__main__':
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
  for name,result in pool.map(fetch,jobs):print(name,json.dumps(result,ensure_ascii=False))
