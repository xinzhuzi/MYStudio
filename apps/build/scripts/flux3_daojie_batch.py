#!/usr/bin/env python3
"""Task-local serial orchestration; no parallel GPU jobs, stop at first failed type."""
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image
import flux3_daojie_workflow as w

if __name__=='__main__':
    cases=json.loads((w.TASK/'artifacts/cases.json').read_text())
    for case in cases[2:]:
        folder=w.TASK/'artifacts'/f"{case['index']:02d}"
        if (folder/'receipt.json').exists():
            print('Already persisted: '+case['type'],flush=True)
            continue
        logfile=w.TASK/'reports'/f"run-{case['index']:02d}.txt"
        print('Starting '+case['type'],flush=True)
        with logfile.open('w') as log:
            p=subprocess.run([sys.executable,str(Path(__file__).with_name('flux3_daojie_ten_types.py')),'run-windows','--type',case['type']],stdout=log,stderr=subprocess.STDOUT)
        if p.returncode:
            print('Stopped on failure: '+case['type']+'; '+str(logfile),flush=True)
            sys.exit(p.returncode)
        im=Image.open(folder/'image.png');im.thumbnail((768,768));im.save(folder/'image_thumb.png',optimize=True)
        while (folder/'image_thumb.png').stat().st_size>=1000000:
            im.thumbnail((int(im.width*0.85),int(im.height*0.85)))
            im.save(folder/'image_thumb.png',optimize=True)
        print('Generated '+case['type'],flush=True)
