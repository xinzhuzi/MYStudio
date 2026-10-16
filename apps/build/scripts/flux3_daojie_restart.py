"""One controlled restart of the preflight-identified Windows engine; run over SSH."""
from pathlib import Path
import json
import subprocess
import time
import urllib.request

work=Path('E:/IP/flux3-ten-types-1016')
def ps(command):
    result=subprocess.run(['powershell','-NoProfile','-Command',"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); "+command],capture_output=True,timeout=15)
    return {'exit_code':result.returncode,'stdout':result.stdout.decode('utf-8-sig',errors='replace'),'stderr':result.stderr.decode('utf-8-sig',errors='replace')}
def get(path):
    return json.load(urllib.request.urlopen('http://127.0.0.1:17000'+path,timeout=4))
report={}
q=get('/queue');assert not q['queue_running'] and not q['queue_pending']
proc=ps("Get-CimInstance Win32_Process -Filter 'ProcessId=21596' | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json")
p=json.loads(proc['stdout']);assert p['ParentProcessId']==11872 and 'ComfyUI/main.py' in p['CommandLine'] and '--port 17000' in p['CommandLine']
report['before']=p
report['gentle_stop']=ps('taskkill /PID 21596')
time.sleep(2)
remaining=ps("Get-CimInstance Win32_Process -Filter 'ProcessId=21596' | Select-Object ProcessId,CommandLine | ConvertTo-Json")
if remaining['stdout'].strip():
    assert json.loads(remaining['stdout'])['CommandLine']==p['CommandLine']
    report['targeted_stop']=ps('taskkill /F /PID 21596')
time.sleep(3)
listeners=ps('Get-NetTCPConnection -State Listen -LocalPort 17000 -ErrorAction SilentlyContinue | Select-Object OwningProcess | ConvertTo-Json')
assert not listeners['stdout'].strip(), 'Listener remained/reappeared; do not launch a second instance'
report['launch']=ps('schtasks /Run /TN EngineDurable')
assert report['launch']['exit_code']==0
for attempt in range(20):
    time.sleep(2)
    try:
        report['after_stats']=get('/system_stats')
        break
    except Exception:pass
else:raise RuntimeError('Engine not ready after one launch; inspect logs, no auto restart')
report['listeners']=ps('Get-NetTCPConnection -State Listen -LocalPort 17000 | Select-Object OwningProcess | ConvertTo-Json')
info=get('/object_info')
required=['MyQi21DaojieBase','MyQi21ApiPE','MyQi21FinalOutput','MyQi21系统提示词','MyQi21色卡','MyQi21美术风格底座','MyFlux3DaojieAdapter']
report['required_nodes']={n:n in info for n in required}
report['ok']=all(report['required_nodes'].values())
(work/'engine-restart.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=True))
