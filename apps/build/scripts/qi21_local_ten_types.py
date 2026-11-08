#!/usr/bin/env python3
"""One-off installed-backend ten-type receipt runner; inspect unless --generate.
Does not alter product defaults, dimensions, sampler settings or model parameters.
"""
from __future__ import annotations
import argparse
import asyncio
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import random
import sys
import threading
import time
import urllib.parse
import urllib.request

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/10-16-qi21-defaults-install'
INSTALLED = Path('/Applications/漫影工作室.app/Contents/Resources/backend')


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def request_json(url):
    with urllib.request.urlopen(url, timeout=15) as response:
        return json.load(response)


def image_metrics(data):
    import numpy as np
    from PIL import Image
    im = Image.open(io.BytesIO(data)).convert('RGBA')
    a = np.asarray(im)
    visible = a[:, :, 3] > 8
    rgb = a[:, :, :3][visible]
    result = {'width': im.width, 'height': im.height,
              'alpha_min': int(a[:, :, 3].min()), 'alpha_max': int(a[:, :, 3].max()),
              'visible_ratio': float(visible.mean()),
              'rgb_std': float(rgb.std()) if rgb.size else 0.0,
              'rgb_mean': float(rgb.mean()) if rgb.size else 0.0}
    assert result['visible_ratio'] > .001, result
    assert result['rgb_std'] > 2 and 1 < result['rgb_mean'] < 254, result
    return result


class Events:
    def __init__(self, url, client):
        self.url = url.replace('http://', 'ws://') + '/ws?clientId=' + client
        self.events = []
        self.ready = threading.Event()
        self.stop = threading.Event()
        self.error = None
        self.thread = threading.Thread(target=lambda: asyncio.run(self.listen()), daemon=True)

    async def listen(self):
        import aiohttp
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(self.url) as ws:
                    self.ready.set()
                    while not self.stop.is_set():
                        try:
                            msg = await ws.receive(timeout=1)
                        except asyncio.TimeoutError:
                            continue
                        if msg.type == aiohttp.WSMsgType.TEXT:
                            self.events.append(json.loads(msg.data))
                        elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                            break
        except Exception as exc:
            self.error = repr(exc)
            self.ready.set()

    def start(self):
        self.thread.start()
        assert self.ready.wait(10), 'websocket handshake timeout'
        assert not self.error, self.error

    def close(self):
        self.stop.set()
        self.thread.join(3)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--generate', action='store_true')
    ap.add_argument('--only', help='Exact one type, for a diagnosed rerun')
    ap.add_argument('--run-name', default=time.strftime('%Y%m%d-%H%M%S'))
    args = ap.parse_args()
    home = Path.home() / 'Library/Application Support' / '漫影工作室' / 'comfyui'
    manifest = json.loads((home / 'manifest.json').read_text())
    url = f"http://127.0.0.1:{manifest['engine']['port']}"
    corpus = json.loads((TASK / 'research/ten-type-inputs.json').read_text())['items']
    if args.only:
        corpus = [r for r in corpus if r['type'] == args.only]
        assert corpus, 'Unknown exact type'
    template = next((INSTALLED / 'comfyui/workflows').rglob('qwen21-道劫-t2i-api.json'))
    g = json.loads(template.read_text())['graph']
    assert g['6:4013']['inputs']['AI扩写开关'] is False
    assert g['7:7015']['inputs']['mode'] == '0 · Turbo 8步'
    assert g['7:7028']['inputs']['model'] == ['7:7027', 0]
    assert g['7:7027']['inputs']['strength_model'] == .5
    assert g['7:7028']['inputs']['lora_name'] == 'qwen_image_2.1_turbo_lora_avg_rank_178_bf16.safetensors'
    print(json.dumps({'installed_template_sha256': sha(template), 'url': url,
                      'types': [r['type'] for r in corpus], 'generate': args.generate}, ensure_ascii=False), flush=True)
    if not args.generate:
        return
    assert not request_json(url + '/queue')['queue_running'], 'engine busy'
    os.environ['MYSTUDIO_COMFYUI_HOME'] = str(home)
    os.environ['MYSTUDIO_IMAGE_MODEL_DIR'] = str(home.parent / 'model/imagegen')
    os.environ['MYSTUDIO_COMFYUI_BRIDGE_TIMEOUT_S'] = '2400'
    sys.path.insert(0, str(INSTALLED))
    from image_gen import pipeline
    from engines.image_engine import qwen21
    assert Path(qwen21.__file__).resolve().is_relative_to(INSTALLED.resolve())
    root = TASK / 'evidence/local-ten-types' / args.run_name
    root.mkdir(parents=True, exist_ok=False)
    dump(root / 'environment.json', {'template': str(template), 'template_sha256': sha(template),
         'backend': str(qwen21.__file__), 'backend_sha256': sha(Path(qwen21.__file__)),
         'input_source': str(TASK / 'research/ten-type-inputs.json'), 'url': url})
    original = qwen21._http_json
    results = []
    for index, row in enumerate(corpus, 1):
        queue = request_json(url + '/queue')
        assert not queue['queue_running'] and not queue['queue_pending'], 'engine queue occupied'
        directory = root / f'{index:02d}-{row["type"]}'
        directory.mkdir()
        seed = random.SystemRandom().randint(1, 2**53-1)
        dump(directory / 'input.json', {**row, 'seed': seed, 'entry': 'image_gen.pipeline.generate_image'})
        sockets = []
        submitted = {}
        history = {}
        started = time.time()

        def observe(method, endpoint, payload=None, timeout=2):
            if method == 'POST' and endpoint.endswith('/prompt'):
                dump(directory / 'submitted-prompt.json', payload)
                events = Events(url, payload['client_id'])
                events.start()
                sockets.append(events)
            response = original(method, endpoint, payload, timeout)
            if method == 'POST' and endpoint.endswith('/prompt'):
                submitted.update(response)
                dump(directory / 'submitted-response.json', response)
                assert not response.get('node_errors'), response.get('node_errors')
            if '/history/' in endpoint and response:
                history.clear()
                history.update(response)
                dump(directory / 'history.json', response)
            return response

        qwen21._http_json = observe
        try:
            print(f'START {index}/{len(corpus)} {row["type"]} seed={seed}', flush=True)
            b64 = pipeline.generate_image(qwen21.MODEL_NAME, row['prompt'], seed=seed, base_type=row['type'])
            content = base64.b64decode(b64)
            (directory / 'product-output.png').write_bytes(content)
            metrics = image_metrics(content)
            pid = submitted['prompt_id']
            entry = history[pid]
            assert entry['status']['status_str'] == 'success'
            pe = entry['outputs'].get('6:4013', {})
            assert '未请求模型' in json.dumps(pe, ensure_ascii=False), 'No direct PE status receipt'
            # Save both product outputs, including the unscaled RGBA source.
            artifacts = []
            for node in ('8', '504'):
                for j, image in enumerate(entry['outputs'].get(node, {}).get('images', [])):
                    query = urllib.parse.urlencode({k:image.get(k, '') for k in ('filename','subfolder','type')})
                    data = urllib.request.urlopen(url + '/view?' + query, timeout=30).read()
                    dest = directory / f'node-{node}-{j}.png'
                    dest.write_bytes(data)
                    artifacts.append({'path': str(dest), 'sha256': sha(dest), 'metrics':image_metrics(data)})
            assert artifacts, 'No image outputs'
            for events in sockets:
                events.close()
            recorded = [event for sock in sockets for event in sock.events]
            executed = {str(event['data']['node']) for event in recorded
                        if event.get('type') == 'executing' and event.get('data', {}).get('node')}
            cached = {str(node) for event in recorded if event.get('type') == 'execution_cached'
                      for node in event.get('data', {}).get('nodes', [])}
            assert {'7:7027', '7:7028'} <= executed | cached, 'Missing Fix/Turbo runtime events'
            assert not {'7:7011', '7:7012', '7:7024'} & executed, 'viggle executed'
            from qi21_defaults_acceptance import judge_execution
            verdict = judge_execution(json.loads((directory / 'submitted-prompt.json').read_text())['prompt'], history, pid, recorded)
            dump(directory / 'execution-verdict.json', verdict)
            assert verdict['ok'], verdict['errors']
            result = {'type':row['type'], 'ok':True, 'prompt_id':pid, 'seconds':time.time()-started,
                      'seed':seed, 'executed':sorted(executed), 'cached':sorted(cached),
                      'product_metrics':metrics, 'sha256':sha(directory/'product-output.png'), 'artifacts':artifacts}
            dump(directory / 'receipt.json', result)
            results.append(result)
            print(f'PASS {row["type"]} {pid} {result["seconds"]:.1f}s', flush=True)
        except Exception as exc:
            dump(directory / 'failure.json', {'type':row['type'], 'error':repr(exc), 'submitted':submitted,
                  'seconds':time.time()-started})
            results.append({'type':row['type'], 'ok':False, 'error':repr(exc)})
            raise
        finally:
            qwen21._http_json = original
            for events in sockets:
                events.close()
                dump(directory / 'events.json', {'events':events.events,'error':events.error})
            dump(root / 'summary.json', {'ok':all(r['ok'] for r in results) and len(results)==len(corpus), 'results':results})
    print('COMPLETE ' + str(root), flush=True)


if __name__ == '__main__':
    main()
