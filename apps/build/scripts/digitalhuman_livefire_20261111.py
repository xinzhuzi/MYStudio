#!/usr/bin/env python3
"""数字人(音频驱动口型)工作流实弹 —— 1111 萝卜「340-H3数字人V6」嫁接我方模型。

来源与嫁接口径(逐段嫁接,禁自创):
  原件: ~/Downloads/1111-pika-h3-digitalhuman/original/340-H3数字人V6.json(2026-11-11 夸克取件)
  作者机制: 段0整段生成 → forLoop 循环段(MotionContextSaveLatent→TaperNoise→MotionContext
    22帧桥) → ImageFromBatch 跳每段头22帧 → RB_ImagesToVideo 装配+原曲mux。
  本脚本: 循环在 API 侧展开(RB_Code/easy forLoop/RB_SaveImages 均为控制流,Python 等价实现);
    采样骨架/σ表/22帧桥/音频双通道(ref_audios+NativeAudioLock)逐节点保真。
  模型换我方在役件(2026-11-11 引擎 object_info 实锚):
    UNET=Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned(他=Singularity_ref2va_v2 int8)
    LoRA=pika_h3_flex_ref2va_comfy_bf16@1.0(他=pika_h3_flex_ref2va_v1_bf16@1,同系)
    TE=qwen3vl_32b_minimax_h3_nvfp4_awq(他=int8_convrot,同模不同量化) VAE 两件与他同名同件。
  σ=官方6-NFE七值逐字(与他件[408]/[409]及我方1105档案一致);采样器=euler_ancestral(他件原值)。

用法:
  python3 digitalhuman_livefire_20261111.py --mode smoke [--engine http://192.168.0.101:17000]
  python3 digitalhuman_livefire_20261111.py --mode full
输出: apps/output/1111-digitalhuman/<tag>/ (api_prompt.json / run_record.json / seg*.mp4 / final.mp4)
"""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT_BASE = os.path.join(ROOT, 'apps', 'output', '1111-digitalhuman')
AUDIO_DIR = os.path.expanduser('~/Downloads/1111-pika-h3-digitalhuman/assets')

UNET = 'Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors'
LORA = 'pika_h3_flex_ref2va_comfy_bf16.safetensors'
LORA_STRENGTH = 1.0
CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'
VAE_VIDEO = 'minimax_h3_video_vae_int8_convrot.safetensors'
VAE_AUDIO = 'minimax_h3_audio_vae_fp32.safetensors'
SIGMAS_6NFE = '1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0'
SAMPLER = 'euler_ancestral'          # 他件 [342]/[354] 原值
FPS = 24
BRIDGE = 22                          # 22帧桥(他件 MotionContext/TaperNoise/ImageFromBatch 同值)
SEED_BASE = 20261111
REF_IMAGE = 'daojie_A_1108.png'      # 引擎 input 在位(道劫A角色卡,单人正面,1111 vision 选片)

MODES = {
    #            W,H    每组秒  音频件            音频总秒
    'smoke': dict(w=544, h=960, seg=5, audio='dh_smoke_8s.wav', music=8.0, timeout=2400),
    'full':  dict(w=768, h=1344, seg=8, audio='dh_full_17s.wav', music=17.0, timeout=7200),
}

# ── 人物与叙事(与 REF_IMAGE 及实际语音文本匹配;1108 参考图↔提示词匹配铁则) ─────────
APPEAR = (
    "<Subject 1>: a young female Chinese cultivator drawn in a detailed 2D anime style, "
    "appearance fully referenced by <Picture 1> - identity, face, hairstyle and outfit taken "
    "entirely from the reference image and never changing: long dark-brown hair half tied up "
    "with a jade-and-gold hairpin and teal ribbon, teal drop earrings, a teal cross-collared "
    "embroidered outer robe over a white inner garment and long white skirt, cinched with a "
    "white waist sash, a sword with a teal scabbard carried on her back. She is the only "
    "performer; one person only, no second person."
)
SCENE = (
    "<Subject 3> (all shots): the same stone platform above a sea of clouds at sunset, "
    "warm golden-orange sky and distant teal mountains exactly as in <Picture 1>, unchanged "
    "in every segment, no added scene elements."
)
AUDIO_RULE = (
    "<Audio 1>: the provided Mandarin narration, vocal timing, pronunciation, rhythm and "
    "phrasing preserved 1:1; her visible face lip-syncs the narration naturally; whenever "
    "<Audio 1> carries no speech her lips stay softly closed."
)
CONTINUITY = (
    "Continuity: the first 22 frames (00:00.000-00:00.917 at 24 fps) exactly reproduce the "
    "previous segment's final 22 frames, matching pose, hand position, lip shape, lighting "
    "and camera motion with no cut or pause."
)
NO_TEXT = ("The image is a clean anime frame, no overlaid text or captions; diegetic only: "
           "<Audio 1> supplies the narration.")


def seg_prompt(i: int, n: int, words: str, seconds: float) -> str:
    """按作者模板组段:主体/道具手部/音频/场景 + 段落叙事 + 桥接 + Handoff + Shots。"""
    parts = [
        APPEAR,
        "Her hands stay relaxed and expressive in every shot; the sword stays on her back "
        "and is never drawn.",
        AUDIO_RULE,
        SCENE,
    ]
    if i == 0:
        parts.append(
            f"Segment 0 of {n}, {seconds:.1f} seconds, opening: she stands centered on the "
            f"platform facing the camera and begins speaking to the viewer. She says: \"{words}\" "
            "Gentle opening arc: a slow dolly-in from medium shot to medium close-up while she "
            "talks, soft hair and ribbon motion in the wind, calm confident gestures.")
        parts.append(
            "Handoff out, final frame: medium close-up facing the lens, lips relaxed after the "
            "last word, one hand lightly raised mid-gesture, warm sunset key light unchanged.")
    else:
        parts.append(
            f"Segment {i} of {n}, {seconds:.1f} seconds, continuing the same single take: she "
            f"goes on speaking to the viewer. She says: \"{words}\" The motion flows directly "
            "from the previous segment's final pose; she keeps small natural talking gestures "
            "and a soft weight shift, never freezing.")
        parts.append(CONTINUITY)
        parts.append(
            "Handoff out, final frame: medium shot facing the lens, lips relaxed after the last "
            "word, hands settled, camera motion easing to rest.")
    parts.append(f"Smooth camera only (slow dolly, slight arc), no whip pan, no zoom snap. {NO_TEXT}")
    return "\n".join(parts)


SMOOTH_WORDS = [
    "大家好,欢迎来到漫影工作室。",
    "今天带来一段数字人测试。",
]
FULL_WORDS = [
    "大家好,欢迎来到漫影工作室。",
    "今天给大家带来一段新的测试。数字人技术让画面中的人物跟着声音开口说话,",
    "唇形与语音保持同步。这是音频驱动的生成质量检查。",
]


def grid(n: int) -> int:
    """H3 帧数网格:最小 m>=max(5,n) 且 m%17==5(他件 ComfyMathExpression 等价,Python 健全模)。"""
    n = max(5, n)
    return n + ((5 - n % 17) % 17)


def plan_segments(seg_sec: int, music_sec: float):
    """展开他的循环公式:段0=grid(seg*24);循环段=剩余+桥;产出 [(len, audio_off, audio_dur)]。"""
    full = grid(seg_sec * FPS)
    target = music_sec * FPS
    lens = [full]
    delivered = full
    while delivered < target - 1:
        need = target - delivered + BRIDGE          # 本段需覆盖(含22帧重演桥)
        lens.append(min(full, grid(int(round(need)))))
        delivered += lens[-1] - BRIDGE
    segs, off = [], 0.0
    for i, ln in enumerate(lens):
        if i == 0:
            a_off, a_dur = 0.0, ln / FPS + 1.0        # 他件 [373]→[363]: 起始0, dur=seg+1
        else:
            prev_delivered = sum(lens[j] - (BRIDGE if j else 0) for j in range(i))
            a_off = max(0.0, (prev_delivered - BRIDGE) / FPS)   # 他件 [382]: (帧数-22)/24
            a_dur = ln / FPS + 1.0
        segs.append(dict(idx=i, length=ln, a_off=round(a_off, 3), a_dur=round(a_dur, 3)))
        off += ln / FPS
    return segs, sum(l - (BRIDGE if i else 0) for i, l in enumerate(lens))


# ── 引擎 HTTP ──────────────────────────────────────────────────────────────────
# Mac 侧 Clash 代理 env 会劫持 urllib(curl 需 --noproxy 同理)——一律走无代理 opener
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_json(engine, path, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(engine + path, data=data,
                                 headers={'Content-Type': 'application/json'})
    with _OPENER.open(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def upload_file(engine, path):
    """Yue2 范式:POST /upload/image 落引擎 input/,LoadAudio 从 input/ 读。"""
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


def build_prompt(cfg, segs, prompts, audio_name):
    p = {}
    p['load_audio'] = {'class_type': 'LoadAudio', 'inputs': {'audio': audio_name}}
    p['load_image'] = {'class_type': 'LoadImage', 'inputs': {'image': REF_IMAGE}}
    p['unet'] = {'class_type': 'UNETLoader', 'inputs': {'unet_name': UNET, 'weight_dtype': 'default'}}
    p['lora'] = {'class_type': 'LoraLoaderModelOnly',
                 'inputs': {'model': ['unet', 0], 'lora_name': LORA, 'strength_model': LORA_STRENGTH}}
    p['clip'] = {'class_type': 'CLIPLoader',
                 'inputs': {'clip_name': CLIP, 'type': 'minimax', 'device': 'default'}}
    p['vae_v'] = {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE_VIDEO}}
    p['vae_a'] = {'class_type': 'VAELoader', 'inputs': {'vae_name': VAE_AUDIO}}
    p['ksel'] = {'class_type': 'KSamplerSelect', 'inputs': {'sampler_name': SAMPLER}}
    p['sigmas'] = {'class_type': 'ManualSigmas', 'inputs': {'sigmas': SIGMAS_6NFE}}

    for s in segs:
        i, ln = s['idx'], s['length']
        t = f'{i:02d}'
        p[f'trim{t}'] = {'class_type': 'TrimAudioDuration',
                         'inputs': {'audio': ['load_audio', 0], 'start_index': s['a_off'],
                                    'duration': s['a_dur']}}
        r2v = {'class_type': 'MiniMaxH3ReferenceToVideo',
               'inputs': {'clip': ['clip', 0], 'prompt': prompts[i], 'width': cfg['w'],
                          'height': cfg['h'], 'length': ln, 'ref_image_size': 'match',
                          'vae': ['vae_v', 0], 'audio_vae': ['vae_a', 0],
                          'ref_images.ref_image_0': ['load_image', 0],
                          'ref_audios.ref_audio_0': [f'trim{t}', 0]}}
        p[f'r2v{t}'] = r2v
        p[f'lock{t}'] = {'class_type': 'MiniMaxH3NativeAudioLock',
                         'inputs': {'model': ['lora', 0], 'av_latent': [f'r2v{t}', 1],
                                    'audio_vae': ['vae_a', 0], 'audio': [f'trim{t}', 0]}}
        cond = [f'r2v{t}', 0]
        latent = [f'lock{t}', 1]
        if i > 0:
            prev = f'{i-1:02d}'
            p[f'loadl{t}'] = {'class_type': 'MiniMaxH3MotionContextLoadLatent',
                              'inputs': {'latent_path': [f'sl{prev}', 0], 'clip_index': i,
                                         'stock_format': False, 'folder': 'output'}}
            p[f'taper{t}'] = {'class_type': 'MiniMaxH3ContextLatentTaperNoise',
                              'inputs': {'context_latent': [f'loadl{t}', 0], 'tail_frames': str(BRIDGE),
                                         'alpha': 0.45, 'alpha_end': 0.1, 'ramp_steps': 2,
                                         'seed': SEED_BASE + 7000 + i, 'noise_scale': 'match_latent_std'}}
            p[f'mctx{t}'] = {'class_type': 'MiniMaxH3MotionContext',
                             'inputs': {'conditioning': [f'r2v{t}', 0], 'vae': ['vae_v', 0],
                                        'latent': [f'lock{t}', 1], 'context_length': str(BRIDGE),
                                        'audio_context_length': 0,
                                        'context_latent': [f'taper{t}', 0]}}
            cond = [f'mctx{t}', 0]
        p[f'guide{t}'] = {'class_type': 'BasicGuider',
                          'inputs': {'model': [f'lock{t}', 0], 'conditioning': cond}}
        p[f'noise{t}'] = {'class_type': 'RandomNoise', 'inputs': {'noise_seed': SEED_BASE + i}}
        p[f'samp{t}'] = {'class_type': 'SamplerCustomAdvanced',
                         'inputs': {'noise': [f'noise{t}', 0], 'guider': [f'guide{t}', 0],
                                    'sampler': ['ksel', 0], 'sigmas': ['sigmas', 0],
                                    'latent_image': latent}}
        p[f'dec{t}'] = {'class_type': 'VAEDecode',
                        'inputs': {'samples': [f'samp{t}', 0], 'vae': ['vae_v', 0]}}
        p[f'sl{t}'] = {'class_type': 'MiniMaxH3MotionContextSaveLatent',
                       'inputs': {'latent': [f'samp{t}', 0], 'filename_prefix': f'dh1111/seg{i}',
                                  'clip_index': i}}
        frames = [f'dec{t}', 0]
        if i > 0:
            p[f'cut{t}'] = {'class_type': 'ImageFromBatch',
                            'inputs': {'image': [f'dec{t}', 0], 'batch_index': BRIDGE,
                                       'length': ln - BRIDGE}}
            frames = [f'cut{t}', 0]
        p[f'cv{t}'] = {'class_type': 'CreateVideo',
                       'inputs': {'images': frames, 'fps': FPS, 'color_space': 'sRGB',
                                  'chroma_subsampling': 'auto', 'bit_depth': 'auto'}}
        p[f'sv{t}'] = {'class_type': 'SaveVideo',
                       'inputs': {'video': [f'cv{t}', 0], 'filename_prefix': f'dh1111/{TAG}/seg{i}',
                                  'format': 'auto', 'codec': 'auto'}}
    return p


def validate(engine, prompt):
    """接口边界假设核对:每 class/每 input 名对 object_info 实锚,连线口型别粗验。"""
    oi = http_json(engine, '/object_info', timeout=60)
    bad = []
    for nid, nd in prompt.items():
        ct = nd['class_type']
        if ct not in oi:
            bad.append(f'{nid}: class {ct} 不在册')
            continue
        spec = oi[ct]['input']
        allowed = set(spec.get('required', {})) | set(spec.get('optional', {}))
        for k, v in nd['inputs'].items():
            # autogrow 组成员(ref_images.ref_image_0 等):组名在册即合法
            # (API 点分写法=1106 xiaohei 实弹档案 api_prompt_used.json 实锚)
            ok = k in allowed or ('.' in k and k.split('.')[0] in allowed)
            if not ok:
                bad.append(f'{nid}({ct}): input {k} 不存在(allowed~{sorted(allowed)[:8]}...)')
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                src = prompt.get(v[0])
                if src:
                    sct = src['class_type']
                    outs = oi[sct].get('output') or []
                    if isinstance(outs, dict):
                        outs = outs.get(v[1], [])
                    if isinstance(outs, list) and v[1] >= len(outs):
                        bad.append(f'{nid}.{k} -> [{v[0]},{v[1]}] 越界({sct} outs={len(outs)})')
    if bad:
        print('VALIDATE FAIL:')
        for b in bad:
            print('  -', b)
        sys.exit(3)
    print(f'validate ✓ ({len(prompt)} 节点, class/input 名与 object_info 全对齐)')


def run(engine, prompt, timeout_s, tag_dir, resume_pid=None):
    if resume_pid:
        pid = resume_pid
    else:
        cid = str(uuid.uuid4())
        r = http_json(engine, '/prompt', {'prompt': prompt, 'client_id': cid}, timeout=60)
        if r.get('node_errors'):
            print('NODE ERRORS:', json.dumps(r['node_errors'], ensure_ascii=False)[:2000])
            sys.exit(1)
        pid = r['prompt_id']
    print('QUEUED', pid)
    t0 = time.time()
    last_beat = 0
    while True:
        if time.time() - t0 > timeout_s:
            print(f'TIMEOUT {timeout_s}s'); sys.exit(2)
        try:
            h = http_json(engine, f'/history/{pid}', timeout=60)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print('poll err(重试):', type(e).__name__, str(e)[:80]); time.sleep(15); continue
        rec = h.get(pid)
        if rec:
            st = rec.get('status', {})
            if st.get('status_str') == 'error':
                for m in st.get('messages', []):
                    if m[0] == 'execution_error':
                        print('EXEC ERROR:', json.dumps(m[1], ensure_ascii=False)[:3000])
                sys.exit(1)
            if st.get('completed'):
                print(f'DONE in {time.time()-t0:.0f}s')
                return rec
        if time.time() - last_beat > 60:
            last_beat = time.time()
            try:
                q = http_json(engine, '/queue', timeout=15)
                print(f'  [{int(time.time()-t0)}s] queue running={len(q["queue_running"])} '
                      f'pending={len(q["queue_pending"])}')
            except Exception:
                pass
        time.sleep(10)


def fetch_outputs(engine, rec, tag_dir):
    segs = []
    for nid, out in sorted(rec.get('outputs', {}).items()):
        for key in ('videos', 'gifs', 'images'):
            for item in out.get(key, []) or []:
                fn, sub = item['filename'], item.get('subfolder', '')
                dest = os.path.join(tag_dir, f'dl_{nid}_{fn}')
                url = (f'{engine}/view?filename={urllib.parse.quote(fn)}'
                       f'&subfolder={urllib.parse.quote(sub)}&type={item.get("type", "output")}')
                with _OPENER.open(url, timeout=300) as r, open(dest, 'wb') as f:
                    f.write(r.read())
                print('  fetched', dest, os.path.getsize(dest), 'B')
                segs.append(dest)
    return segs


def assemble(segs, audio_path, total_sec, tag_dir):
    lst = os.path.join(tag_dir, 'concat.txt')
    with open(lst, 'w') as f:
        for s in segs:
            f.write(f"file '{s}'\n")
    concat = os.path.join(tag_dir, 'concat.mp4')
    final = os.path.join(tag_dir, 'final.mp4')
    try:
        r = subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                            '-c', 'copy', concat], capture_output=True, text=True)
        if r.returncode != 0 or not os.path.exists(concat):
            print('concat -c copy 失败,转重编码:', r.stderr[:300])
            subprocess.run(['ffmpeg', '-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', lst,
                            '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', concat], check=True)
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', concat, '-i', audio_path,
                        '-t', f'{total_sec:.3f}', '-map', '0:v:0', '-map', '1:a:0',
                        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', final], check=True)
        print('FINAL:', final)
        return final
    except FileNotFoundError:
        print('ffmpeg 不在本机:跳过装配(段件已齐,回 Mac 侧 concat+mux)')
        return None


def main():
    global TAG
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='http://192.168.0.101:17000')
    ap.add_argument('--mode', choices=list(MODES), required=True)
    ap.add_argument('--submit', choices=['yes', 'no'], default='yes')
    ap.add_argument('--audio-dir', default=AUDIO_DIR)
    ap.add_argument('--out-dir', default=None)
    ap.add_argument('--resume', default=None, help='断点续轮:已有 prompt_id,跳过提交直接轮询+取件+装配')
    a = ap.parse_args()
    cfg = dict(MODES[a.mode])
    TAG = a.mode
    global OUT_BASE
    if a.out_dir:
        OUT_BASE = a.out_dir

    segs, delivered = plan_segments(cfg['seg'], cfg['music'])
    words = (SMOOTH_WORDS if a.mode == 'smoke' else FULL_WORDS)
    words = words + [''] * (len(segs) - len(words))
    prompts = [seg_prompt(s['idx'], len(segs), words[i], s['length'] / FPS)
               for i, s in enumerate(segs)]
    print(f"[{a.mode}] {cfg['w']}x{cfg['h']} seg={cfg['seg']}s music={cfg['music']}s → {len(segs)} 段 "
          f"长度={[s['length'] for s in segs]} 交付 {delivered}f={delivered/FPS:.2f}s")

    tag_dir = os.path.join(OUT_BASE, TAG)
    os.makedirs(tag_dir, exist_ok=True)

    q = http_json(a.engine, '/queue')
    if q['queue_running'] or q['queue_pending']:
        print(f"WARN: 队列非空 running={len(q['queue_running'])} pending={len(q['queue_pending'])} "
              f"(共享队列,FIFO 排队,不清洗)")

    audio_name = os.path.splitext(cfg['audio'])[0] + '.wav'
    up = upload_file(a.engine, os.path.join(a.audio_dir, cfg['audio']))
    print('upload:', up)

    prompt = build_prompt(cfg, segs, prompts, audio_name)
    validate(a.engine, prompt)
    with open(os.path.join(tag_dir, 'api_prompt.json'), 'w') as f:
        json.dump(prompt, f, ensure_ascii=False, indent=1)
    plan = dict(mode=a.mode, engine=a.engine, segs=segs, delivered_frames=delivered,
                delivered_sec=delivered / FPS, models=dict(unet=UNET, lora=LORA, clip=CLIP,
                vae_video=VAE_VIDEO, vae_audio=VAE_AUDIO), sigmas=SIGMAS_6NFE,
                sampler=SAMPLER, bridge=BRIDGE, ref_image=REF_IMAGE, audio=audio_name)
    with open(os.path.join(tag_dir, 'plan.json'), 'w') as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    if a.submit == 'no':
        print('dry-run 止步(已出 api_prompt.json)'); return

    if a.resume:
        print('RESUME', a.resume)
        rec = run(a.engine, None, cfg['timeout'], tag_dir, resume_pid=a.resume)
    else:
        rec = run(a.engine, prompt, cfg['timeout'], tag_dir)
    seg_files = fetch_outputs(a.engine, rec, tag_dir)
    if not seg_files:
        print('无产物!'); sys.exit(1)
    final = assemble(seg_files, os.path.join(a.audio_dir, cfg['audio']), delivered / FPS, tag_dir)
    record = dict(plan, prompt_outputs=seg_files, final=final,
                  elapsed_hint='见 QUEUED→DONE 打点')
    with open(os.path.join(tag_dir, 'run_record.json'), 'w') as f:
        json.dump(record, f, ensure_ascii=False, indent=1)
    print('RECORD →', os.path.join(tag_dir, 'run_record.json'))


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (fetch_outputs 用)
    main()
