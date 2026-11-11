#!/usr/bin/env python3
"""数字人/无限时长 UI 画布件生成器(1111 萝卜件嫁接我方模型的画布直开形态)。

产出两件 → 2_视频/H3视频/1_漫影自研/2_数字人/:
  数字人-音频驱动.json      三段展开,AudioLock 双通道(ref_audios+锁音),逐段 SaveVideo+装配说明
  无限时长-循环拼接.json    三段展开,自产音轨 AudioConcat 链+SaveAudio 收口,逐段 SaveVideo

设计口径:
  - 零新代码,全原生/在册节点(数字人 API 实弹双 PASS 形态画布化;三插件已装 Win 引擎)
  - 默认值=1111 全测实测参数(768×1344,段[192,192,73],24fps,官方6-NFE σ;采样器=数字人 euler_ancestral/无限时长 lcm,各随其源)
  - 布局立宪:模型链横排右向;每段一组框(主竖流+右侧栏桥/存档);组框罩全(生成器自算 bbox);零左向线
  - 模型=我方在役件(Cobijada+pika_flex_ref2va_comfy+nvfp4 TE+同名VAE)
用法: python3 digitalhuman_ui_build_1111.py [--accel](默认裸链=作者保真;A/B 终局后定)
"""
import argparse
import copy
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(
    HERE, '..', '..', 'backend', 'comfyui', 'workflows',
    '2_视频', 'H3视频', '1_漫影自研', '2_数字人'))

UNET = 'Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors'
LORA = 'pika_h3_flex_ref2va_comfy_bf16.safetensors'
CLIP = 'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors'
VAE_V = 'minimax_h3_video_vae_int8_convrot.safetensors'
VAE_A = 'minimax_h3_audio_vae_fp32.safetensors'
SIGMAS = '1.0, 0.972973, 0.923077, 0.8, 0.571429, 0.333333, 0.0'
FPS = 24
BRIDGE = 22
SEGS = [192, 192, 73]
AUDIO_TRIMS = [(0.0, 9.0), (7.083, 9.5), (14.125, 4.5)]
REF_IMAGE = 'daojie_A_1108.png'
REF_AUDIO = 'dh_full_17s.wav'
W, H = 768, 1344
SEED0 = 20261111

PROMPT_HEAD = (
    "<Subject 1>: a young female Chinese cultivator in a detailed 2D anime style, appearance "
    "fully referenced by <Picture 1> - identity, face, hairstyle and outfit taken entirely from "
    "the reference image and never changing: long dark-brown hair half tied up with a jade-and-gold "
    "hairpin and teal ribbon, teal drop earrings, a teal cross-collared embroidered outer robe over "
    "a white inner garment and long white skirt, a sword with a teal scabbard carried on her back. "
    "She is the only performer; one person only.\n"
)
SEG_BODIES = [
    "Segment 0 of 3, 8.0 seconds, opening: she stands on the platform facing the camera and begins "
    "speaking. <Audio 1>: the provided Mandarin narration, vocal timing, pronunciation and phrasing "
    "preserved 1:1; her visible face lip-syncs naturally; when no speech her lips stay softly closed. "
    "<Subject 3>: the stone platform above a sea of clouds at sunset as in <Picture 1>, unchanged. "
    "Handoff out: medium close-up, lips relaxed after the last word.",
    "Segment 1 of 3, 8.0 seconds, continuing the same take: she goes on speaking with natural "
    "gestures. <Audio 1>: 1:1 preserved as before. Continuity: the first 22 frames (00:00.000-"
    "00:00.917 at 24 fps) exactly reproduce the previous segment's final 22 frames, matching pose, "
    "hand placement, lip shape, lighting and camera. Handoff out: medium shot, hands settled.",
    "Segment 2 of 3, 3.0 seconds, closing: she finishes the line with a soft smile and a slight bow. "
    "<Audio 1>: 1:1 preserved. Continuity: the first 22 frames reproduce the previous segment's "
    "final 22 frames as before. Handoff out: settled end pose facing the lens.",
]
PROMPTS = [PROMPT_HEAD + b for b in SEG_BODIES]

USAGE = (
    "【{variant}·1111 萝卜件嫁接我方模型·画布直开形态】\n"
    "1. 换参考图(LoadImage);数字人件另换音频(LoadAudio,引擎 input/ 内);三段提示词按段编辑"
    "(含 <Audio 1> 口型句与 22 帧桥接句,勿删关键句)。\n"
    "2. 分段长度已按 H3 网格(≡5 mod 17)预置 192/192/73;改每组时长须同步改三处 length 与音频切片 offset/dur。\n"
    "3. 跑完得 seg0/1/2 三段 mp4(数字人件用输入音频 mux;无限时长件另出模型自产音轨 track)。\n"
    "   终装配: ffmpeg -f concat -safe 0 -i list.txt -c copy v.mp4 && ffmpeg -i v.mp4 -i <音频> "
    "-c:v copy -c:a aac final.mp4\n"
    "4. 模型=Cobijada int8+pika_flex_ref2va_comfy@1.0+nvfp4 TE(引擎在册);σ=官方6-NFE七值逐字,勿改。\n"
    "5. 加更多段=克隆「段1」组:SaveLatent/LoadLatent 的 clip_index 成对+1,无限时长件 AudioConcat 再接力一段。\n"
    "来源:萝卜 340集 V6 嫁接役(2026-11-11 实弹双 PASS);API 真源=apps/build/scripts/"
    "digitalhuman_livefire_20261111.py / unlimited_livefire_20261111.py。"
)


class G:
    def __init__(self):
        self.nodes, self.links, self.groups = [], [], []
        self._id, self._lid = 100, 5000

    def node(self, ntype, title, pos, size, widgets=None, in_names=None, out_names=None):
        self._id += 1
        n = {'id': self._id, 'type': ntype, 'title': title, 'pos': pos, 'size': size,
             'flags': {}, 'order': len(self.nodes), 'mode': 0,
             'inputs': [{'name': k.split('|')[0], 'type': k.split('|')[1], 'link': None,
                         'widget': {'name': k.split('|')[0]}} for k in (in_names or [])],
             'outputs': [{'name': k.split('|')[0], 'type': k.split('|')[1], 'links': []}
                         for k in (out_names or [])],
             'properties': {'Node name for S&R': ntype}, 'widgets_values': widgets}
        self.nodes.append(n)
        return n['id']

    def link(self, onode, oslot, inode, iname, _t):
        src = next(n for n in self.nodes if n['id'] == onode)
        dst = next(n for n in self.nodes if n['id'] == inode)
        idx = next(i for i, s in enumerate(dst['inputs']) if s['name'] == iname)
        assert dst['inputs'][idx]['link'] is None, f'{inode}.{iname} 已占'
        self._lid += 1
        dst['inputs'][idx]['link'] = self._lid
        src['outputs'][oslot]['links'].append(self._lid)
        self.links.append([self._lid, onode, oslot, inode, idx, _t])
        return self._lid

    def group(self, title, bbox):
        self.groups.append({'title': title, 'bounding': bbox, 'color': '#3f789e', 'locked': False})


def out0(nid):
    return nid, 0


def build(variant: str, accel: bool):
    is_audio = variant == 'audio'
    g = G()

    # ── 公共带 ── 模型链横排右向(y=760);素材/编码器带上带 ──
    img = g.node('LoadImage', '参考图(人物真源)', [80, 80], [320, 460],
                 widgets=[REF_IMAGE, 'image'], out_names=['IMAGE|IMAGE', 'MASK|MASK'])
    clip = g.node('CLIPLoader', 'TE(nvfp4)', [470, 80], [330, 130],
                  widgets=[CLIP, 'minimax', 'default'], out_names=['CLIP|CLIP'])
    vae_v = g.node('VAELoader', '视频VAE', [860, 80], [300, 80],
                   widgets=[VAE_V], out_names=['VAE|VAE'])
    vae_a = g.node('VAELoader', '音频VAE', [860, 200], [300, 80],
                   widgets=[VAE_A], out_names=['VAE|VAE'])
    ksel = g.node('KSamplerSelect', '采样器', [1220, 80], [250, 80],
                  widgets=['euler_ancestral' if is_audio else 'lcm'],
                  out_names=['SAMPLER|SAMPLER'])
    sig = g.node('ManualSigmas', 'σ=官方6-NFE七值(勿改)', [1220, 210], [360, 90],
                 widgets=[SIGMAS], out_names=['SIGMAS|SIGMAS'])
    aud = None
    if is_audio:
        aud = g.node('LoadAudio', '音频(台词/歌,input/内)', [470, 260], [330, 110],
                     widgets=[REF_AUDIO, ''], out_names=['AUDIO|AUDIO'])

    unet = g.node('UNETLoader', '底模(Cobijada int8)', [80, 760], [340, 90],
                  widgets=[UNET, 'default'], out_names=['MODEL|MODEL'])
    lora = g.node('LoraLoaderModelOnly', 'LoRA(pika flex ref2va)', [470, 760], [340, 90],
                  widgets=[LORA, 1.0], in_names=['model|MODEL'],
                  out_names=['MODEL|MODEL'])
    g.link(unet, 0, lora, 'model', 'MODEL')
    model_src = lora
    if accel:
        sol = g.node('BlockSparseAttention', 'sol-attn τ1.3', [860, 760], [320, 200],
                     widgets=['sol-attn', 1.3, 0.0, 1.0, '', 12288, 256, 'exact_kv_and_rows', False],
                     in_names=['model|MODEL'], out_names=['MODEL|MODEL'])
        g.link(lora, 0, sol, 'model', 'MODEL')
        model_src = sol

    prompt_ids = [g.node('PrimitiveStringMultiline', f'段{i}提示词', [80 + i * 1320, 920], [1260, 320],
                         widgets=[PROMPTS[i]], out_names=['STRING|STRING']) for i in range(3)]

    # ── 三段竖流组 ── 主列 x;右栏 x+440(桥/存档/音频解码);y 自 1350 递进 ──
    SEG_X = [80, 2050, 4020]
    Y0 = 1350
    audio_prev = None
    boxes = []
    seg_ctx = []
    for i, ln in enumerate(SEGS):
        x, y = SEG_X[i], Y0
        r2v = g.node('MiniMaxH3ReferenceToVideo', f'段{i}·参考生视频', [x, y], [380, 430],
                     widgets=['', W, H, ln, 'match'],
                     in_names=['clip|CLIP', 'prompt|STRING', 'vae|VAE', 'audio_vae|VAE',
                               'ref_images.ref_image_0|IMAGE'] +
                              (['ref_audios.ref_audio_0|AUDIO'] if is_audio else []),
                     out_names=['positive|CONDITIONING', 'LATENT|LATENT'])
        g.link(clip, 0, r2v, 'clip', 'CLIP')
        g.link(prompt_ids[i], 0, r2v, 'prompt', 'STRING')
        g.link(vae_v, 0, r2v, 'vae', 'VAE')
        g.link(vae_a, 0, r2v, 'audio_vae', 'VAE')
        g.link(img, 0, r2v, 'ref_images.ref_image_0', 'IMAGE')
        y += 470
        cond, latent = (r2v, 0), (r2v, 1)
        msrc, mctx = model_src, None
        if is_audio:
            trim = g.node('TrimAudioDuration', f'段{i}·音频切片', [x + 440, y], [310, 130],
                          widgets=[AUDIO_TRIMS[i][0], AUDIO_TRIMS[i][1]],
                          in_names=['audio|AUDIO'], out_names=['AUDIO|AUDIO'])
            g.link(aud, 0, trim, 'audio', 'AUDIO')
            g.link(trim, 0, r2v, 'ref_audios.ref_audio_0', 'AUDIO')
            lock = g.node('MiniMaxH3NativeAudioLock', f'段{i}·音轨锁', [x, y], [350, 160],
                          in_names=['model|MODEL', 'av_latent|LATENT', 'audio_vae|VAE', 'audio|AUDIO'],
                          out_names=['model|MODEL', 'av_latent|LATENT', 'exact_audio|AUDIO'])
            g.link(model_src, 0, lock, 'model', 'MODEL')
            g.link(r2v, 1, lock, 'av_latent', 'LATENT')
            g.link(vae_a, 0, lock, 'audio_vae', 'VAE')
            g.link(trim, 0, lock, 'audio', 'AUDIO')
            msrc, latent = lock, (lock, 1)
            y += 200
        deca = None
        if not is_audio:
            deca = g.node('VAEDecodeAudio', f'段{i}·解码音频', [x + 440, y], [300, 100],
                          in_names=['samples|LATENT', 'vae|VAE'], out_names=['AUDIO|AUDIO'])
        if i > 0:
            prev = seg_ctx[i - 1]
            loadl = g.node('MiniMaxH3MotionContextLoadLatent', f'段{i}·载上段桥', [x + 440, y + 130], [330, 150],
                           widgets=[f'dhui/seg{i-1}', i, False, 'output'],
                           in_names=['latent_path|STRING', 'clip_index|INT'],
                           out_names=['LATENT|LATENT'])
            g.link(prev['sl'], 0, loadl, 'latent_path', 'STRING')
            mctx = g.node('MiniMaxH3MotionContext', f'段{i}·22帧桥', [x + 440, y + 320], [330, 270],
                          widgets=['22', 0],
                          in_names=['conditioning|CONDITIONING', 'vae|VAE', 'latent|LATENT',
                                    'context_length|COMBO', 'audio_context_length|INT',
                                    'context_latent|LATENT'],
                          out_names=['conditioning|CONDITIONING', 'trim_frames|INT'])
            g.link(r2v, 0, mctx, 'conditioning', 'CONDITIONING')
            g.link(vae_v, 0, mctx, 'vae', 'VAE')
            g.link(latent[0], latent[1], mctx, 'latent', 'LATENT')
            g.link(loadl, 0, mctx, 'context_latent', 'LATENT')
            cond = (mctx, 0)
        guide = g.node('BasicGuider', f'段{i}·引导', [x, y], [260, 90],
                       in_names=['model|MODEL', 'conditioning|CONDITIONING'],
                       out_names=['GUIDER|GUIDER'])
        g.link(msrc, 0, guide, 'model', 'MODEL')
        g.link(cond[0], cond[1], guide, 'conditioning', 'CONDITIONING')
        noise = g.node('RandomNoise', f'段{i}·噪声', [x + 300, y], [240, 90],
                       widgets=[SEED0 + i], out_names=['NOISE|NOISE'])
        samp = g.node('SamplerCustomAdvanced', f'段{i}·采样', [x, y + 150], [310, 210],
                      in_names=['noise|NOISE', 'guider|GUIDER', 'sampler|SAMPLER',
                                'sigmas|SIGMAS', 'latent_image|LATENT'],
                      out_names=['output|LATENT', 'denoised_output|LATENT'])
        g.link(noise, 0, samp, 'noise', 'NOISE')
        g.link(guide, 0, samp, 'guider', 'GUIDER')
        g.link(ksel, 0, samp, 'sampler', 'SAMPLER')
        g.link(sig, 0, samp, 'sigmas', 'SIGMAS')
        g.link(latent[0], latent[1], samp, 'latent_image', 'LATENT')
        sl = g.node('MiniMaxH3MotionContextSaveLatent', f'段{i}·存桥latent', [x + 440, y + 680], [330, 130],
                    widgets=[f'dhui/seg{i}', i],
                    in_names=['latent|LATENT'], out_names=['latent_path|STRING'])
        g.link(samp, 0, sl, 'latent', 'LATENT')
        if deca is not None:
            g.link(samp, 0, deca, 'samples', 'LATENT')
            g.link(vae_a, 0, deca, 'vae', 'VAE')
        dec = g.node('VAEDecode', f'段{i}·解码', [x, y + 400], [260, 100],
                     in_names=['samples|LATENT', 'vae|VAE'], out_names=['IMAGE|IMAGE'])
        g.link(samp, 0, dec, 'samples', 'LATENT')
        g.link(vae_v, 0, dec, 'vae', 'VAE')
        y2 = y + 540
        frames = (dec, 0)
        if i > 0:
            if is_audio:
                cut = g.node('ImageFromBatch', f'段{i}·跳22帧桥', [x, y2], [290, 120],
                             widgets=[BRIDGE, ln - BRIDGE],
                             in_names=['image|IMAGE'], out_names=['IMAGE|IMAGE'])
                g.link(dec, 0, cut, 'image', 'IMAGE')
                frames = (cut, 0)
                y2 += 160
            else:
                trm = g.node('MiniMaxH3MotionContextTrim', f'段{i}·剪桥(视频+音频)', [x, y2], [310, 150],
                             in_names=['images|IMAGE', 'audio|AUDIO', 'trim_frames|INT'],
                             out_names=['IMAGE|IMAGE', 'AUDIO|AUDIO'])
                g.link(dec, 0, trm, 'images', 'IMAGE')
                g.link(deca, 0, trm, 'audio', 'AUDIO')
                g.link(mctx, 1, trm, 'trim_frames', 'INT')
                frames = (trm, 0)
                seg_audio = (trm, 1)
                y2 += 190
        else:
            y2 += 60
        cv = g.node('CreateVideo', f'段{i}·成视频', [x, y2], [300, 150],
                    widgets=[FPS, 8, 'sRGB', 'auto', 'none'],
                    in_names=['images|IMAGE', 'fps|FLOAT'], out_names=['VIDEO|VIDEO'])
        g.link(frames[0], frames[1], cv, 'images', 'IMAGE')
        sv = g.node('SaveVideo', f'段{i}·保存', [x + 360, y2], [330, 120],
                    widgets=[f'video/{"数字人" if is_audio else "无限时长"}/seg{i}', 'auto', 'auto'],
                    in_names=['video|VIDEO'], out_names=['VIDEO|VIDEO'])
        g.link(cv, 0, sv, 'video', 'VIDEO')
        if not is_audio:
            seg_audio_out = (deca, 0) if i == 0 else seg_audio
            if audio_prev is None:
                audio_prev = seg_audio_out
            else:
                ac = g.node('AudioConcat', f'段{i}·音轨接力', [x + 740, y2], [300, 120],
                            widgets=['after'],
                            in_names=['audio1|AUDIO', 'audio2|AUDIO'], out_names=['AUDIO|AUDIO'])
                g.link(audio_prev[0], audio_prev[1], ac, 'audio1', 'AUDIO')
                g.link(seg_audio_out[0], seg_audio_out[1], ac, 'audio2', 'AUDIO')
                audio_prev = (ac, 0)
        seg_ctx.append(dict(sl=sl))
        boxes.append([x - 50, Y0 - 70, 1140, (y2 + 340) - Y0 + 120])
    if not is_audio and audio_prev:
        sa = g.node('SaveAudio', '音轨收口(模型自产)', [SEG_X[2] + 740, Y0 + 60], [330, 110],
                    widgets=['audio/无限时长/track'],
                    in_names=['audio|AUDIO'], out_names=['AUDIO|AUDIO'])
        g.link(audio_prev[0], audio_prev[1], sa, 'audio', 'AUDIO')
    for i, b in enumerate(boxes):
        g.group('段0(初始化)' if i == 0 else f'段{i}·22帧桥循环', b)
    usage = USAGE.format(variant='数字人(音频驱动口型)' if is_audio else '无限时长(循环拼接·自产音轨)')
    g.node('Note', '使用说明', [80, 540], [1100, 190], widgets=[usage])
    ymax = max(n['pos'][1] + n['size'][1] for n in g.nodes if n['type'] != 'Note')
    return {'nodes': g.nodes, 'links': g.links, 'groups': g.groups, 'config': {}, 'extra': {},
            'version': 0.4, 'last_node_id': g._id, 'last_link_id': g._lid}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--accel', action='store_true')
    a = ap.parse_args()
    os.makedirs(OUT_DIR, exist_ok=True)
    for variant, fname in [('audio', '数字人-音频驱动.json'), ('unlimited', '无限时长-循环拼接.json')]:
        wf = build(variant, a.accel)
        out = os.path.join(OUT_DIR, fname)
        with open(out, 'w') as f:
            json.dump(wf, f, ensure_ascii=False, indent=1)
        print('WROTE', out, f"({len(wf['nodes'])} 节点/{len(wf['links'])} 链/{len(wf['groups'])} 组)")


if __name__ == '__main__':
    main()
