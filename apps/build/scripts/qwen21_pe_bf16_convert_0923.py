#!/usr/bin/env python3
"""Qwen-Image-2.1 PE-T2I 文本编码器 bf16 原版 → ComfyUI 单文件(09-23)。

背景:MPS 上 int8 件(qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors)
权重加载成功但首次矩阵乘即死——aten::_int_mm 无 MPS 内核
(~/Downloads/qwen21-e2e-0923/round2/pe-mps-fail.txt)。替换路线 = 按同一键清单
从满血 bf16 原版分片取原值拼单文件,键名与 int8 件(即原版 transformers 命名)
完全一致,ComfyUI 核心 comfy/text_encoders/qwen35.py 原生处理器消费。

转换语义(已侦察定案,本脚本只执行+自证):
  int8 件 1380 键 = 760 权重键(310 I8 + 450 BF16 直存)+ 310 .weight_scale
  + 310 .comfy_quant;原版 index 760 键与 int8 权重键**完美双射**(逐键核对)。
  输出 = 760 键全取原版 bf16 原值;逐字节原样拷贝(零解码零变换)——int8 件内
  BF16 直存张量(含 conv1d)与原版**逐位相等**已抽样实证,"convrot" 后缀不引入
  任何值变换。丢弃全部 .weight_scale/.comfy_quant 量化键。

正确性证明(三重):
  1. 键集双射:int8 权重键 == 原版 index 键,双向零差集(脚本断言);
  2. 字节守恒:输出文件大小 == 8 + header_len + Σ原版张量字节数(脚本断言);
  3. 抽样逐位:写出后 safe_open 重读,跨分片抽样 torch.equal 对原版(必真,
     字节拷贝),并对 int8 件的 BF16 直存键抽样 torch.equal(证明与可加载先例
     的非量化部分等价)。

流式纪律:按分片逐个 open、逐键分块(64MB)拷贝,内存峰值 ≈ 64MB。

用法(引擎 venv):
  "$HOME/Library/Application Support/漫影工作室/comfyui/venv/bin/python" \
      apps/build/scripts/qwen21_pe_bf16_convert_0923.py [--force]
  幂等:输出件已存在且自检全绿则只重跑自检不重写;--force 强制重写。
  降级:09-23 转换定谙后 int8 旧件与原版暂存目录均已清理——输入缺失时自动
  降级为输出件内禀自检(760 键/全 BF16/字节守恒),不再要求输入在位。
"""
import argparse
import json
import os
import struct

HOME = os.path.expanduser("~/Library/Application Support/漫影工作室/comfyui")
SRC_DIR = "/Users/zhengbingjin/Downloads/qwen21-pe-bf16-t2i"
INT8 = os.path.join(HOME, "models", "text_encoders",
                    "qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors")
OUT = os.path.join(HOME, "models", "text_encoders",
                   "qwen3.5_9b_qwen_image_2.1_pe_t2i_bf16.safetensors")
CHUNK = 64 * 1024 * 1024
DTYPE_SIZE = {"BF16": 2, "F16": 2, "F32": 4, "F64": 8, "I8": 1, "U8": 1,
              "I16": 2, "I32": 4, "I64": 8, "U16": 2, "U32": 4, "U64": 8,
              "BOOL": 1, "F8_E4M3": 1, "F8_E5M2": 1}


def verify_standalone():
    """输入(int8 件/原版暂存)已清理后的输出件内禀自检。"""
    hdr, _, data_start = read_header(OUT)  # read_header 已剥 __metadata__
    assert len(hdr) == 760, f"键数 {len(hdr)} != 760"
    bad = [k for k, v in hdr.items() if v["dtype"] != "BF16"]
    assert not bad, f"非 BF16 键:{bad[:5]}"
    cursor = 0
    for k in sorted(hdr):
        s, e = hdr[k]["data_offsets"]
        assert s == cursor, f"{k}: 数据区非紧排({s} != {cursor})"
        n = DTYPE_SIZE["BF16"]
        for d in hdr[k]["shape"]:
            n *= d
        assert e - s == n, f"{k}: 偏移跨度与 shape×dtype 不符"
        cursor = e
    actual = os.path.getsize(OUT)
    assert actual == data_start + cursor, \
        f"字节守恒失败:文件 {actual} != 数据区起点 {data_start} + 数据 {cursor}"
    print(f"降级自检(输入已清理):760 键 / 全 BF16 / 数据区紧排 / "
          f"字节守恒 {actual:,} B ✓")
    print("✅ 输出件内禀自检通过:", OUT)


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="输出件已存在也强制重写")
    args = ap.parse_args()

    # ── 0. 输入缺失降级(09-23 清理后重跑场景)────────────────────
    have_int8 = os.path.exists(INT8)
    have_src = os.path.exists(os.path.join(SRC_DIR, "model.safetensors.index.json"))
    if not (have_int8 and have_src):
        if os.path.exists(OUT):
            print(f"输入缺失(int8 件在位={have_int8}, 原版暂存在位={have_src}),"
                  "降级为输出件内禀自检")
            verify_standalone()
            return
        raise SystemExit(f"输入缺失(int8={have_int8}, 原版暂存={have_src})"
                         "且无可自检的输出件,无法转换")

    # ── 1. 读三份 manifest ─────────────────────────────────────────
    int8_hdr, _, _ = read_header(INT8)
    quant_suffix = (".weight_scale", ".comfy_quant")
    int8_weights = {k: v for k, v in int8_hdr.items()
                    if not k.endswith(quant_suffix)}
    n_scale = sum(1 for k in int8_hdr if k.endswith(".weight_scale"))
    n_quant = sum(1 for k in int8_hdr if k.endswith(".comfy_quant"))
    print(f"int8 件:{len(int8_hdr)} 键 = 权重 {len(int8_weights)}"
          f" + weight_scale {n_scale} + comfy_quant {n_quant}(量化键全丢弃)")
    dts = {}
    for v in int8_weights.values():
        dts[v["dtype"]] = dts.get(v["dtype"], 0) + 1
    print(f"  权重 dtype 分布:{dts}")

    index = json.load(open(os.path.join(SRC_DIR, "model.safetensors.index.json")))
    weight_map = index["weight_map"]
    print(f"原版 index:{len(weight_map)} 键,分片 {sorted(set(weight_map.values()))}")

    # ── 2. 键集双向核对(铁律:任何一侧多键即停)──────────────────
    only_int8 = sorted(set(int8_weights) - set(weight_map))
    only_orig = sorted(set(weight_map) - set(int8_weights))
    print(f"仅 int8 有:{only_int8 or '无'} | 仅原版有:{only_orig or '无'}")
    assert not only_int8 and not only_orig, "键集非双射,停!"

    # ── 3. 分片头读取:dtype/shape 核对 + 拷贝计划 ─────────────────
    shard_hdr = {}
    for shard in sorted(set(weight_map.values())):
        h, meta, data_start = read_header(os.path.join(SRC_DIR, shard))
        assert meta is None or meta.get("format", "pt") == "pt", f"{shard}: metadata 异常 {meta}"
        shard_hdr[shard] = h
        # 分片头键集须与 index 对该分片的登记一致
        reg = {k for k, s in weight_map.items() if s == shard}
        assert set(h) == reg, f"{shard}: 分片头与 index 登记不一致"
    bad_dtype = sorted({k for k, v in shard_hdr[shard].items()
                        for shard in [weight_map[k]] if v["dtype"] != "BF16"})
    assert not bad_dtype, f"原版存在非 BF16 张量(违背预期,须人工裁定):{bad_dtype[:10]}"
    print("原版全部 760 张量 dtype=BF16 ✓;分片头与 index 逐分片一致 ✓")

    for k, v in int8_weights.items():
        assert list(v["shape"]) == list(shard_hdr[weight_map[k]][k]["shape"]), \
            f"shape 不一致:{k}"

    # 数据区布局:键名字典序(可复现);偏移由此唯一确定
    out_order = sorted(int8_weights)
    offsets, cursor = {}, 0
    for k in out_order:
        so = shard_hdr[weight_map[k]][k]["data_offsets"]
        nbytes = so[1] - so[0]  # safetensors 头无 nbytes,由 data_offsets 差推
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
    print(f"计划:760 键 / 数据 {total / 1e9:.3f} GB / 期望文件 {expect_size / 1e9:.3f} GB")

    # ── 4. 写出(已存在且自检绿则跳过,幂等)───────────────────────
    if os.path.exists(OUT) and not args.force:
        print(f"输出件已存在,跳过重写(自检继续):{OUT}")
    else:
        import tempfile
        fd, tmp = tempfile.mkstemp(dir=os.path.dirname(OUT),
                                   prefix=".qwen21_pe_bf16_", suffix=".tmp")
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
                        for k in sorted(k for k, s in weight_map.items() if s == shard):
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

    # ── 5. 自检:大小 + 键数 + 抽样逐位 ───────────────────────────
    actual = os.path.getsize(OUT)
    assert actual == expect_size, f"文件大小 {actual} != 期望 {expect_size}"
    print(f"自检·文件大小:{actual:,} B == 期望 {expect_size:,} B ✓")

    import torch
    from safetensors import safe_open
    with safe_open(OUT, framework="pt", device="cpu") as fo:
        out_keys = set(fo.keys())
        assert out_keys == set(int8_weights), \
            f"输出键数 {len(out_keys)} != {len(int8_weights)}"
        print(f"自检·键数:{len(out_keys)}(760 权重键,零量化键)✓")

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
            print(f"自检·抽样 {k}: dtype={t_out.dtype} shape={tuple(t_out.shape)} 与原版逐位相等 ✓")
        # int8 件 BF16 直存键等价(证明与可加载先例的非量化部分一致)
        with safe_open(INT8, framework="pt", device="cpu") as f8:
            for k in ("model.language_model.layers.0.linear_attn.conv1d.weight",
                      "model.language_model.layers.0.input_layernorm.weight",
                      "model.language_model.layers.0.linear_attn.A_log",
                      "model.language_model.layers.0.linear_attn.dt_bias"):
                assert torch.equal(f8.get_tensor(k), fo.get_tensor(k)), \
                    f"与 int8 BF16 直存键不等:{k}"
            print("自检·int8 件 BF16 直存键抽样(conv1d/norm/A_log/dt_bias)逐位相等 ✓")
    print("✅ 全部自检通过:", OUT)


if __name__ == "__main__":
    main()
