"""Inspect saved PNG metadata locally; no engine calls or production writes."""
from pathlib import Path
import json
import struct
import zlib

ROOT=Path(__file__).resolve().parents[3]
IP=next(p for p in Path('/Users/zhengbingjin/Project/IP').iterdir() if p.name=='漫影工作室')
SOURCE=next(p for p in (IP/'comfyui/output').iterdir() if p.name=='QI21道劫文生图__00003_.png')
OUT=ROOT/'apps/output/automation/qi21-render-style-diagnosis-1016-00003'
b=SOURCE.read_bytes();offset=8;metadata={}
while offset<len(b):
    size=struct.unpack('>I',b[offset:offset+4])[0]
    kind=b[offset+4:offset+8];data=b[offset+8:offset+8+size];offset+=size+12
    if kind==b'tEXt':
        key,value=data.split(b'\0',1);metadata[key.decode()]=value.decode()
    elif kind==b'zTXt':
        key,value=data.split(b'\0',1);metadata[key.decode()]=zlib.decompress(value[1:]).decode()
prompt=json.loads(metadata['prompt']);workflow=json.loads(metadata['workflow'])
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'saved-prompt.json').write_text(json.dumps(prompt,ensure_ascii=False,indent=2)+'\n')
(OUT/'saved-workflow.json').write_text(json.dumps(workflow,ensure_ascii=False,indent=2)+'\n')
for key,node in prompt.items():
    print(json.dumps({'id':key,'class_type':node['class_type'],'title':node.get('_meta',{}).get('title'),'inputs':list(node.get('inputs',{}))},ensure_ascii=False))
print('saved',len(prompt),'nodes to',OUT)
