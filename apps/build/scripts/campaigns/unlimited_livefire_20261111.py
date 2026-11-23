#!/usr/bin/env python3
"""无限时长V6(循环拼接·无音频驱动)实弹 —— 1111 萝卜件嫁接我方模型(三件套之二)。

来源:8_吸收归档/340-H3无限时长V6-萝卜原件.json(与数字人V6同族,用户令补测)。
作者机制(帧级实证):
  段0整段 → easy forLoop(循环次数直给,无音频时长公式)→ 循环段:
    LoadLatent→MotionContext(**无TaperNoise,与数字人件不同**)→
    VAEDecode(视频)+VAEDecodeAudio(自产音轨)→MotionContextTrim(动态trim_frames
    ←MotionContext.trim_frames,视频音频同步剪桥)→帧落盘;AudioConcat 跨段接力音轨;
    RB_ImagesToVideo 帧目录装配。
  采样=lcm+6-NFE七值σ(两段同);无AudioLock/ref_audios(R2V 音频口全空=模型自产音)。
本脚本:循环API侧展开;音轨=AudioConcat链式+SaveAudio收口;视频=逐段SaveVideo(剪桥后)
本地concat+音轨mux;亮度漂移=逐段ffmpeg signalstats 定量(UP主自认病:每循环变暗)。
模型=我方在役件(同数字人役):Cobijada int8+pika_flex_ref2va_comfy@1.0+nvfp4 TE+同名VAE。
网格律=作者JS模语义(4s→90f;Python健全模会得107≠作者值,故按JS实现)。

用法:
  python3 unlimited_livefire_20261111.py --mode smoke [--submit no 干跑]
  python3 unlimited_livefire_20261111.py --mode full
输出: apps/output/1111-unlimited/<tag>/ + 亮度漂移表
"""
import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT_BASE = os.path.join(ROOT, 'apps', 'output', '1111-unlimited')

UNET = 'Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors'
LORA = 'pika_h3_flex_ref2va_comfy_bf16.safetensors'
CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'
VAE_VIDEO = 'minimax_h3_video_vae_int8_convrot.safetensors'
VAE_AUDIO = 'minimax_h3_audio_vae_fp32.safetensors'
SIGMAS = '1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0'
SAMPLER = 'lcm'                       # 他件 [342]/[354] 原值(数字人件是 euler_ancestral)
FPS = 24
BRIDGE = 22
SEED_BASE = 20261113
REF_IMAGE = 'daojie_A_1108.png'

MODES = {
    'smoke': dict(w=544, h=960, seg=4, loops=2, timeout=2400),   # 3段90f,交付226f≈9.4s
    'full':  dict(w=768, h=1344, seg=8, loops=2, timeout=7200),  # 3段192f,交付532f≈22.2s
}

APPEAR = (
    "<Subject 1>: a young female Chinese cultivator drawn in a detailed 2D anime style, "
    "appearance fully referenced by <Picture 1> - identity, face, hairstyle and outfit taken "
    "entirely from the reference image and never changing: long dark-brown hair half tied up "
    "with a jade-and-gold hairpin and teal ribbon, teal drop earrings, a teal cross-collared "
    "embroidered outer robe over a white inner garment and long white skirt, a sword with a "
    "teal scabbard carried on her back. She is the only performer; one person only. Her one "
    "and only sword stays inside its closed teal scabbard for the entire performance; her "
    "hands are empty during the dance."
)
SCENE = (
    "<Subject 3> (all shots): the same stone platform above a sea of clouds at sunset, "
    "warm golden-orange sky and distant teal mountains exactly as in <Picture 1>, unchanged "
    "in every segment. The platform itself is bare and empty - she is the only object on it, "
    "and nothing else stands, leans, floats or appears anywhere in the frame in any segment."
)
CONTINUITY = (
    "Continuity: the first 22 frames (00:00.000-00:00.917 at 24 fps) exactly reproduce the "
    "previous segment's final 22 frames, matching pose, hand position, hair flow, lighting "
    "and camera motion with no cut or pause."
)
NO_TEXT = ("The image is a clean anime frame, no overlaid text or captions; diegetic only: "
           "wind, fabric and distant air.")


def seg_prompt(i: int, n: int, seconds: float) -> str:
    parts = [APPEAR, SCENE]
    if i == 0:
        parts.append(
            f"Segment 0 of {n}, {seconds:.1f} seconds, opening: she draws a slow opening arc "
            "of a sword dance - unsheathing is not required; she lifts her arms in a flowing "
            "warm-up gesture, ribbon and hair drifting in the wind, a calm focused expression. "
            "Slow dolly-in from medium shot.")
        parts.append("Handoff out: mid-motion, arms raised, weight shifting right.")
    else:
        parts.append(
            f"Segment {i} of {n}, {seconds:.1f} seconds, continuing the same continuous sword "
            "dance: flowing circular arm paths and a slow turn, skirt and sleeves trailing, "
            "the motion flows directly from the previous segment's final pose, never freezing.")
        parts.append(CONTINUITY)
        parts.append("Handoff out: mid-gesture, one arm extended, camera at ease.")
    parts.append("Smooth camera only (slow dolly, slight arc), no whip pan, no zoom snap. " + NO_TEXT)
    return "\n".join(parts)


def js_mod(a: int, b: int) -> int:
    """JS 截断模(作者 ComfyMath 语义);Python % 是欧几里得模,负数域两语义分叉。"""
    return int(math.fmod(a, b))


def grid_js(n: int) -> int:
    """作者公式逐字:max(5,round(n)) + js_mod(5 - js_mod(max(5,round(n)),17), 17)。"""
    m = max(5, n)
    return m + js_mod(5 - js_mod(m, 17), 17)


def plan_segments(seg_sec: int, loops: int):
    full = grid_js(seg_sec * FPS)
    lens = [full] * (1 + loops)
    delivered = full + loops * (full - BRIDGE)
    segs = [dict(idx=i, length=l) for i, l in enumerate(lens)]
    return segs, delivered


# ── 引擎 HTTP(同数字人役:无代理 opener) ─────────────────────────────────────
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_json(engine, path, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(engine + path, data=data,
                                 headers={'Content-Type': 'application/json'})
    with _OPENER.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def upload_file(engine, path):
    import mimetypes
    name = os.path.basename(path)
    with open(path, 'rb') as f:
        body = f.read()
    boundary = '----dh1111' + uuid.uuid4().hex
    part = (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; '
            f'filename="{name}"\r\nContent-Type: '
            f'{mimetypes.guess_type(name)[0] or "application/octet-stream"}\r\n\r\n').encode()
    tail = f'\r\n--{boundary}\r\nContent-Disposition: form-data; name="overwrite"\r\n\r\ntrue\r\n--{boundary}--\r\n'.encode()
    req = urllib.request.Request(engine + '/upload/image', data=part + body + tail,
                                 headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
    with _OPENER.open(req, timeout=120) as r:
        return json.loads(r.read().decode())


def build_prompt(cfg, segs, prompts):
    p = {}
    p['load_image'] = {'class_type': 'LoadImage', 'inputs': {'image': REF_IMAGE}}
    p['unet'] = {'class_type': 'UNETLoader', 'inputs': {'unet_name': UNET, 'weight_dtype': 'default'}}
    p['lora'] = {'class_type': 'LoraLoaderModelOnly',
                 'inputs': {'model': ['unet', 0], 'lora_name': LORA, 'strength_model': 1.0}}
    p['clip'] = {'class_type': 'CLIPLoader',
                 'inputs': {'clip_name': CLIP, 'type': 'minimax', 'device': 'default'}}
    p['vae_v'] = {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE_VIDEO}}
    p['vae_a'] = {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE_AUDIO}}
    p['ksel'] = {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': SAMPLER}}
    p['sigmas'] = {'class_type': 'ManualSigmas', 'inputs': {'sigmas': SIGMAS}}

    audio_prev = None
    for s in segs:
        i, ln = s['idx'], s['length']
        t = f'{i:02d}'
        r2v = {'class_type': 'MiniMaxH3ReferenceToVideo',
               'inputs': {'clip': ['clip', 0], 'prompt': prompts[i], 'width': cfg['w'],
                          'height': cfg['h'], 'length': ln, 'ref_image_size': 'match',
                          'vae': ['vae_v', 0], 'audio_vae': ['vae_a', 0],
                          'ref_images.ref_image_0': ['load_image', 0]}}
        p[f'r2v{t}'] = r2v
        cond, latent = [f'r2v{t}', 0], [f'r2v{t}', 1]
        if i > 0:
            prev = f'{i-1:02d}'
            p[f'loadl{t}'] = {'class_type': 'MiniMaxH3MotionContextLoadLatent',
                              'inputs': {'latent_path': [f'sl{prev}', 0], 'clip_index': i,
                                         'stock_format': False, 'folder': 'output'}}
            # 作者件:LoadLatent 直进 MotionContext,无 TaperNoise(数字人件才有)
            p[f'mctx{t}'] = {'class_type': 'MiniMaxH3MotionContext',
                             'inputs': {'conditioning': [f'r2v{t}', 0], 'vae': ['vae_v', 0],
                                        'latent': [f'r2v{t}', 1], 'context_length': str(BRIDGE),
                                        'audio_context_length': 0,
                                        'context_latent': [f'loadl{t}', 0]}}
            cond = [f'mctx{t}', 0]
        p[f'guide{t}'] = {'class_type': 'BasicGuider',
                          'inputs': {'model': ['lora', 0], 'conditioning': cond}}
        p[f'noise{t}'] = {'class_type': 'RandomNoise', 'inputs': {'noise_seed': SEED_BASE + i}}
        p[f'samp{t}'] = {'class_type': 'SamplerCustomAdvanced',
                         'inputs': {'noise': [f'noise{t}', 0], 'guider': [f'guide{t}', 0],
                                    'sampler': ['ksel', 0], 'sigmas': ['sigmas', 0],
                                    'latent_image': latent}}
        p[f'sl{t}'] = {'class_type': 'MiniMaxH3MotionContextSaveLatent',
                       'inputs': {'latent': [f'samp{t}', 0], 'filename_prefix': f'dh1111u/seg{i}',
                                  'clip_index': i}}
        p[f'dec{t}'] = {'class_type': 'VAEDecode',
                        'inputs': {'samples': [f'samp{t}', 0], 'vae': ['vae_v', 0]}}
        p[f'deca{t}'] = {'class_type': 'VAEDecodeAudio',
                         'inputs': {'samples': [f'samp{t}', 0], 'vae': ['vae_a', 0]}}
        frames, seg_audio = [f'dec{t}', 0], [f'deca{t}', 0]
        if i > 0:
            p[f'trim{t}'] = {'class_type': 'MiniMaxH3MotionContextTrim',
                             'inputs': {'images': [f'dec{t}', 0], 'audio': [f'deca{t}', 0],
                                        'trim_frames': [f'mctx{t}', 1]}}
            frames, seg_audio = [f'trim{t}', 0], [f'trim{t}', 1]
        p[f'cv{t}'] = {'class_type': 'CreateVideo',
                       'inputs': {'images': frames, 'fps': FPS, 'color_space': 'sRGB',
                                  'chroma_subsampling': 'auto', 'bit_depth': 'auto'}}
        p[f'sv{t}'] = {'class_type': 'SaveVideo',
                       'inputs': {'video': [f'cv{t}', 0], 'filename_prefix': f'dh1111u/{TAG}/seg{i}',
                                  'format': 'auto', 'codec': 'auto'}}
        # 音轨跨段接力(作者 AudioConcat 链式)
        if audio_prev is None:
            audio_prev = seg_audio
        else:
            p[f'acat{t}'] = {'class_type': 'AudioConcat',
                             'inputs': {'audio1': audio_prev, 'audio2': seg_audio, 'direction': 'after'}}
            audio_prev = [f'acat{t}', 0]
    p['save_audio'] = {'class_type': 'SaveAudio',
                       'inputs': {'audio': audio_prev, 'filename_prefix': f'dh1111u/{TAG}/track'}}
    return p


def validate(engine, prompt):
    oi = http_json(engine, '/object_info', timeout=90)
    bad = []
    for nid, nd in prompt.items():
        ct = nd['class_type']
        if ct not in oi:
            bad.append(f'{nid}: class {ct} 不在册'); continue
        spec = oi[ct]['input']
        allowed = set(spec.get('required', {})) | set(spec.get('optional', {}))
        for k, v in nd['inputs'].items():
            ok = k in allowed or ('.' in k and k.split('.')[0] in allowed)
            if not ok:
                bad.append(f'{nid}({ct}): input {k} 不存在')
    if bad:
        print('VALIDATE FAIL:')
        for b in bad: print('  -', b)
        sys.exit(3)
    print(f'validate ✓ ({len(prompt)} 节点)')


def run(engine, prompt, timeout_s, resume_pid=None):
    if resume_pid:
        pid = resume_pid
    else:
        r = http_json(engine, '/prompt', {'prompt': prompt, 'client_id': str(uuid.uuid4())})
        if r.get('node_errors'):
            print('NODE ERRORS:', json.dumps(r['node_errors'], ensure_ascii=False)[:2000]); sys.exit(1)
        pid = r['prompt_id']
    print('QUEUED', pid)
    t0 = time.time(); last_beat = 0
    while True:
        if time.time() - t0 > timeout_s:
            print(f'TIMEOUT {timeout_s}s'); sys.exit(2)
        try:
            h = http_json(engine, f'/history/{pid}', timeout=60)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print('poll err(重试):', type(e).__name__); time.sleep(15); continue
        rec = h.get(pid)
        if rec:
            st = rec.get('status', {})
            if st.get('status_str') == 'error':
                for m in st.get('messages', []):
                    if m[0] == 'execution_error':
                        print('EXEC ERROR:', json.dumps(m[1], ensure_ascii=False)[:3000])
                sys.exit(1)
            if st.get('completed'):
                print(f'DONE in {time.time()-t0:.0f}s'); return rec
        if time.time() - last_beat > 60:
            last_beat = time.time()
            try:
                q = http_json(engine, '/queue', timeout=15)
                print(f'  [{int(time.time()-t0)}s] running={len(q["queue_running"])} pending={len(q["queue_pending"])}')
            except Exception: pass
        time.sleep(10)


def fetch_outputs(engine, rec, tag_dir):
    import urllib.parse
    outs = []
    for nid, out in sorted(rec.get('outputs', {}).items()):
        for key in ('videos', 'gifs', 'audio', 'images'):
            for item in out.get(key, []) or []:
                fn, sub = item['filename'], item.get('subfolder', '')
                dest = os.path.join(tag_dir, f'dl_{nid}_{fn}')
                url = (f'{engine}/view?filename={urllib.parse.quote(fn)}'
                       f'&subfolder={urllib.parse.quote(sub)}&type={item.get("type", "output")}')
                with _OPENER.open(url, timeout=300) as r, open(dest, 'wb') as f:
                    f.write(r.read())
                print('  fetched', dest, os.path.getsize(dest), 'B')
                outs.append(dest)
    return outs


def seg_luma(path):
    """ffmpeg signalstats:整段平均亮度 YAVG(亮度漂移定量)。"""
    r = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-vf', 'signalstats,metadata=print',
                        '-f', 'null', '-'], capture_output=True, text=True)
    ys = [float(l.split('YAVG=')[1]) for l in r.stderr.splitlines() if 'YAVG=' in l]
    return sum(ys) / len(ys) if ys else float('nan')


def main():
    global TAG
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://192.168.0.101:17000')
    ap.add_argument('--mode', choices=list(MODES), required=True)
    ap.add_argument('--submit', choices=['yes', 'no'], default='yes')
    ap.add_argument('--resume', default=None)
    ap.add_argument('--out-dir', default=None)
    a = ap.parse_args()
    cfg = dict(MODES[a.mode]); TAG = a.mode
    global OUT_BASE
    if a.out_dir: OUT_BASE = a.out_dir

    segs, delivered = plan_segments(cfg['seg'], cfg['loops'])
    prompts = [seg_prompt(s['idx'], len(segs), s['length'] / FPS) for s in segs]
    print(f"[{a.mode}] {cfg['w']}x{cfg['h']} seg={cfg['seg']}s loops={cfg['loops']} → {len(segs)} 段 "
          f"长度={[s['length'] for s in segs]} 交付 {delivered}f={delivered/FPS:.2f}s")

    tag_dir = os.path.join(OUT_BASE, TAG); os.makedirs(tag_dir, exist_ok=True)
    q = http_json(a.engine, '/queue')
    if q['queue_running'] or q['queue_pending']:
        print(f"WARN: 队列非空 running={len(q['queue_running'])} pending={len(q['queue_pending'])} (FIFO)")

    prompt = build_prompt(cfg, segs, prompts)
    validate(a.engine, prompt)
    with open(os.path.join(tag_dir, 'api_prompt.json'), 'w') as f:
        json.dump(prompt, f, ensure_ascii=False, indent=1)
    with open(os.path.join(tag_dir, 'plan.json'), 'w') as f:
        json.dump(dict(mode=a.mode, segs=segs, delivered=delivered, sampler=SAMPLER,
                       sigmas=SIGMAS, models=dict(unet=UNET, lora=LORA, clip=CLIP)), f,
                  ensure_ascii=False, indent=1)
    if a.submit == 'no':
        print('dry-run 止步'); return
    rec = run(a.engine, prompt, cfg['timeout'], resume_pid=a.resume or None)
    files = fetch_outputs(a.engine, rec, tag_dir)
    vids = sorted(f for f in files if f.endswith('.mp4'))
    wavs = [f for f in files if f.endswith(('.wav', '.flac', '.mp3'))]
    if not vids:
        print('无视频产物!'); sys.exit(1)

    # 装配(本机 ffmpeg)
    lst = os.path.join(tag_dir, 'concat.txt')
    with open(lst, 'w') as f:
        for v in vids: f.write(f"file '{v}'\n")
    concat = os.path.join(tag_dir, 'concat.mp4'); final = os.path.join(tag_dir, 'final.mp4')
    r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-c', 'copy', concat], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(concat):
        print('concat copy 失败→重编码:', r.stderr[:200])
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                        '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', concat], check=True)
    mux_cmd = ['ffmpeg', '-y', '-v', 'error', '-i', concat, '-t', f'{delivered/FPS:.3f}',
               '-map', '0:v:0', '-c:v', 'copy', '-an', final]
    if wavs:
        mux_cmd = ['ffmpeg', '-y', '-v', 'error', '-i', concat, '-i', wavs[0],
                   '-t', f'{delivered/FPS:.3f}', '-map', '0:v:0', '-map', '1:a:0',
                   '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', final]
    subprocess.run(mux_cmd, check=True)
    print('FINAL:', final)

    # 亮度漂移定量(UP主自认病:每循环变暗)
    lumas = {}
    for v in vids:
        segname = os.path.basename(v).split('_')[1] if '_' in os.path.basename(v) else v
        lumas[os.path.basename(v)] = round(seg_luma(v), 2)
    print('段亮度 YAVG:', json.dumps(lumas, ensure_ascii=False))
    vals = list(lumas.values())
    if len(vals) >= 2 and vals[0] == vals[0]:
        print(f'亮度漂移: seg0→末段 {vals[-1]-vals[0]:+.2f} ({(vals[-1]-vals[0])/vals[0]*100:+.1f}%)')
    with open(os.path.join(tag_dir, 'run_record.json'), 'w') as f:
        json.dump(dict(segs=segs, delivered=delivered, files=files, final=final,
                       seg_luma=lumas), f, ensure_ascii=False, indent=1)
    print('RECORD →', os.path.join(tag_dir, 'run_record.json'))


if __name__ == '__main__':
    main()
