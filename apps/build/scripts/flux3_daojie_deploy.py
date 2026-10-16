#!/usr/bin/env python3
"""Scoped, hash-fenced Windows deployment for the FLUX.3 ten-type task."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-16-flux3-daojie-ten-types'
DATA = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
NODES = ROOT / 'apps/backend/engines/comfyui/my_nodes'


def remote(code):
    result = subprocess.run([sys.executable, str(Path(__file__).with_name('flux3_daojie_ssh.py')), '--timeout', '90'], input=code, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr + result.stdout)
    return json.loads(result.stdout)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('phase', choices=['data', 'nodes'])
    p.add_argument('--apply', action='store_true', help='Apply the previously inspected manifest; backs up existing bytes')
    a = p.parse_args()
    manifest_path = TASK / 'artifacts' / (a.phase + '-deploy-manifest.json')
    if not a.apply:
        items = []
        if a.phase == 'data':
            for filename in ['qi21_bases.json', 'qi21_strip_lexicon.json', 'daojie_lora_stack.json', 'daojie_loras.json']:
                src = DATA / 'json' / filename
                json.loads(src.read_text())
                for target in ['repo-data/json/', 'app-data/json/', 'runtime-data/']:
                    items.append((src, target + filename))
            src = DATA / 'ma_sync/palette-canon.json'
            json.loads(src.read_text())
            for target in ['repo-data/ma_sync/', 'app-data/ma_sync/', 'runtime-palette/']:
                items.append((src, target + src.name))
        else:
            # Only the current prompt-chain closure; no speed/rgba selector changes.
            for name in ['nodes/my_flux3_daojie_adapter.py', 'nodes/my_qi21_bases_text.py', 'nodes/my_qi21_api_pe.py', 'nodes/my_qi21_prompt_assembly.py']:
                for target in ['repo-nodes/', 'app-nodes/', 'runtime-nodes/']:
                    items.append((NODES / name, target + name))
        records = [{'source': str(s.relative_to(ROOT)), 'target': t, 'sha256': hashlib.sha256(s.read_bytes()).hexdigest(), 'payload': base64.b64encode(s.read_bytes()).decode()} for s,t in items]
        if a.phase == 'nodes':
            # Preserve each Windows registry's unrelated registrations and display strings.
            for target in ['repo-nodes/__init__.py', 'app-nodes/__init__.py', 'runtime-nodes/__init__.py']:
                records.append({'source': 'additive-registry', 'target': target, 'registry_patch': True})
        result = remote(PREAMBLE + '\nrecords=' + repr(records) + '\n' + INSPECT)
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({'manifest': str(manifest_path), 'files': len(result), 'changed': sum(x['old_sha256'] != x['sha256'] for x in result)}, ensure_ascii=False))
    else:
        records = json.loads(manifest_path.read_text())
        result = remote(PREAMBLE + '\nrecords=' + repr(records) + '\n' + APPLY)
        report = TASK / 'reports' / (a.phase + '-deployment.json')
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        print(json.dumps({'report': str(report), **result}, ensure_ascii=False))


PREAMBLE = '''from pathlib import Path
import base64,hashlib,json,shutil,time,urllib.request
r=Path('E:/IP')
h=next(p/'comfyui' for p in r.iterdir() if (p/'comfyui/manifest.json').is_file())
work=r/'flux3-ten-types-1016'
bases={'repo-data':r/'MYStudio/apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng','app-data':r/'manying-studio/resources/studio-manuals/art_skills/daojie_ink_guofeng','runtime-data':h/'daojie-data','runtime-palette':h/'ma_sync','repo-nodes':r/'MYStudio/apps/backend/engines/comfyui/my_nodes','app-nodes':r/'manying-studio/resources/backend/engines/comfyui/my_nodes','runtime-nodes':h/'ComfyUI/custom_nodes/my-nodes'}
def target(key):
 group,relative=key.split('/',1)
 path=bases[group]/relative
 assert path.resolve().is_relative_to(bases[group].resolve())
 return path
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
def idle():
 q=json.load(urllib.request.urlopen('http://127.0.0.1:17000/queue',timeout=8))
 assert not q['queue_running'] and not q['queue_pending'], 'Engine queue is occupied'
'''
INSPECT = '''idle()
for rec in records:
 path=target(rec['target']);rec['path']=str(path);rec['old_sha256']=digest(path)
 if rec.get('registry_patch'):
  old=path.read_text(encoding='utf-8')
  additions=[('from .nodes.my_qi21_api_pe import MyQi21ApiPE\\n','from .nodes.my_flux3_daojie_adapter import MyFlux3DaojieAdapter\\n'),('    "MyQi21BasesText": MyQi21BasesText,\\n','    "MyFlux3DaojieAdapter": MyFlux3DaojieAdapter,\\n'),('    "MyQi21BasesText": "漫影 真源文本",\\n','    "MyFlux3DaojieAdapter": "FLUX.3 道劫 RGB 适配",\\n')]
  new=old
  for anchor,addition in additions:
   assert new.count(anchor)==1,(str(path),anchor)
   if addition not in new:new=new.replace(anchor,anchor+addition)
  payload=new.encode('utf-8');rec['payload']=base64.b64encode(payload).decode();rec['sha256']=hashlib.sha256(payload).hexdigest()
print(json.dumps(records,ensure_ascii=True))
'''
APPLY = '''idle()
for rec in records:
 assert digest(target(rec['target']))==rec['old_sha256'], 'Target drift: '+rec['target']
 payload=base64.b64decode(rec['payload']);assert hashlib.sha256(payload).hexdigest()==rec['sha256']
stamp=time.strftime('%Y%m%d-%H%M%S');results=[]
for rec in records:
 idle();path=target(rec['target']);assert digest(path)==rec['old_sha256']
 backup=None
 if rec['old_sha256']!=rec['sha256']:
  if path.exists():
   backup=work/'backups'/stamp/rec['target'];backup.parent.mkdir(parents=True,exist_ok=True)
   shutil.copy2(path,backup);assert digest(backup)==rec['old_sha256']
  path.parent.mkdir(parents=True,exist_ok=True)
  path.write_bytes(base64.b64decode(rec['payload']))
 assert digest(path)==rec['sha256']
 results.append({'target':str(path),'old_sha256':rec['old_sha256'],'sha256':rec['sha256'],'backup':str(backup) if backup else None})
print(json.dumps({'ok':True,'files':results,'restart_required':True},ensure_ascii=True))
'''

if __name__ == '__main__':
    main()
