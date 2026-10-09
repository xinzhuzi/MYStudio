#!/usr/bin/env python3
"""Qwen-Image-2.1 PE-I2I 文本编码器 bf16 原版 → ComfyUI 单文件(09-23)。

背景:官方 Comfy-Org 只发 int8_convrot 件,在 MPS 首矩阵乘即死
(aten::_int_mm 无 MPS 内核,t2i 同款实证 ~/Downloads/qwen21-e2e-0923/
round2/pe-mps-fail.txt)。替换路线与 t2i 相同:从满血 bf16 原版分片取
原值拼单文件,键名与 ComfyUI 核心 comfy/text_encoders/qwen35.py 处理器
消费口径一致。

与 t2i 脚本(qwen21_pe_bf16_convert_0923.py)的证明链差异:
  t2i 有 int8 件可对照(剥 .weight_scale/.comfy_quant 后双射);
  i2i 不下载 int8 件(死路),兼容性证明改用 t2i bf16 输出件交叉对账——
  键集与 shape 须与 t2i 件完全一致(同为 Qwen3.5-VL 9B 架构),
  t2i 件已在本引擎实弹可跑(261s 改写实录),其键名即活体消费口径。
  注意:张量【值】只在 i2i 源分片内抽样逐位(两次微调权重值不同,
  严禁与 t2i 件比值,只比键集/shape/dtype)。

正确性证明(三重):
  1. 键集双射:i2i 原版 index 键 == t2i bf16 件键,双向零差集(脚本断言);
  2. 字节守恒:输出文件大小 == 8 + header_len + Σ原版张量字节数(脚本断言);
  3. 抽样逐位:写出后 safe_open 重读,跨分片抽样 torch.equal 对 i2i 原版。

流式纪律:按分片逐个 open、逐键分块(64MB)拷贝,内存峰值 ≈ 64MB。

用法(引擎 venv):
  "$HOME/Library/Application Support/漫影工作室/comfyui/venv/bin/python" \
      apps/build/scripts/qwen21_pe_i2i_bf16_convert_0923.py [--force]
  幂等:输出件已存在且自检全绿则只重跑自检不重写;--force 强制重写。
  降级:源分片清理后重跑,自动降级为输出件内禀自检(键数/全 BF16/字节守恒)。
"""
import argparse
import json
import os
import struct

HOME = os.path.expanduser("~/Library/Application Support/漫影工作室/comfyui")
SRC_DIR = os.path.expanduser("~/Downloads/qwen21-pe-bf16-i2i")
T2I_REF = os.path.join(HOME, "models", "text_encoders",
                       "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors")
OUT = os.path.join(HOME, "models", "text_encoders",
                   "qwen3.5_9b_qwen_image_2.1_pe_i2i_bf16.safetensors")
CHUNK = 64 * 1024 * 1024
DTYPE_SIZE = {"BF16": 2, "F16": 2, "F32": 4, "F64": 8, "I8": 1, "U8": 1,
              "I16": 2, "I32": 4, "I64": 8, "U16": 2, "U32": 4, "U64": 8,
              "BOOL": 1, "F8_E4M3": 1, "F8_E5M2": 1}
EXPECTED_KEYS = 760  # 同 Qwen3.5-VL 9B 架构,与 t2i 件一致;index 实读复核


def read_header(path):
    """返回 (去 metadata 的键描述 dict, 元数据 dict, 数据区起始字节)。"""
    with open(path, "rb") as f:
        n = struct.unpack("<Q", f.read(8))[0]
        raw = f.read(n)
    h = json.loads(raw)
    meta = h.pop("__metadata__", None)
    return h, meta, 8 + n


def _tensor_bytes(desc):
    n = DTYPE_SIZE[desc["dtype"]]
    for d in desc["shape"]:
        n *= d
    return n


def verify_standalone():
    """源分片已清理后的输出件内禀自检。"""
    hdr, _, data_start = read_header(OUT)
    assert len(hdr) == EXPECTED_KEYS, f"键数 {len(hdr)} != {EXPECTED_KEYS}"
    bad = [k for k, v in hdr.items() if v["dtype"] != "BF16"]
    assert not bad, f"非 BF16 键:{bad[:5]}"
    cursor = 0
    for k in sorted(hdr):
        s, e = hdr[k]["data_offsets"]
        assert s == cursor, f"{k}: 数据区非紧排({s} != {cursor})"
        assert e - s == _tensor_bytes(hdr[k]), f"{k}: 偏移跨度与 shape×dtype 不符"
        cursor = e
    actual = os.path.getsize(OUT)
    assert actual == data_start + cursor, \
        f"字节守恒失败:文件 {actual} != 数据区起点 {data_start} + 数据 {cursor}"
    print(f"降级自检(源已清理):{EXPECTED_KEYS} 键 / 全 BF16 / 数据区紧排 / "
          f"字节守恒 {actual:,} B ✓")
    print("✅ 输出件内禀自检通过:", OUT)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="输出件已存在也强制重写")
    args = ap.parse_args()

    # ── 0. 输入缺失降级(源清理后重跑场景)────────────────────────
    have_src = os.path.exists(os.path.join(SRC_DIR, "model.safetensors.index.json"))
    if not have_src:
        if os.path.exists(OUT):
            print(f"源分片不在位(原版暂存在位={have_src}),降级为输出件内禀自检")
            verify_standalone()
            return
        raise SystemExit(f"源分片缺失({SRC_DIR})且无可自检的输出件,无法转换")
    assert os.path.exists(T2I_REF), \
        f"交叉对账基准缺失:{T2I_REF}(t2i bf16 件必须在位)"

    # ── 1. 读两份 manifest ────────────────────────────────────────
    ref_hdr, _, _ = read_header(T2I_REF)
    print(f"t2i 基准件:{len(ref_hdr)} 键(本引擎实弹可跑的消费口径)")

    index = json.load(open(os.path.join(SRC_DIR, "model.safetensors.index.json")))
    weight_map = index["weight_map"]
    print(f"原版 index:{len(weight_map)} 键,分片 {sorted(set(weight_map.values()))}")

    # ── 2. 键集双向核对(铁律:任何一侧多键即停)────────────────────
    only_ref = sorted(set(ref_hdr) - set(weight_map))
    only_orig = sorted(set(weight_map) - set(ref_hdr))
    print(f"仅 t2i 基准有:{only_ref or '无'} | 仅 i2i 原版有:{only_orig or '无'}")
    assert not only_ref and not only_orig, "键集非双射,停!"
    assert len(weight_map) == EXPECTED_KEYS, \
        f"键数 {len(weight_map)} != 预期 {EXPECTED_KEYS}(架构漂移,须人工裁定)"

    # ── 3. 分片头读取:dtype/shape 核对 + 拷贝计划 ──────────────────
    shard_hdr = {}
    for shard in sorted(set(weight_map.values())):
        h, meta, data_start = read_header(os.path.join(SRC_DIR, shard))
        assert meta is None or meta.get("format", "pt") == "pt", \
            f"{shard}: metadata 异常 {meta}"
        shard_hdr[shard] = h
        reg = {k for k, s in weight_map.items() if s == shard}
        assert set(h) == reg, f"{shard}: 分片头与 index 登记不一致"
    bad_dtype = sorted(k for k, s in weight_map.items()
                       if shard_hdr[s][k]["dtype"] != "BF16")
    assert not bad_dtype, f"原版存在非 BF16 张量(违背预期,须人工裁定):{bad_dtype[:10]}"
    print(f"原版全部 {len(weight_map)} 张量 dtype=BF16 ✓;分片头与 index 逐分片一致 ✓")

    for k in weight_map:
        assert list(shard_hdr[weight_map[k]][k]["shape"]) == list(ref_hdr[k]["shape"]), \
            f"shape 与 t2i 基准不一致:{k}(架构不同源,停)"

    # 数据区布局:键名字典序(可复现);偏移由此唯一确定
    out_order = sorted(weight_map)
    offsets, cursor = {}, 0
    for k in out_order:
        so = shard_hdr[weight_map[k]][k]["data_offsets"]
        nbytes = so[1] - so[0]
        assert nbytes == _tensor_bytes(shard_hdr[weight_map[k]][k]), k
        offsets[k] = (cursor, cursor + nbytes)
        cursor += nbytes
    total = cursor
    header = {"__metadata__": {"format": "pt"}}
    for k in out_order:
        v = shard_hdr[weight_map[k]][k]
        header[k] = {"dtype": v["dtype"], "shape": v["shape"],
                     "data_offsets": list(offsets[k])}
    hb = json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    pad = (-len(hb)) % 8
    hb += b" " * pad
    expect_size = 8 + len(hb) + total
    print(f"计划:{len(out_order)} 键 / 数据 {total / 1e9:.3f} GB / "
          f"期望文件 {expect_size / 1e9:.3f} GB")

    # ── 4. 写出(已存在且非 --force 则跳过重写,幂等)────────────────
    if os.path.exists(OUT) and not args.force:
        print(f"输出件已存在,跳过重写(自检继续):{OUT}")
    else:
        import tempfile
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(OUT),
                                   prefix=".qwen21_pe_i2i_", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb", buffering=0) as out:
                out.write(struct.pack("<Q", len(hb)))
                out.write(hb)
                data_base = 8 + len(hb)
                copied = 0
                for shard in sorted(set(weight_map.values())):
                    sp = os.path.join(SRC_DIR, shard)
                    _, _, src_base = read_header(sp)
                    with open(sp, "rb") as src:
                        for k in sorted(k for k, s in weight_map.items()
                                        if s == shard):
                            so = shard_hdr[shard][k]["data_offsets"]
                            nbytes = so[1] - so[0]
                            out.seek(data_base + offsets[k][0])
                            src.seek(src_base + so[0])
                            left = nbytes
                            while left:
                                blk = src.read(min(CHUNK, left))
                                assert blk, f"{shard}:{k} 意外 EOF"
                                out.write(blk)
                                left -= len(blk)
                            copied += nbytes
                    print(f"  {shard} 拷贝完成(累计 {copied / 1e9:.3f} GB)")
            assert copied == total, f"字节守恒失败:{copied} != {total}"
            os.replace(tmp, OUT)
            print(f"写出完成:{OUT}")
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    # ── 5. 自检:大小 + 键数 + 抽样逐位(只对 i2i 源分片)────────────
    actual = os.path.getsize(OUT)
    assert actual == expect_size, f"文件大小 {actual} != 期望 {expect_size}"
    print(f"自检·文件大小:{actual:,} B == 期望 {expect_size:,} B ✓")

    import torch
    from safetensors import safe_open
    with safe_open(OUT, framework="pt", device="cpu") as fo:
        out_keys = set(fo.keys())
        assert out_keys == set(weight_map), \
            f"输出键数 {len(out_keys)} != {len(weight_map)}"
        print(f"自检·键数:{len(out_keys)}(与原版 index 双射)✓")

        sample = [
            "lm_head.weight",
            "model.language_model.embed_tokens.weight",
            "model.language_model.layers.0.linear_attn.in_proj_qkv.weight",
            "model.language_model.layers.0.linear_attn.conv1d.weight",
            "model.language_model.layers.3.self_attn.q_proj.weight",
            "model.language_model.layers.31.mlp.gate_proj.weight",
            "model.language_model.norm.weight",
        ]
        shard_cache = {}
        for k in sample:
            shard = weight_map[k]
            if shard not in shard_cache:
                shard_cache[shard] = safe_open(os.path.join(SRC_DIR, shard),
                                               framework="pt", device="cpu")
            t_out, t_src = fo.get_tensor(k), shard_cache[shard].get_tensor(k)
            assert torch.equal(t_out, t_src), f"抽样逐位失败:{k}"
            print(f"自检·抽样 {k}: dtype={t_out.dtype} "
                  f"shape={tuple(t_out.shape)} 与 i2i 原版逐位相等 ✓")
    print("✅ 全部自检通过:", OUT)


if __name__ == "__main__":
    main()
