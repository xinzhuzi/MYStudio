"""Read a bounded Windows ComfyUI history page; never submit or change a job."""
import argparse
import base64
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence', type=Path, required=True)
args = parser.parse_args()
if not args.evidence.is_dir():
    parser.error('evidence must be an existing directory')

# max_items is verified against the installed server.py route, lines 1135-1147.
remote_code = '''import json,urllib.request
url='http://127.0.0.1:17000/history?max_items=20'
with urllib.request.urlopen(url,timeout=8) as response:
    raw=response.read(2_000_001)
if len(raw)>2_000_000:
    raise RuntimeError('bounded history page exceeded 2 MB; no retry')
history=json.loads(raw)
print(json.dumps({'url':url,'responseBytes':len(raw),'history':history},ensure_ascii=True))
'''
compile(remote_code, 'read-only-remote-history', 'exec')
encoded = base64.b64encode(remote_code.encode()).decode()
command = ('D:\\Python312\\python.exe -c "import base64;'
           "exec(base64.b64decode('" + encoded + "'))\"")
process = subprocess.run(
    ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8',
     'zbj@192.168.0.101', command], capture_output=True, text=True, timeout=25,
)
record = {'time': datetime.now(timezone.utc).isoformat(), 'remoteCode': remote_code,
          'exitCode': process.returncode, 'stdout': process.stdout, 'stderr': process.stderr}
(args.evidence / 'plugin-history-raw-1028.json').write_text(
    json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
)
if process.returncode:
    print(json.dumps({'probeExit': process.returncode, 'evidenceWritten': True}))
    raise SystemExit(1)

payload = json.loads(process.stdout)
history = payload['history']
if not isinstance(history, dict):
    raise TypeError('history is not a prompt-id object')
rows = []
for prompt_id, entry in history.items():
    # Traverse without assuming prompt tuple positions; retain actual top-level keys.
    pending, classes = [entry], set()
    while pending:
        value = pending.pop()
        if isinstance(value, dict):
            if isinstance(value.get('class_type'), str):
                classes.add(value['class_type'])
            pending.extend(value.values())
        elif isinstance(value, list):
            pending.extend(value)
    rows.append({'promptId': prompt_id, 'entryKeys': sorted(entry),
                 'nodeClasses': sorted(classes),
                 'hasApplyMossImageEdit': 'ApplyMossImageEdit' in classes,
                 'statusRaw': entry.get('status')})
result = {'responseBytes': payload['responseBytes'], 'rows': rows,
          'matchingEntries': sum(row['hasApplyMossImageEdit'] for row in rows),
          'limit': 'Only this current 20-item page; absence does not disprove historical execution.'}
(args.evidence / 'plugin-history-summary-1028.json').write_text(
    json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8',
)
print(json.dumps({'probeExit': 0, 'entries': len(rows),
                  'matchingEntries': result['matchingEntries']}))
