# -*- coding: utf-8 -*-
"""修手 pass Phase B·v0 demo:裁片→Q2.1 i2i 编辑重绘→羽化贴回→复检。

目标图=probe_美宣_原生档.png h1 手(裁片判读 指数0/糊团,铁证崩手);
重绘走 qwen21 i2i 路(道劫美术风格转换装配=指令+底座,画幅跟参考裁片);
贴回=box 外扩 40px 同位,边缘羽化 24px;复检=贴回区再裁片喂 VL。
"""
import base64
import io
import json
import os
import sys
import time

sys.path.insert(0, '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend')
os.environ['MYSTUDIO_COMFYUI_BRIDGE_URL'] = 'http://127.0.0.1:17001'

import urllib.request
from PIL import Image, ImageFilter

from engines.image_engine import qwen21

OUT = '/Users/zhengbingjin/Project/Github/MYStudio/apps/output/trial_档位AB_手剑_1026'
TARGET = 'probe_美宣_原生档.png'
HAND_IDX = 1  # h1 = 指数0/糊团
REPAIR_PROMPT = ('保持画面色调与构图位置不变,将这只手重绘为五指完整、指节清晰、自然放松的手部特写,'
                 '青玉色衣袖与肤色与原画面一致,工笔设色画风')


def vl(path, q):
    im = Image.open(path).convert('RGB'); im.thumbnail((640, 640))
    b = io.BytesIO(); im.save(b, 'JPEG', quality=88)
    payload = {'model': 'qwen3.8-27b-coder390', 'messages': [{'role': 'user', 'content': [
        {'type': 'text', 'text': q},
        {'type': 'image_url', 'image_url': {'url': 'data:image/jpeg;base64,' + base64.b64encode(b.getvalue()).decode()}}]}],
        'max_tokens': 300, 'reasoning_effort': 'none'}
    r = urllib.request.Request('http://127.0.0.1:1234/v1/chat/completions',
                               data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    for _ in range(3):
        try:
            c = json.load(urllib.request.urlopen(r, timeout=200))['choices'][0]['message']['content']
            if c and c.strip():
                return c.strip().replace('\n', ' ')[:120]
        except Exception:
            time.sleep(6)
    return '(空)'


def main():
    gate = json.load(open(os.path.join(OUT, 'hand_gate_phase_a.json')))
    entry = [e for e in gate if e['image'] == TARGET][0]
    box = entry['hands'][HAND_IDX]['box']
    x0, y0, x1, y1 = box
    src = Image.open(os.path.join(OUT, TARGET)).convert('RGB')
    w, h = x1 - x0, y1 - y0
    crop = src.crop((x0, y0, x1, y1))
    buf = io.BytesIO(); crop.save(buf, 'PNG')
    ref_b64 = base64.b64encode(buf.getvalue()).decode()
    print(f'box={box} crop={crop.size} 修复中(i2i 编辑路)...', flush=True)
    t0 = time.time()
    out_b64 = qwen21.generate(REPAIR_PROMPT, '1:1', None, 8, None, reference_b64=ref_b64)
    repaired = Image.open(io.BytesIO(base64.b64decode(out_b64))).convert('RGB')
    print(f'重绘完成 {time.time()-t0:.0f}s 出图 {repaired.size}', flush=True)
    repaired = repaired.resize((w, h), Image.LANCZOS)
    # 羽化贴回
    mask = Image.new('L', (w, h), 0)
    from PIL import ImageDraw
    ImageDraw.Draw(mask).rectangle([24, 24, w - 24, h - 24], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(12))
    canvas = src.copy()
    canvas.paste(repaired, (x0, y0), mask)
    fixed = os.path.join(OUT, 'phaseB_fixed_' + TARGET)
    canvas.save(fixed)
    fixed_crop = os.path.join(OUT, 'hand_crops', f'phaseB_fixed_{TARGET[:-4]}_h{HAND_IDX}.jpg')
    canvas.crop((x0, y0, x1, y1)).save(fixed_crop, 'JPEG', quality=92)
    verdict = vl(fixed_crop, '数这只手的手指数量,一个词判畸形(无/融合/多指/糊团/穿模)。格式:指数=数字,畸形=词')
    print(f'贴回完成 → {fixed}', flush=True)
    print(f'复检(贴回区裁片): {verdict}', flush=True)


if __name__ == '__main__':
    main()
