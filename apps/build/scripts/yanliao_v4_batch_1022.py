"""晏燎 v4 全量图生图(10-22 用户令):九期×3产物=27发,练气已手验跳过。
参考图=各自期正视图(prompts.json 参考图字段);v4=操作句+类型词(人脸/多视图)+底座。
炼虚512x1024长条源特判:人脸/风格转换改道劫美术类型路+手动1024²方形画幅。
每发后 /free 保险;断点续跑(产物在即跳过);产物=apps/output/晏燎/trial/*_v4.png。
"""
import json, sys, time, uuid
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
from engines.image_engine.comfyui_bridge import instantiate_template, load_template

ENGINE = "http://127.0.0.1:17001"
ROLE = Path('/Users/zhengbingjin/Project/IP/MA/store/assets/files/role/晏燎')
OUT = Path(__file__).resolve().parents[2] / 'output/晏燎/trial'
ITEMS = [x for x in json.loads((OUT.parent / 'prompts.json').read_text())['条目'] if x['期'] != '练气']

def upload(b, name):
    bd = uuid.uuid4().hex
    body = (b'--' + bd.encode() + f'\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\nContent-Type: image/png\r\n\r\n'.encode() + b + b'\r\n--' + bd.encode() + b'--\r\n')
    r = ureq.Request(ENGINE + '/upload/image', data=body, headers={'Content-Type': f'multipart/form-data; boundary={bd}'})
    return json.load(ureq.urlopen(r, timeout=60))['name']

def post(p, pl):
    r = ureq.Request(ENGINE + p, data=json.dumps(pl).encode(), headers={'Content-Type': 'application/json'})
    return json.load(ureq.urlopen(r, timeout=30))

def log(m):
    print(m, flush=True)
    with open(OUT.parent / 'v4_batch.log', 'a') as f: f.write(m + '\n')

refs, done, fail, skip = {}, 0, 0, 0
for it in ITEMS:
    out = OUT / f"晏燎_{it['期']}期_{it['产物']}_v4.png"
    if out.exists():
        skip += 1; continue
    try:
        if it['参考图'] not in refs:
            refs[it['参考图']] = upload((ROLE / it['参考图']).read_bytes(), f"yl-v4-{it['参考图']}")
        t = load_template('qwen21_道劫_i2i_api')
        graph = instantiate_template(t, it['提示词终稿'], None, 8, uuid.uuid4().int % 2**31, '1:1', [refs[it['参考图']]])
        for nid in ('11', '17'): graph.pop(nid, None)
        graph['4015']['inputs'].pop('images.image_2', None)
        for k, v in it['节点覆写'].items():
            nid, key = k.split('.'); graph[nid]['inputs'][key] = v
        if it['期'] == '炼虚' and it['产物'] != '人物多视图':
            graph['6:4022']['inputs']['组装用途'] = '道劫美术类型'
            graph['6:4018']['inputs']['手动宽'] = 1024; graph['6:4018']['inputs']['手动高'] = 1024
        pid = post('/prompt', {'prompt': graph, 'client_id': 'yl-v4-batch'})['prompt_id']
        dl = time.monotonic() + 600
        while time.monotonic() < dl:
            time.sleep(3)
            rec = json.load(ureq.urlopen(ENGINE + '/history/' + pid, timeout=10)).get(pid)
            if not rec: continue
            assert rec['status']['status_str'] == 'success', str(rec['status'])[:200]
            ims = [i for o in rec['outputs'].values() for i in o.get('images', [])]
            im = next((i for i in ims if i['filename'].startswith('MYStudio-2K')), ims[-1])
            c = ureq.urlopen(ENGINE + '/view?' + urlencode({'filename': im['filename'], 'subfolder': im.get('subfolder', ''), 'type': im.get('type', 'output')}), timeout=120).read()
            out.write_bytes(c); done += 1
            log(f"[ok] {out.name} {len(c)//1024}KB"); break
        try: post('/free', {'unload_models': True, 'free_memory': True})
        except Exception: pass
    except Exception as e:
        fail += 1; log(f"[FAIL] {out.name}: {str(e)[:180]}")
log(f"[v4 终] ok={done} fail={fail} skip={skip}")
