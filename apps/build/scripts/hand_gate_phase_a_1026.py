# -*- coding: utf-8 -*-
"""修手 pass Phase A·手部检测门禁标定(10-26-hand-fix-pass Phase A)。

门禁设计(mediapipe 局限如实记:21 点模型数不了六指,只做定位/裁切):
  ① mediapipe Hands 定位+裁切手部区域(全分辨率,含余量)
  ② 手部裁片喂本地 VL(LM Studio 27B)逐指数——高分辨率裁片判读远准于全身缩略
  ③ 门禁判定:每只可见手 指数==5 且无畸形措辞 → PASS
语料=trial_档位AB_手剑_1026 全部判读过的图,对拍此前人工判定(标定)。
运行:引擎 venv python(mediapipe 在引擎 venv)。
"""
import base64
import glob
import io
import json
import os
import time
import urllib.request

from PIL import Image
from ultralytics import YOLO

MODEL = ('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/models/'
         'ultralytics/bbox/hand_yolov8n.pt')

OUT = '/Users/zhengbingjin/Project/Github/MYStudio/apps/output/trial_档位AB_手剑_1026'
CROP_DIR = os.path.join(OUT, 'hand_crops')
os.makedirs(CROP_DIR, exist_ok=True)
# 本会话已人工判读的地面真值(图名→(手判读摘要, 总判定 pass/collapse))
GROUND = {
    'T_seed424242.png': '左4融合+右4穿模', 'N_seed424242.png': '双手净',
    'E_seed424242.png': '袖遮左+右搭鞘净', 'T_seed20261026.png': '双5指净',
    'N_seed20261026.png': '双5指净', 'E_seed20261026.png': '右4缺一+护手穿模',
    'T_seed778899.png': '4-5模糊', 'N_seed778899.png': '右短粗3-4+未搭鞘',
    'E_seed778899.png': '4-5轮廓模糊结构对',
    'probe_美宣_E档.png': '双手糊团+鞘穿模', 'probe_美宣_原生档.png': '左3融合+右块状',
    'probe_美宣_Turbo档.png': '肉块手+穿模', 'rate_美宣_E_424242.png': '爪状+穿模',
    'probe_人物海报_横幅_全锚句_E.png': '左3-4糊+右鞘融合',
}


def vl_fingers(crop_path):
    im = Image.open(crop_path).convert('RGB')
    im.thumbnail((640, 640))
    buf = io.BytesIO(); im.save(buf, 'JPEG', quality=88)
    b64 = base64.b64encode(buf.getvalue()).decode()
    payload = {"model": "qwen3.8-27b-coder390", "messages": [{"role": "user", "content": [
        {"type": "text", "text": "这是人物手部的特写裁片。回答两行,不要多余文字:\n1)手指数量:一个数字(5/4/6/模糊)\n2)畸形:无/轻/重(融合·多指·糊团·穿模选最贴近的,无则写无)"},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}]}],
        "max_tokens": 80, "temperature": 0.0}
    r = urllib.request.Request('http://127.0.0.1:1234/v1/chat/completions',
                               data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    for _ in range(3):
        try:
            c = json.load(urllib.request.urlopen(r, timeout=120))['choices'][0]['message']['content']
            if c and c.strip():
                return c.strip()
        except Exception:
            time.sleep(6)
    return '(VL空)'


def main():
    det = YOLO(MODEL)
    rows = []
    for name, truth in sorted(GROUND.items()):
        p = os.path.join(OUT, name)
        if not os.path.exists(p):
            continue
        im = Image.open(p).convert('RGB')
        W, H = im.size
        yres = det(str(p), verbose=False, conf=0.25)[0]
        import numpy as _np
        mh = [_np.array(b.xyxy.cpu().tolist()[0]) for b in yres.boxes]
        entry = {'image': name, 'truth': truth, 'hands': []}
        for i, box in enumerate(mh):
            x0, x1 = max(0, int(box[0])-40), min(W, int(box[2])+40)
            y0, y1 = max(0, int(box[1])-40), min(H, int(box[3])+40)
            crop = os.path.join(CROP_DIR, f'{name[:-4]}_h{i}.jpg')
            im.crop((x0, y0, x1, y1)).save(crop, 'JPEG', quality=92)
            verdict = vl_fingers(crop)
            entry['hands'].append({'box': [x0, y0, x1, y1], 'vl': verdict.replace('\n', ' | ')})
        if not mh:
            entry['hands'].append({'vl': '(mediapipe未检出——藏袖/远景/糊团均可能,不作独立判据)'})
        rows.append(entry)
        print(f"{name}: truth={truth[:18]:<20} 检出{len(mh)}手 "
              + ' ; '.join(h['vl'][:60] for h in entry['hands']), flush=True)
    json.dump(rows, open(os.path.join(OUT, 'hand_gate_phase_a.json'), 'w'), ensure_ascii=False, indent=1)
    print('done ->', os.path.join(OUT, 'hand_gate_phase_a.json'))


if __name__ == '__main__':
    main()
