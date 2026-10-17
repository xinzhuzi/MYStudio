#!/usr/bin/env python3
"""texture-fix VAE 切换安装(2026-10-16,用户令:文生图+图生图两件)。

[3] VAELoader vae_name:qwen_image_2.1_vae_bf16 → texture_fix_vae_for_qwen_image_2.1_bf16
(1016 A/B 实证:turbo 8步纯解码锐度+44%,透明链完好;edit/img2img/官方模板不动=用户 scope)。
fail-closed:术前逐字锚;术后回读;幂等 exit 3。装机副本随打包带出,不单独分发。
"""
import json, shutil, sys, hashlib
from pathlib import Path
REPO = Path('/Users/zhengbingjin/Project/Github/MYStudio')
FILES = [
    REPO / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json',
    REPO / 'apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/qi21-道劫-i2i.json',
]
OLD = 'qwen_image_2.1_vae_bf16.safetensors'
NEW = 'texture_fix_vae_for_qwen_image_2.1_bf16.safetensors'

def main():
    done = True
    for p in FILES:
        d = json.loads(p.read_text(encoding='utf-8'))
        n = next(n for n in d['nodes'] if n['type'] == 'VAELoader')
        if n['widgets_values'][0] == NEW:
            continue
        if n['widgets_values'][0] != OLD:
            print(f'[vae] FAIL: {p.name} 术前值不符:{n["widgets_values"][0]}'); sys.exit(2)
        done = False
    if done:
        print('[vae] 已术后形态,幂等拦停'); sys.exit(3)
    for p in FILES:
        bak = p.with_suffix('.json.bak-1016vae')
        if not bak.exists(): shutil.copy2(p, bak)
        d = json.loads(p.read_text(encoding='utf-8'))
        n = next(n for n in d['nodes'] if n['type'] == 'VAELoader')
        n['widgets_values'][0] = NEW
        if n.get('widgets_values_named'):
            n['widgets_values_named']['vae_name'] = NEW
        p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding='utf-8')
        r = json.loads(p.read_text(encoding='utf-8'))
        rn = next(x for x in r['nodes'] if x['type'] == 'VAELoader')
        assert rn['widgets_values'][0] == NEW, '回读不符'
        print(f'[vae] {p.name} [3]→{NEW}')
    print('[vae] 完成:文生图+图生图双件切换')

if __name__ == '__main__':
    main()
