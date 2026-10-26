# -*- coding: utf-8 -*-
"""修手 pass 工程化 v1:全图多手「检测→判读→修复→贴回→复检」批管线。

= Phase A(YOLO 定位+VL 判读)+ Phase B(i2i 重绘+羽化贴回)整合,增量:
  ① 全图所有手循环处理(v0 只单手)
  ② 重掷纪律:单手修复复检不过→换 seed 重修一次(两掷即止)
  ③ 台账 manifest(每手:框/判读/修复轮次/复检)
剑直校正(Hough)不在本件:国风线描上直线检测不可靠,候专项。

用法:引擎 venv python hand_fix_pipeline_1026.py <图路径>
产物:同目录 <名>_handfixed.png + hand_fix_manifest.json(追加)
"""
import base64
import io
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, '/Users/zhengbingjin/Project/Github/MYStudio/apps/backend')
os.environ.setdefault('MYSTUDIO_COMFYUI_BRIDGE_URL', 'http://127.0.0.1:17001')

from PIL import Image, ImageDraw, ImageFilter
from ultralytics import YOLO

MODEL = ('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/models/'
         'ultralytics/bbox/hand_yolov8n.pt')
OUT_DIR = '/Users/zhengbingjin/Project/Github/MYStudio/apps/output/trial_档位AB_手剑_1026'
BAD_WORDS = ('融合', '多指', '糊团', '穿模')
REPAIR_TPL = ('保持画面色调与构图位置不变,将这只手重绘为五指完整、指节清晰、自然放松的手部特写,'
              '{ctx}肤色与原画面一致,工笔设色画风')
CTX_BY_IMAGE = {'美宣': '青玉色衣袖与', '人物海报': '', '': ''}


def vl(path, q):
    im = Image.open(path).convert('RGB')
    im.thumbnail((640, 640))
    b = io.BytesIO()
    im.save(b, 'JPEG', quality=88)
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
                return c.strip().replace('\n', ' ')
        except Exception:
            time.sleep(6)
    return ''


def judge(crop_path):
    txt = vl(crop_path, '数这张手部特写的手指数量,一个词判畸形(无/融合/多指/糊团/穿模)。格式:指数=数字,畸形=词')
    bad = any(w in txt for w in BAD_WORDS) or '指数=0' in txt or '指数=6' in txt
    return txt, bad


def repair_once(crop, ctx, seed):
    from engines.image_engine import qwen21
    buf = io.BytesIO()
    crop.save(buf, 'PNG')
    out = qwen21.generate(REPAIR_TPL.format(ctx=ctx), '1:1', None, 8, seed,
                          reference_b64=base64.b64encode(buf.getvalue()).decode())
    return Image.open(io.BytesIO(base64.b64decode(out))).convert('RGB')


def paste_back(canvas, repaired, box):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    rep = repaired.resize((w, h), Image.LANCZOS)
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rectangle([24, 24, w - 24, h - 24], fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(12))
    canvas.paste(rep, (x0, y0), mask)


def main(img_path):
    from engines.image_engine import qwen21  # noqa: F401 环境预热(import 期即校桥)
    name = os.path.basename(img_path)
    det = YOLO(MODEL)
    src = Image.open(img_path).convert('RGB')
    W, H = src.size
    yres = det(str(img_path), verbose=False, conf=0.25)[0]
    boxes = [[max(0, int(b[0]) - 40), max(0, int(b[1]) - 40),
              min(W, int(b[2]) + 40), min(H, int(b[3]) + 40)] for b in yres.boxes.xyxy.cpu().tolist()]
    print(f'{name}: 检出 {len(boxes)} 手', flush=True)
    ctx = next((v for k, v in CTX_BY_IMAGE.items() if k and k in name), '')
    canvas = src.copy()
    ledger = {'image': name, 'hands': []}
    for i, box in enumerate(boxes):
        crop_p = os.path.join(OUT_DIR, 'hand_crops', f'fixv1_{name[:-4]}_h{i}.jpg')
        canvas.crop(box).save(crop_p, 'JPEG', quality=92)
        txt, bad = judge(crop_p)
        entry = {'box': box, 'judge': txt, 'repaired': False}
        print(f'  h{i} 判读: {txt[:50]} → {"修" if bad else "过"}', flush=True)
        if not bad:
            ledger['hands'].append(entry)
            continue
        for attempt, seed in enumerate((424242 + i, 964242 + i), 1):  # 两掷即止
            try:
                rep = repair_once(canvas.crop(box), ctx, seed)
            except Exception as exc:
                entry['error'] = str(exc)[:120]
                print(f'  h{i} 修复异常: {entry["error"]}', flush=True)
                break
            paste_back(canvas, rep, box)
            vp = os.path.join(OUT_DIR, 'hand_crops', f'fixv1_{name[:-4]}_h{i}_v{attempt}.jpg')
            canvas.crop(box).save(vp, 'JPEG', quality=92)
            vt, vbad = judge(vp)
            print(f'  h{i} 第{attempt}掷 复检: {vt[:50]}', flush=True)
            if not vbad:
                entry.update(repaired=True, attempts=attempt, verify=vt)
                break
            if attempt == 2:
                entry.update(repaired=False, verify=vt)
        ledger['hands'].append(entry)
    fixed = os.path.join(OUT_DIR, f'{name[:-4]}_handfixed.png')
    canvas.save(fixed)
    mf = os.path.join(OUT_DIR, 'hand_fix_manifest.json')
    rows = json.load(open(mf)) if os.path.exists(mf) else []
    rows.append(ledger)
    json.dump(rows, open(mf, 'w'), ensure_ascii=False, indent=1)
    ok = sum(1 for h in ledger['hands'] if h.get('repaired') or not any(w in h['judge'] for w in BAD_WORDS))
    print(f'完成: {len(ledger["hands"])}手 处置后干净{ok} → {fixed}', flush=True)


if __name__ == '__main__':
    main(sys.argv[1])
