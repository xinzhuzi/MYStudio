#!/usr/bin/env python3
"""Run installed i2i/edit canvases, preserving PE/speed defaults; fail on first error."""
import argparse
import hashlib
import json
from pathlib import Path
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from qi21_local_ten_types import Events, image_metrics, dump, sha, request_json, TASK, INSTALLED
from qwen21_bridge_template_build import flatten_canvas, check_object_info, object_info, engine_base


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--generate', action='store_true')
    ap.add_argument('--only', choices=('i2i', 'edit'))
    ap.add_argument('--run-name', default=time.strftime('%Y%m%d-%H%M%S'))
    args = ap.parse_args()
    url = engine_base()
    schemas = object_info()
    paths = {'i2i': 'qi21-道劫-i2i.json', 'edit': 'qi21-edit.json'}
    prepared = []
    for line, name in paths.items():
        if args.only and line != args.only:
            continue
        path = next((INSTALLED / 'engines/comfyui/workflows').rglob(name))
        workflow = json.loads(path.read_text())
        graph = flatten_canvas(workflow, schemas)
        check_object_info(graph, schemas)
        assert graph['7:7015']['inputs']['mode'] == '0 · Turbo 8步'
        assert graph['7:7028']['inputs']['model'] == ['7:7027', 0]
        assert graph['7:7027']['inputs']['strength_model'] == .5
        assert graph['6:4012']['inputs']['value'] is False
        assert not any(n['class_type'] in ('TextGenerate', 'CheckpointLoader') for n in graph.values())
        seed = random.SystemRandom().randint(1, 2**53-1)
        graph['7:7014']['inputs']['value'] = seed
        print(f'PREPARED {line} nodes={len(graph)} seed={seed}', flush=True)
        prepared.append((line, path, workflow, graph, seed))
    if not args.generate:
        return
    root = TASK / 'evidence/installed-i2i-edit' / args.run_name
    root.mkdir(parents=True, exist_ok=False)
    results = []
    for line, path, workflow, graph, seed in prepared:
        queue = request_json(url + '/queue')
        assert not queue['queue_running'] and not queue['queue_pending'], 'engine busy'
        directory = root / line
        directory.mkdir()
        dump(directory / 'workflow.json', workflow)
        dump(directory / 'source.json', {'path':str(path), 'sha256':sha(path), 'seed':seed,
             'converter_sha256':sha(Path(__file__).with_name('qwen21_bridge_template_build.py'))})
        client = str(uuid.uuid4())
        payload = {'prompt':graph, 'client_id':client, 'extra_data':{'extra_pnginfo':{'workflow':workflow}}}
        dump(directory / 'submitted-prompt.json', payload)
        events = Events(url, client)
        started = time.time()
        try:
            events.start()
            req = urllib.request.Request(url + '/prompt', data=json.dumps(payload).encode(), headers={'Content-Type':'application/json'})
            try:
                response = json.load(urllib.request.urlopen(req, timeout=30))
            except urllib.error.HTTPError as exc:
                (directory / 'http-error.txt').write_bytes(exc.read())
                raise
            dump(directory / 'submitted-response.json', response)
            assert not response.get('node_errors'), response.get('node_errors')
            pid = response['prompt_id']
            print(f'START {line} {pid}', flush=True)
            while time.time()-started < 3600:
                history = request_json(url + '/history/' + pid)
                if pid in history:
                    dump(directory / 'history.json', history)
                    break
                time.sleep(2)
            else:
                raise TimeoutError('history timeout; job retained for diagnosis')
            entry = history[pid]
            assert entry['status']['status_str'] == 'success', entry['status']
            artifacts = []
            for node, output in entry['outputs'].items():
                for index, metadata in enumerate(output.get('images', [])):
                    query = urllib.parse.urlencode({key:metadata.get(key,'') for key in ('filename','subfolder','type')})
                    data = urllib.request.urlopen(url + '/view?' + query, timeout=30).read()
                    destination = directory / f'node-{node.replace(":","-")}-{index}.png'
                    destination.write_bytes(data)
                    artifacts.append({'node':node,'path':str(destination),'sha256':sha(destination),'metrics':image_metrics(data)})
            assert artifacts, 'no usable image'
            events.close()
            executed = {str(e['data']['node']) for e in events.events if e.get('type')=='executing' and e.get('data',{}).get('node')}
            cached = {str(n) for e in events.events if e.get('type')=='execution_cached' for n in e.get('data',{}).get('nodes',[])}
            assert {'7:7027','7:7028'} <= executed | cached, 'missing Fix/Turbo events'
            assert not {'7:7011','7:7012','7:7024','6:4013'} & executed, 'unused branch executed'
            from qi21_defaults_acceptance import judge_execution
            verdict = judge_execution(graph, history, pid, events.events)
            dump(directory / 'execution-verdict.json', verdict)
            assert verdict['ok'], verdict['errors']
            result = {'line':line,'ok':True,'prompt_id':pid,'seed':seed,'seconds':time.time()-started,
                      'executed':sorted(executed),'cached':sorted(cached),'artifacts':artifacts}
            dump(directory / 'receipt.json', result)
            results.append(result)
            print(f'PASS {line} {result["seconds"]:.1f}s', flush=True)
        except Exception as exc:
            dump(directory / 'failure.json', {'error':repr(exc),'seconds':time.time()-started})
            results.append({'line':line,'ok':False,'error':repr(exc)})
            raise
        finally:
            events.close()
            dump(directory / 'events.json', {'events':events.events,'error':events.error})
            dump(root / 'summary.json', {'ok':len(results)==len(prepared) and all(r['ok'] for r in results),'results':results})


if __name__ == '__main__':
    main()
