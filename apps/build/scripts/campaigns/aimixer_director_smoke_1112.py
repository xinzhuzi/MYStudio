#!/usr/bin/env python3
"""AIMixer MiniMaxH3Director 烟测(1112 用户令「安装配置并且进行测试」)。

现状:插件已在 Win 生产引擎(17000)注册并纳册(engine-sync.json,1111 实检役),
依赖三件在(scenedetect 0.7.2/imageio-ffmpeg 0.6.0/opencv-headless 4.14),零重装。

本件=单变量烟测:作者官方 t2v 示例(example_workflows/minimax_h3_director_t2v.json)
逐字原配(widgets 21 项含 timeline_data 计划 JSON 全文照搬),唯一换装=
  UNETLoader fl2va_pruned_int8 → Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot
  (数字人役实弹三件套同源:TE 同名零改/VAE video 换我方 int8_convrot 版/audio 同名)。
864×480×124f 单段(gen_blank 全局模式,官方单 pass 多镜头协议),res_multistep 25 步
+σshift[12,3] 作者原配,seed 42。验证:①Cobijada 在 Director 内部官方管线可用
②AV 双流产出 ③产物逐项 ffprobe 对表。

无代理 opener(引擎直连,同数字人役);产物落 apps/output/aimixer-smoke-1112/。
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

ENGINE = os.environ.get('AIMIXER_ENGINE', 'http://192.168.0.101:17000')
CLIENT = 'aimixer-smoke-1112'
OUT_DIR = Path(__file__).resolve().parents[2] / 'output' / 'aimixer-smoke-1112'
PROMPT_ID_FILE = OUT_DIR / 'prompt_id.txt'
TIMEOUT_S = 540          # 观察器自杀线(引擎侧作业不死,可补收)
POLL_S = 5

# ── 作者示例逐字原配(除注明的三处换装)──────────────────────────────
UNET = 'Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors'  # 换装①
TE = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'                                   # 同名零改
VAE_VIDEO = 'minimax_h3_video_vae_int8_convrot.safetensors'                           # 换装②(fp16→int8_convrot)
VAE_AUDIO = 'minimax_h3_audio_vae_fp32.safetensors'                                   # 同名零改

GLOBAL_PROMPT = (
    "Realistic live-action cinematic look: a post-rain dusk metropolis, anamorphic lens, "
    "shallow depth of field, film grain, city volumetric fog, flying-car traffic between towers.\n\n"
    "Storyboard:\n[0s-2s] High side angle: protagonist sprinting at a roof edge, wind catching their coat.\n"
    "[2s-3.5s] Leap across the gap between buildings, body stretching mid-air.\n"
    "[3.5s-5s] Landing and roll, low-angle shot, keep running into fog.\n\n"
    "Audio: wind, rapid footsteps, city ambience, low score with accent hits on each leap.\n"
    "No text, logos or watermarks."
)
TIMELINE_DATA = json.dumps({
    "version": 4, "editMode": "global", "timelineMode": "gen_blank",
    "totalFrames": 124, "frameRate": 24.0, "width": 864, "height": 480, "refMaxSize": 864,
    "output": {"mode": "fixed", "longEdge": 864, "width": 864, "height": 480,
               "maxExportFrames": 0, "exportMode": "all",
               "continuityEnabled": False, "continuityOverlapFrames": 9},
    "videoClips": [],
    "video": {"fileName": "", "videoFile": "", "subfolder": "", "type": "input",
              "frames": [], "frameMap": []},
    "global": {"taskType": "t2v — 文生视频(Text to Video)", "prompt": GLOBAL_PROMPT,
               "refs": [], "referenceVideo": {}, "continuousReference": False,
               "genImage": {"imageFile": ""}},
    "segments": [{"id": "s0", "start": 0, "length": 124, "frameCount": 124,
                  "durationSec": 5, "prompt": "", "taskType": "", "refs": [],
                  "referenceVideo": {}, "genImage": {"imageFile": ""},
                  "negativePrompt": ""}],
    "gen": {"defaultFrameCount": 124},
    "runSelectEnabled": False, "runSelection": [],
}, ensure_ascii=False)

# API 图:9 节点(示例的 11 节点去 3×PreviewAny+MarkdownNote;新增 0 号 Lora 不加=纯 Cobijada 单变量)
WF = {
    '1': {'class_type': 'UNETLoader',
          'inputs': {'unet_name': UNET, 'weight_dtype': 'default'}},
    '2': {'class_type': 'CLIPLoader',
          'inputs': {'clip_name': TE, 'type': 'minimax', 'device': 'default'}},
    '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE_VIDEO}},
    '4': {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE_AUDIO}},
    '5': {'class_type': 'MiniMaxH3Director', 'inputs': {
        'model': ['1', 0], 'video_vae': ['3', 0], 'audio_vae': ['4', 0], 'clip': ['2', 0],
        'task_type': 't2v — 文生视频(Text to Video)',
        'global_prompt': GLOBAL_PROMPT,
        'bd_grp_sample': '采样设置',
        'cfg': 1.0, 'seed': 42, 'frame_rate': 24.0,
        'width': 864, 'height': 480, 'ref_max_size': 864, 'total_frames': 124,
        'timeline_data': TIMELINE_DATA,
        'bd_grp_advanced': '高级采样',
        'steps': 25, 'sampler': 'res_multistep', 'scheduler': 'simple',
        'shift_video': 12.0, 'shift_audio': 3.0,
        'bd_grp_perf': '性能',
        'clear_vram_between_segments': True, 'clear_vram_before_refine': False,
    }},
    # 尾链=数字人役实弹同款 widget 值(键名按引擎活签名 object_info 核对)
    '6': {'class_type': 'CreateVideo',
          'inputs': {'images': ['5', 0], 'audio': ['5', 1], 'fps': ['5', 2],
                     'bit_depth': 8, 'color_space': 'sRGB',
                     'format': 'auto', 'codec': 'none'}},
    '7': {'class_type': 'SaveVideo',
          'inputs': {'video': ['6', 0], 'filename_prefix': 'video/aimixer_smoke_1112',
                     'format': 'auto'}},
}


def http(method, path, body=None, timeout=30):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))  # 无代理直连(同数字人役)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(ENGINE + path, data=data, method=method,
                                 headers={'Content-Type': 'application/json'})
    with opener.open(req, timeout=timeout) as r:
        return json.loads(r.read() or b'{}')


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    # 预检:队列空 + 节点在册
    q = http('GET', '/queue')
    assert not q['queue_running'] and not q['queue_pending'], f'队列非空,停发: {q}'
    oi = http('GET', '/object_info/MiniMaxH3Director')
    assert 'MiniMaxH3Director' in oi, '节点不在册'
    print(f'[pre] 队列空 + MiniMaxH3Director 在册')

    t0 = time.time()
    r = http('POST', '/prompt', {'prompt': WF, 'client_id': CLIENT})
    pid = r['prompt_id']
    PROMPT_ID_FILE.write_text(pid)
    (OUT_DIR / 'api_graph.json').write_text(json.dumps(WF, ensure_ascii=False, indent=1))
    print(f'[fire] prompt_id={pid}  864x480x124f 纯 Cobijada 25步(单变量烟测)')

    # 轮询 history(观察者自杀线 540s;超时引擎侧作业不死,重跑本件可凭 pid 补收)
    while time.time() - t0 < TIMEOUT_S:
        h = http('GET', f'/history/{pid}')
        if pid in h:
            rec = h[pid]
            (OUT_DIR / 'history.json').write_text(json.dumps(rec, ensure_ascii=False)[:200000])
            if rec.get('status', {}).get('completed') or '7' in rec.get('outputs', {}):
                vids = rec['outputs'].get('7', {}).get('images', [])   # SaveVideo 产物键=images(实弹勘正,非 gifs)
                assert vids, f"完成但无产物: {json.dumps(rec.get('status'))[:400]}"
                v = vids[0]
                print(f"[done] {time.time()-t0:.0f}s 产物={v['subfolder']}/{v['filename']} meta={v.get('metadata')}")
                url = (f"/view?filename={urllib.parse.quote(v['filename'])}"
                       f"&subfolder={urllib.parse.quote(v['subfolder'])}&type={v['type']}")
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                local = OUT_DIR / v['filename']
                with opener.open(ENGINE + url, timeout=120) as resp, open(local, 'wb') as f:
                    f.write(resp.read())
                print(f'[fetch] {local} ({local.stat().st_size/1e6:.2f} MB)')
                print('[verdict] SUCCESS——产物到手,候 ffprobe+vision 复核')
                return 0
            status = rec.get('status', {})
            if status.get('status_str') == 'error':
                print(f"[FAIL] 引擎报错: {json.dumps(status)[:600]}")
                return 1
        time.sleep(POLL_S)
        if int(time.time() - t0) % 60 < POLL_S:
            print(f'[wait] {int(time.time()-t0)}s…')
    print(f'[timeout] {TIMEOUT_S}s 观察器自杀(引擎侧作业在跑);补收: GET /history/{pid}')
    return 2


if __name__ == '__main__':
    import urllib.parse
    sys.exit(main())
