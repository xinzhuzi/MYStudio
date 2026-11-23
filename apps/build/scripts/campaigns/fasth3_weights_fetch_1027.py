#!/usr/bin/env python3
# -*- coding: ascii -*-
"""FastH3 weights fetcher for the Windows engine home (10-27 mainline, plan section 3 S2).

Repo source of truth: apps/build/scripts/fasth3_weights_fetch_1027.py
Deployed on Windows as E:\\IP\\MYStudio\\apps\\build\\scripts\\fasth3_weights_fetch_1027.py
and run under a schtasks ONCE task (MossBatch14 pattern), detached from any SSH
session. Pure stdlib, ASCII-only console output (GBK codepage safe; paths that
contain non-ASCII are logged via ascii()).

Per-file flow (plan section 2 table, dual metric gate):
    curl.exe -L -C - --retry 20 --retry-delay 5  ->  E:\\IP\\tmp\\fasth3\\<name>.part
    -> verify byte size AND sha256 against the embedded table
    -> atomic rename (os.replace) into <engine-home>\\models\\<subdir>\\<name>
    -> write <final>.ok receipt (JSON: file/size/sha256/ts/url)

Engine home is resolved via glob 'E:/IP/*/comfyui' (Chinese-path safe).
Extra curl hardening beyond the plan-pinned resume flags, all resume-preserving:
    --fail               do not write HTTP error bodies into the .part file
    -sS                  silent progress (poll .part size for progress), errors shown
    --connect-timeout 30 bail on dead connects so the retry loop can rotate sources
    --speed-limit/--speed-time  abort stalls slower than 10 KB/s for 120 s

Usage:
    fasth3_weights_fetch_1027.py             # default mandatory set: R1,R2,R3
    fasth3_weights_fetch_1027.py --only R5   # explicit subset (conditional fallback, S4)
"""

import argparse
import datetime
import glob
import hashlib
import json
import os
import subprocess
import sys
import time

TMP_DIR = r'E:\IP\tmp\fasth3'
OUTER_ATTEMPTS = 40   # per-file outer retry budget; curl itself retries 20x inside each attempt
OUTER_SLEEP = 60      # seconds between outer attempts

FILES = {
    'R1': {
        'filename': 'fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors',
        'bytes': 22128378696,
        'sha256': '0922785978dc9bfe1adf27d8b291b0ca763f9f165f882e6cb297c72fbb6deda8',
        'urls': [
            'https://hf-mirror.com/FastVideo/FastVideo-FastH3-Comfy/resolve/main/diffusion_models/fastvideo_fasth3_8step_v2_pruned_int8_convrot.safetensors',
        ],
        'subdir': 'diffusion_models',
    },
    'R2': {
        'filename': 'minimax_h3_video_vae_int8_convrot.safetensors',
        'bytes': 2811065184,
        'sha256': '52a2c8c73583c86e4f41cdcce3a6ad0ea562987bc0bf3d60a0cef5f5c8e60c0e',
        'urls': [
            'https://modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master/vae/minimax_h3_video_vae_int8_convrot.safetensors',
            'https://hf-mirror.com/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_video_vae_int8_convrot.safetensors',
        ],
        'subdir': 'vae',
    },
    'R3': {
        'filename': 'minimax_h3_audio_vae_fp32.safetensors',
        'bytes': 605254808,
        'sha256': '8e505d95dd1561d47abd43d4238fd40d9bb1ae9e147ed0a4cba778d76ae4db48',
        'urls': [
            'https://modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master/vae/minimax_h3_audio_vae_fp32.safetensors',
            'https://hf-mirror.com/Comfy-Org/MiniMax-H3/resolve/main/vae/minimax_h3_audio_vae_fp32.safetensors',
        ],
        'subdir': 'vae',
    },
    # R4 is the on-disk TE hardlink (plan S1) - never downloaded here.
    'R5': {
        'filename': 'qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
        'bytes': 27141342152,
        'sha256': 'bc2ced0fbea64757fa9acddccfc0b3f4819d1dcf1da6c124d690d368be283923',
        'urls': [
            'https://modelscope.cn/models/Comfy-Org/MiniMax-H3/resolve/master/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
            'https://hf-mirror.com/FastVideo/FastVideo-FastH3-Comfy/resolve/main/text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors',
        ],
        'subdir': 'text_encoders',
    },
    'R6': {
        'filename': 'fasth3_omniref_8step_pruned_int8_convrot.safetensors',
        'bytes': 22213723064,
        'sha256': '851b2dc9670ed864b7f1e951ac9da047d83b1c04ded9bfcc1a9e5bba0ee33f80',
        'urls': [
            'https://hf-mirror.com/FastVideo/FastH3-Omni-Comfy/resolve/main/diffusion_models/fasth3_omniref_8step_pruned_int8_convrot.safetensors',
        ],
        'subdir': 'diffusion_models',
    },
}

DEFAULT_SET = ['R1', 'R2', 'R3']


def log(msg):
    print('[%s] %s' % (datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'), msg), flush=True)


def engine_models_dir():
    roots = glob.glob('E:/IP/*/comfyui')
    if not roots:
        raise SystemExit('FATAL: engine home glob E:/IP/*/comfyui not found')
    home = roots[0]
    log('engine home = %s' % ascii(home))
    return os.path.join(home, 'models')


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(8 * 1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def verify(path, ent):
    if not os.path.exists(path):
        return False
    if os.path.getsize(path) != ent['bytes']:
        return False
    return sha256_file(path) == ent['sha256']


def write_receipt(final, ent, url):
    rec = {
        'file': ent['filename'],
        'size': ent['bytes'],
        'sha256': ent['sha256'],
        'ts': datetime.datetime.now().isoformat(timespec='seconds'),
        'url': url,
    }
    with open(final + '.ok', 'w') as f:
        json.dump(rec, f, indent=2)


def fsize(path):
    return os.path.getsize(path) if os.path.exists(path) else 0


def fetch(rid, ent, models_dir):
    final = os.path.join(models_dir, ent['subdir'], ent['filename'])
    if verify(final, ent):
        log('%s already present and dual-verified: %s' % (rid, ascii(final)))
        if not os.path.exists(final + '.ok'):
            write_receipt(final, ent, 'verified-in-place')
        return True

    os.makedirs(os.path.join(models_dir, ent['subdir']), exist_ok=True)
    os.makedirs(TMP_DIR, exist_ok=True)
    part = os.path.join(TMP_DIR, ent['filename'] + '.part')

    for attempt in range(1, OUTER_ATTEMPTS + 1):
        if fsize(part) > ent['bytes']:
            log('%s part oversized (%d > %d), removing for clean restart'
                % (rid, fsize(part), ent['bytes']))
            os.remove(part)
        url = ent['urls'][(attempt - 1) % len(ent['urls'])]
        log('%s attempt %d/%d url=%s resume-from=%dB'
            % (rid, attempt, OUTER_ATTEMPTS, url, fsize(part)))
        cmd = [
            'curl.exe', '-L', '-C', '-',
            '--retry', '20', '--retry-delay', '5',
            '--fail', '-sS',
            '--connect-timeout', '30',
            '--speed-limit', '10240', '--speed-time', '120',
            '-o', part, url,
        ]
        rc = subprocess.run(cmd).returncode
        got = fsize(part)
        log('%s curl exit=%d part=%dB / %dB (%.1f%%)'
            % (rid, rc, got, ent['bytes'], 100.0 * got / ent['bytes']))
        if got == ent['bytes']:
            digest = sha256_file(part)
            log('%s sha256=%s expected=%s' % (rid, digest, ent['sha256']))
            if digest == ent['sha256']:
                os.replace(part, final)
                write_receipt(final, ent, url)
                log('%s DONE -> %s' % (rid, ascii(final)))
                return True
            log('%s sha mismatch, removing part for clean restart' % rid)
            os.remove(part)
        time.sleep(OUTER_SLEEP)
    log('%s FAILED after %d outer attempts' % (rid, OUTER_ATTEMPTS))
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default=None,
                    help='comma-separated file ids, e.g. R5 or R5,R6; default = R1,R2,R3')
    args = ap.parse_args()
    ids = [s.strip() for s in args.only.split(',')] if args.only else DEFAULT_SET
    for rid in ids:
        if rid not in FILES:
            raise SystemExit('unknown id: %s (known: %s)' % (rid, ','.join(sorted(FILES))))
    log('fetch set = %s' % ','.join(ids))
    models = engine_models_dir()
    results = {}
    for rid in ids:
        results[rid] = fetch(rid, FILES[rid], models)
    ok = sum(1 for v in results.values() if v)
    log('ALL DONE ok=%d fail=%d detail=%s' % (ok, len(results) - ok, results))
    sys.exit(0 if ok == len(results) else 1)


if __name__ == '__main__':
    main()
