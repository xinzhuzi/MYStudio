# -*- coding: utf-8 -*-
"""档位 A/B 事后回收:从引擎 history 救回全部 MY 发(含脚本侧超时但引擎侧跑完的)。

产出 trial_档位AB_手剑_1026/manifest_recovered.json + 缺图补齐 *_seed*.png;
引擎侧净时长 = execution_start→execution_success(毫秒差),免疫外来任务排队污染。
判定 MY 发:graph 含 MyQi21SpeedSelect;档位/seed 读 7:7015/7:7014。
"""
from __future__ import annotations

import json
import sys
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'apps/build/scripts'))
import comfy_fire_core as fc  # noqa: E402

ENGINE = 'http://127.0.0.1:17001'
OUT = REPO / 'apps/output/trial_档位AB_手剑_1026'
TAG = {'0 · Turbo 8步': 'T', '1 · 原生出图': 'N', '3 · 混动 40步+缓存': 'E'}
SEEDS = {424242, 20261026, 778899, 111111}


def main():
    tr = fc.UrllibTransport(ENGINE)
    hist = tr.get_json('/history', timeout=30)
    rows = []
    for pid, r in hist.items():
        pr = r.get('prompt')
        g = pr[2] if pr and len(pr) > 2 else {}
        if 'MyQi21SpeedSelect' not in json.dumps(g):
            continue
        mode = g.get('7:7015', {}).get('inputs', {}).get('mode', '?')
        seed = g.get('7:7014', {}).get('inputs', {}).get('value', '?')
        st = r.get('status', {})
        msgs = [m for m in st.get('messages', []) if isinstance(m, list)
                and m[0].startswith('execution_') and isinstance(m[1], dict)]
        t0 = min((m[1]['timestamp'] for m in msgs if m[0] == 'execution_start'), default=None)
        t1 = max((m[1]['timestamp'] for m in msgs
                  if m[0] in ('execution_success', 'execution_error')), default=None)
        dur = round((t1 - t0) / 1000, 1) if t0 and t1 else None
        imgs = [i for o in r.get('outputs', {}).values() for i in o.get('images', [])]
        fn = imgs[0]['filename'] if imgs else None
        # 补齐盘上缺的对比图(校准发 111111 只存 calib 名, 不覆盖)
        tag = TAG.get(mode)
        if tag and seed in SEEDS and fn:
            want = OUT / f'{tag}_seed{seed}.png'
            if not want.exists() and st.get('status_str') == 'success':
                b = tr.fetch_bytes('/view?' + urlencode(
                    {'filename': fn, 'subfolder': imgs[0].get('subfolder', ''),
                     'type': imgs[0].get('type', 'output')}))
                want.write_bytes(b)
        rows.append({'pid': pid, 'mode': mode, 'seed': seed, 'engine_s': dur,
                     'status': st.get('status_str'), 'image': fn})
    rows.sort(key=lambda x: x['seed'] if isinstance(x['seed'], int) else 0)
    (OUT / 'manifest_recovered.json').write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    for r in rows:
        print(f"{r['seed']:<9} {r['mode']:<14} {str(r['engine_s']):>6}s {r['status']:<8} {r['image']}")


if __name__ == '__main__':
    main()
