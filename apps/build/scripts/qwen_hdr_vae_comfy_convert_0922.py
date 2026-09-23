#!/usr/bin/env python3
"""diffusers 版 Qwen-Image HDR VAE → ComfyUI 键名格式转换(09-22)。

背景:HF Felldude/Qwen-Image-HDR-VAE 的 diffusion_pytorch_model.safetensors 是
diffusers AutoencoderKLWan 键名,直接改名放入 ComfyUI 会在 VAELoader 报
state_dict 形状不匹配(被误装配为普通 AutoencoderKL)。本脚本以能正常加载的
qwen_image_vae.safetensors(ComfyUI 原生键名)为键名地图,把 HDR 权重重排成
ComfyUI 格式并覆盖 qwen_image_HDR_vae_fp32_comfy.safetensors。

正确性证明(三重):
1. 194 键双射:stock 每键恰好映射一个 hdr 键,形状完全一致;
2. 解码器 12 个 resnet 单元按通道指纹序列直接对齐(无翻转),72 键逐键核对;
3. 编码器训练时冻结 → stock(bf16)与 hdr(fp32)编码器张量逐位相等,
   脚本对全部 encoder.* 键做逐位断言,任何映射错误立即失败。

用法(引擎 venv):
  "$HOME/Library/Application Support/漫影工作室/comfyui/venv/bin/python" \
      apps/build/scripts/qwen_hdr_vae_comfy_convert_0922.py
"""
import collections
import hashlib
import json
import os
import re

import torch
from safetensors import safe_open
from safetensors.torch import save_file

VAE_DIR = os.path.join(os.path.expanduser("~"), "Library", "Application Support",
                       "漫影工作室", "comfyui", "models", "vae")
STOCK = os.path.join(VAE_DIR, "qwen_image_vae.safetensors")
HDR = os.path.join(VAE_DIR, "qwen_image_HDR_vae_fp32_comfy.safetensors")

# stock(ComfyUI原生) → hdr(diffusers AutoencoderKLWan) 非歧义改名规则
RULES = [
    ("conv1.", "quant_conv."),
    ("conv2.", "post_quant_conv."),
    ("decoder.conv1.", "decoder.conv_in."),
    ("decoder.head.0.gamma", "decoder.norm_out.gamma"),
    ("decoder.head.2.", "decoder.conv_out."),
    ("encoder.conv1.", "encoder.conv_in."),
    ("encoder.head.0.gamma", "encoder.norm_out.gamma"),
    ("encoder.head.2.", "encoder.conv_out."),
    ("decoder.middle.1.", "decoder.mid_block.attentions.0."),
]
MIDDLE_RES = [("decoder.middle.0.residual.", "decoder.mid_block.resnets.0."),
              ("decoder.middle.2.residual.", "decoder.mid_block.resnets.1.")]
# stock 把 resnet 拍平成 residual.{容器号}.{叶子}:0=norm1, 2=conv1, 3=norm2, 6=conv2
SUB = {"0.gamma": "norm1.gamma", "2.weight": "conv1.weight", "2.bias": "conv1.bias",
       "3.gamma": "norm2.gamma", "6.weight": "conv2.weight", "6.bias": "conv2.bias"}
UP_PAT = re.compile(r"decoder\.upsamples\.(\d+)\.residual\.(\d+)\.(.+)")
RES_PAT = re.compile(r"decoder\.up_blocks\.(\d+)\.resnets\.(\d+)\."
                     r"(norm1\.gamma|conv1\.weight|conv1\.bias|norm2\.gamma|conv2\.weight|conv2\.bias)")


def main():
    with safe_open(STOCK, framework="pt", device="cpu") as f:
        sk = list(f.keys())
        stock = {k: f.get_tensor(k) for k in sk}
    with safe_open(HDR, framework="pt", device="cpu") as f:
        hk = list(f.keys())
        hdr = {k: f.get_tensor(k).to(torch.float32) for k in hk}
    sh = {k: tuple(stock[k].shape) for k in sk}
    hh = {k: tuple(hdr[k].shape) for k in hk}

    pairs, used = {}, set()

    def take(s, h):
        if h in hdr and h not in used and sh[s] == hh[h]:
            pairs[s] = h
            used.add(h)
            return True
        return False

    # 1) 非歧义规则
    for s in sk:
        if s in hk:
            take(s, s)
            continue
        done = False
        for a, b in RULES:
            if s.startswith(a):
                take(s, b + s[len(a):])
                done = True
                break
        if done:
            continue
        for a, b in MIDDLE_RES:  # middle 残差也要走容器号→norm/conv 的子索引翻译
            if s.startswith(a):
                rest = s[len(a):]          # 例: "0.gamma" / "2.weight"
                t = b + SUB[rest]
                take(s, t)
                done = True
                break
        if done:
            continue
        m = re.match(r"decoder\.upsamples\.(\d+)\.(resample|time_conv)\.(\d+)\.(.+)", s)
        if m:  # 块边界:stock 3/7/11 → hdr up_blocks.0/1/2 的 upsamplers.0
            j = (int(m.group(1)) - 3) // 4
            take(s, f"decoder.up_blocks.{j}.upsamplers.0.{m.group(2)}.{m.group(3)}.{m.group(4)}")
            continue
        if s.startswith("decoder.upsamples.4.shortcut."):
            take(s, "decoder.up_blocks.1.resnets.0.conv_shortcut." + s.rsplit(".", 1)[-1])
            continue
        if s.startswith("encoder.downsamples.3.resample."):
            take(s, "encoder.down_blocks.3.upsamplers.0.resample." + s.rsplit(".", 1)[-1])
            continue

    # 2) 解码器上采样块:12 单元×6 键,通道指纹序列已实证直接对齐(无翻转)
    s_flat = []
    for k in sk:
        m = UP_PAT.match(k)
        if m:
            block, container, leaf = int(m.group(1)), int(m.group(2)), m.group(3)
            t = SUB.get(f"{container}.{leaf}")
            if t:
                s_flat.append((block, container, leaf, k, t))
    s_flat.sort()
    units = collections.defaultdict(dict)
    for block, container, leaf, k, t in s_flat:
        units[block][t] = k
    assert len(units) == 12, f"stock 解码器单元数异常: {len(units)}"
    h_flat = []
    for k in hk:
        m = RES_PAT.match(k)
        if m:
            h_flat.append((int(m.group(1)), int(m.group(2)), m.group(3), k))
    h_flat.sort()
    assert len(h_flat) == 72, f"hdr resnet 键数异常: {len(h_flat)}"
    for ui, block in enumerate(sorted(units)):
        hb, hr = divmod(ui, 3)
        hd = {t: k for b, r, t, k in h_flat if b == hb and r == hr}
        for t, sk_key in units[block].items():
            assert t in hd, (block, t)
            take(sk_key, hd[t])
    print("解码器 12 单元×6 键 = 72 全配对 ✓(通道指纹实证直接对齐,无翻转)")

    # 3) 剩余键:编码器用内容指纹(冻结=逐位相等),其余同形状唯一配对
    left_s = [k for k in sk if k not in pairs]
    left_h = [k for k in hk if k not in used]

    def hsh(t):
        return hashlib.sha256(t.to(torch.float32).contiguous().numpy().tobytes()).hexdigest()

    h_hash = collections.defaultdict(list)
    h_shape = collections.defaultdict(list)
    for k in left_h:
        h_hash[hsh(hdr[k])].append(k)
        h_shape[hh[k]].append(k)
    ambiguous = 0
    for s in left_s:
        cands = h_hash.get(hsh(stock[s]), [])
        if cands:
            take(s, cands.pop(0))
            continue
        cands = h_shape.get(sh[s], [])
        if len(cands) == 1:
            take(s, cands[0])
            h_shape[sh[s]].clear()
            continue
        ambiguous += 1
        print("⚠️ 无法配对:", s, sh[s])
    print(f"剩余键配对完成;无法配对 {ambiguous};总配对 {len(pairs)}/{len(sk)};hdr 用尽 {len(used)}/{len(hk)}")
    assert len(pairs) == 194 and len(used) == 194, "配对不完整!"

    # 4) 编码器逐位校验(冻结铁律)
    bad = 0
    enc_n = 0
    for s, h in pairs.items():
        if s.startswith("encoder."):
            enc_n += 1
            if not torch.equal(stock[s].to(torch.float32), hdr[h]):
                bad += 1
                print("❌ 编码器不一致:", s, "<-", h)
    print(f"编码器逐位校验:{enc_n} 张量,不一致 {bad}")
    assert bad == 0, "编码器必须逐位一致(冻结铁律)"

    # 5) 写出
    out = {s: hdr[h].contiguous().to(torch.float32) for s, h in pairs.items()}
    save_file(out, HDR)
    print("✅ 已写出 ComfyUI 格式:", HDR)


if __name__ == "__main__":
    main()
