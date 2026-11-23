# -*- coding: utf-8 -*-
"""档位 A/B 续跑:补主脚本闸门 break 跳过的五发(E_424242 + 20261026/778899 的 N/E)。

主脚本 900s 死线在外来任务占机时反复超时→队列闸 break→跳档;本脚本:
  - 长死线 MYSTUDIO_FIRE_DEADLINE_S=3600(免疫外来排队);
  - 复用主脚本的 build/fire(冻结终稿口径一致);
  - 跳过盘上已有 png 的组合;产物 manifest_resume.json。
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
os.environ['MYSTUDIO_FIRE_DEADLINE_S'] = '3600'  # 须在 import fc 前?否:await_output 调用时读

import gear_ab_hand_sword_1026 as main_mod  # noqa: E402
import comfy_fire_core as fc  # noqa: E402

OUT = main_mod.OUT_DIR
MODE_OF = {'T': '0 · Turbo 8步', 'N': '1 · 原生出图', 'E': '3 · 混动 40步+缓存'}
COMBOS = [('N', 20261026), ('E', 20261026), ('T', 778899), ('N', 778899), ('E', 778899)]


def main():
    from PIL import Image
    import io as _io
    calib = OUT / 'calib_T_seed111111.png'
    w, h = Image.open(calib).size
    frozen = (main_mod.OUT_DIR.joinpath('frozen_final_prompt.txt').read_text(), w, h)
    tr = fc.UrllibTransport(main_mod.ENGINE)
    assert fc.engine_alive(tr), '引擎未响应'
    log = main_mod.log
    manifest = []
    for tag, seed in COMBOS:
        name = f'{tag}_seed{seed}.png'
        if (OUT / name).exists():
            log(f'跳过(已有) {name}')
            continue
        log(f'→ 续跑 {MODE_OF[tag]} seed={seed}')
        try:
            pid, img, secs, _u, stats = main_mod.fire(
                tr, main_mod.build(MODE_OF[tag], seed, frozen), name)
            (OUT / name).write_bytes(img)
            manifest.append({'tag': tag, 'seed': seed, 'secs': round(secs, 1),
                             'pid': pid, **stats})
            log(f'  完成 {secs:.0f}s {stats.get("kb")}KB')
        except Exception as exc:
            manifest.append({'tag': tag, 'seed': seed, 'error': str(exc)[:300]})
            log(f'  失败: {str(exc)[:200]}')
        time.sleep(5)
    (OUT / 'manifest_resume.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    log('续跑完毕')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
