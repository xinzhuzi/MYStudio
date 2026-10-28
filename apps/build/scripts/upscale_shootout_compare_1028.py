#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""fasth3-upscale-shootout-1028 对拍汇总器(汇总员,Mac 端)。

职责(确定性再生产):
  1) 对全部产物 ffprobe 实测规格+文件大小 → compare/ffprobe-metrics-1028.json + markdown 表打印
  2) 每产物 ffmpeg 抽 3 帧(0.5s/2.5s/4.0s = 24fps 下帧 12/60/96,W7 先例口径)
  3) PIL 拼并排对拍图(native-2x 全幅板 / native-4x 缩半总览板 / 4x 中心 100% 细节板)→ compare/

只读不改引擎;不入 repo 版控(与同役生成器/校验器同纪律,未 staged)。
"""
import json
import os
import subprocess
import sys

REPO = '/Users/zhengbingjin/Project/Github/MYStudio'
CAMP = REPO + '/apps/output/fasth3-upscale-shootout-1028'
CMP = CAMP + '/compare'
FRAMES = '/tmp/shootout-frames-1028'
FFPROBE = '/opt/homebrew/bin/ffprobe'
FFMPEG = '/opt/homebrew/bin/ffmpeg'
FONT = '/System/Library/Fonts/Hiragino Sans GB.ttc'
TIMES = [('f012', 0.5), ('f060', 2.5), ('f096', 4.0)]  # 同帧号:24fps 帧12/60/96

# (键, 显示名, 相对路径, 组)
SCHEMES = [
    ('src',            '源片 608x352',            '../fasth3-livefire-1027/t2v-480p_00001_.mp4', 'src'),
    ('seedvr2-mac',    'SeedVR2@Mac(M1)',          'seedvr2-mac/seedvr2-mac-2x-raw.mp4',              'native-2x'),
    ('seedvr2-win-2x', 'SeedVR2@Win(W1)',          'seedvr2-win/seedvr2-win-2x-raw.mp4',              'native-2x'),
    ('flashvsr-2x',    'FlashVSR(W3)',             'flashvsr/flashvsr-2x-raw.mp4',                    'native-2x'),
    ('vosr2-2x',       'VOSR2+RTXVSR(W4)',         'vosr2-vfx/vosr2-vfx-2x-raw.mp4',                  'native-2x'),
    ('fasth3-2x',      'FastH3二采(W6)',           'fasth3-ercai/fasth3-ercai-2x-raw.mp4',            'native-2x'),
    ('ltx25-2x',       'LTX-2.5二采(W7)',          'ltx25-ercai/ltx25-ercai-2x-raw.mp4',              'native-2x'),
    ('esrgan-d2x',     'ESRGAN派生2x(W2)',         'esrgan-baseline-win/esrgan-baseline-win-2x-derived-raw.mp4', 'derived-2x'),
    ('esrgan-4x',      'ESRGAN基线4x(W2)',         'esrgan-baseline-win/esrgan-baseline-win-4x-raw.mp4', 'native-4x'),
    ('seedvr2-4x',     'SeedVR2@Win4x(W1)',        'seedvr2-win/seedvr2-win-4x-raw.mp4',              'native-4x'),
    ('flashvsr-4x',    'FlashVSR4x(W3)',           'flashvsr/flashvsr-4x-raw.mp4',                    'native-4x'),
]
# 重混/终版变体(只 probe 不进对拍板)
REMIXES = [
    ('seedvr2-mac-final',      'seedvr2-mac/seedvr2-mac-2x-final.mp4'),
    ('seedvr2-mac-final-acopy', 'seedvr2-mac/seedvr2-mac-2x-final-audio-copy.mp4'),
    ('esrgan-4x-aac-remix',    'esrgan-baseline-win/esrgan-baseline-win-4x-raw-aac-remix.mp4'),
    ('esrgan-d2x-aac-remix',   'esrgan-baseline-win/esrgan-baseline-win-2x-derived-raw-aac-remix.mp4'),
    ('flashvsr-2x-aac-remix',  'flashvsr/flashvsr-2x-raw-aac-remix.mp4'),
    ('flashvsr-4x-aac-remix',  'flashvsr/flashvsr-4x-raw-aac-remix.mp4'),
    ('vosr2-2x-remux',         'vosr2-vfx/vosr2-vfx-2x-remux.mp4'),
    ('fasth3-2x-aac-remix',    'fasth3-ercai/fasth3-ercai-2x-raw-aac-remix.mp4'),
    ('ltx25-2x-aac-remix',     'ltx25-ercai/ltx25-ercai-2x-raw-aac-remix.mp4'),
]


def probe(path):
    r = subprocess.run([FFPROBE, '-v', 'quiet', '-print_format', 'json',
                        '-show_streams', '-show_format', path],
                       capture_output=True, text=True)
    d = json.loads(r.stdout)
    v = next((s for s in d['streams'] if s['codec_type'] == 'video'), None)
    a = next((s for s in d['streams'] if s['codec_type'] == 'audio'), None)
    out = {
        'path': path,
        'bytes': os.path.getsize(path),
        'resolution': '%sx%s' % (v['width'], v['height']) if v else None,
        'vcodec': v.get('codec_name') if v else None,
        'fps': v.get('avg_frame_rate') if v else None,
        'duration_s': float(v.get('duration', 0)) if v else None,
        'nb_frames': v.get('nb_frames') if v else None,
        'audio': ('%s/%sch/%sHz' % (a['codec_name'], a.get('channels'),
                                    a.get('sample_rate'))) if a else '无',
    }
    return out


def extract_frames(key, path):
    d = os.path.join(FRAMES, key)
    os.makedirs(d, exist_ok=True)
    for tag, t in TIMES:
        out = os.path.join(d, tag + '.png')
        subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-ss', str(t),
                        '-i', path, '-frames:v', '1', out], check=True)
    return d


def tile(img, w, h):
    from PIL import Image
    if img.size != (w, h):
        return img.resize((w, h), Image.LANCZOS)
    return img


def montage(items, cols, tile_w, tile_h, out_path, bar_h=34, gap=4):
    """items: list of (label, PIL.Image already sized tile_w x tile_h)."""
    from PIL import Image, ImageDraw, ImageFont
    rows = (len(items) + cols - 1) // cols
    W = cols * tile_w + (cols + 1) * gap
    H = rows * (tile_h + bar_h) + (rows + 1) * gap
    canvas = Image.new('RGB', (W, H), (48, 48, 48))
    f = ImageFont.truetype(FONT, 20)
    d = ImageDraw.Draw(canvas)
    for i, (lab, im) in enumerate(items):
        r, c = divmod(i, cols)
        x = gap + c * (tile_w + gap)
        y = gap + r * (tile_h + bar_h + gap)
        d.rectangle([x, y, x + tile_w, y + bar_h], fill=(24, 24, 24))
        d.text((x + 10, y + 5), lab, fill=(255, 255, 255), font=f)
        canvas.paste(im.convert('RGB'), (x, y + bar_h))
    canvas.save(out_path)
    return out_path


def main():
    os.makedirs(CMP, exist_ok=True)
    # ---- 1) probe ----
    metrics = {}
    for key, name, rel, grp in SCHEMES:
        p = os.path.normpath(os.path.join(CAMP, rel))
        metrics[key] = {'name': name, 'group': grp, **probe(p)}
    for key, rel in REMIXES:
        p = os.path.normpath(os.path.join(CAMP, rel))
        metrics[key] = {'name': key, 'group': 'remix', **probe(p)}
    with open(os.path.join(CMP, 'ffprobe-metrics-1028.json'), 'w', encoding='utf-8') as f:
        json.dump(metrics, f, ensure_ascii=False, indent=1)
    print('== ffprobe 表(实跑 /opt/homebrew/bin/ffprobe 7.1.1)==')
    for key, m in metrics.items():
        print('%-22s %-10s %9s %6s %8s帧 %5.3fs %-6s %10dB  %s' % (
            key, m['group'], m['resolution'], m['fps'], m['nb_frames'],
            m['duration_s'], m['audio'], m['bytes'], m['vcodec']))

    # ---- 2) frames ----
    frames = {}
    for key, name, rel, grp in SCHEMES:
        p = os.path.normpath(os.path.join(CAMP, rel))
        frames[key] = extract_frames(key, p)

    # ---- 3) montages ----
    from PIL import Image
    TW, TH = 1216, 704  # 2x 档原生分辨率 = 对拍瓷砖尺寸
    order2x = ['src', 'seedvr2-mac', 'seedvr2-win-2x', 'flashvsr-2x',
               'vosr2-2x', 'fasth3-2x', 'ltx25-2x', 'esrgan-d2x']
    lab2x = {
        'src': '源片 608x352(lanczos 显示放大,非超分)',
        'seedvr2-mac': 'SeedVR2@Mac M1 | native-2x',
        'seedvr2-win-2x': 'SeedVR2@Win W1 | native-2x',
        'flashvsr-2x': 'FlashVSR W3 | native-2x',
        'vosr2-2x': 'VOSR2+RTXVSR W4 | native-2x',
        'fasth3-2x': 'FastH3二采 W6 | native-2x',
        'ltx25-2x': 'LTX-2.5二采 W7 | native-2x',
        'esrgan-d2x': 'ESRGAN 4x→lanczos2x W2 | derived-2x 参考位',
    }
    order4x = ['src', 'esrgan-4x', 'seedvr2-4x', 'flashvsr-4x']
    lab4x = {
        'src': '源片 608x352(显示放大)',
        'esrgan-4x': 'ESRGAN基线 W2 | native-4x(缩半显示)',
        'seedvr2-4x': 'SeedVR2@Win W1 | native-4x(缩半显示)',
        'flashvsr-4x': 'FlashVSR W3 | native-4x(缩半显示)',
    }
    for tag, t in TIMES:
        # native-2x 全幅板(瓷砖=产品原生 1216x704,100% 像素)
        items = []
        for k in order2x:
            im = Image.open(os.path.join(frames[k], tag + '.png'))
            items.append((lab2x[k], tile(im, TW, TH)))
        montage(items, 4, TW, TH,
                os.path.join(CMP, 'cmp-%s-%ss-native2x.png' % (tag, t)))
        # native-4x 总览板(4x 原件缩半到 1216x704 显示)
        items = []
        for k in order4x:
            im = Image.open(os.path.join(frames[k], tag + '.png'))
            items.append((lab4x[k], tile(im, TW, TH)))
        montage(items, 2, TW, TH,
                os.path.join(CMP, 'cmp-%s-%ss-native4x-half.png' % (tag, t)))
        # 4x 中心 100% 细节板:4x 件中心裁 1216x704(=源中心 304x176×4);
        # 源片中心裁 304x176 后 lanczos 放大到同尺寸对照
        items = []
        for k in order4x:
            im = Image.open(os.path.join(frames[k], tag + '.png'))
            if k == 'src':
                w, h = im.size  # 608x352
                cw, ch = 304, 176
                crop = im.crop(((w - cw) // 2, (h - ch) // 2,
                                (w + cw) // 2, (h + ch) // 2))
                crop = crop.resize((TW, TH), Image.LANCZOS)
            else:
                w, h = im.size  # 2432x1408
                crop = im.crop(((w - TW) // 2, (h - TH) // 2,
                                (w + TW) // 2, (h + TH) // 2))
            lab = lab4x[k] + (' 中心100%细节' if k != 'src'
                              else ' 源中心304x176→lanczos对照')
            items.append((lab, crop))
        montage(items, 2, TW, TH,
                os.path.join(CMP, 'cmp-%s-%ss-detail-center.png' % (tag, t)))
        print('montages done for', tag)
    print('ALL DONE. compare dir:', CMP)


if __name__ == '__main__':
    sys.exit(main())
