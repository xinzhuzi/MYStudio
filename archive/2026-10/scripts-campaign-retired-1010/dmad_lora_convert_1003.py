#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DMAD(arXiv 2610.02188)MiniMax-H3 4-step LoRA → ComfyUI 格式转制脚本。

任务:.trellis/tasks/10-03-dmad-h3-4step-lora/ S2(implement.md S2.1)
数学与键映射唯一真源:同任务 design.md §1(转制数学)§2(键映射)。

源件(原版 H3 仓库命名,分离式 qkv;2026-10-03 实读 /tmp/dmad_ab/dmad_full_critic.safetensors):
  624 tensors = 312 模块位 × 2(down/up),无 alpha 键(→ ComfyUI scale=1.0)
  - 主块 50:transformer_blocks.{0..49}.attn.{to_q,to_k,to_v,to_out.0} + ff.net.0.proj + ff.net.2
  - refiner 2:token_refiner.refiner_blocks.{0,1}.* 同构
  - 命名混合风格:attn 模块 `.lora.down/up.weight`;ff 模块 `.lora_A/B.weight`(A=down,B=up)

目标件(ComfyUI Kohya 风格,与在役 8step 件同款;comfy/weight_adapter/lora.py:159-172 首选):
  diffusion_model.blocks.N.attn.qkv_proj.lora_down/up.weight   <- 融合(见下)
  diffusion_model.blocks.N.attn.out_proj.lora_down/up.weight    <- 直接改名搬运
  diffusion_model.blocks.N.mlp.fc1.lora_down/up.weight          <- 直接改名搬运
  diffusion_model.blocks.N.mlp.fc2.lora_down/up.weight          <- 直接改名搬运
  diffusion_model.token_refiner.blocks.N.*(同构)

转制数学(design.md §1,精确无损,不引入近似):
  down_fused = concat([down_q, down_k, down_v], dim=0)   # [3r, in]
  up_fused   = block_diag(up_q, up_k, up_v)              # [3out_total, 3r] 稠密存(含零块)
  Δ_fused    = up_fused @ down_fused == concat([Δ_q, Δ_k, Δ_v], dim=0)  逐块精确相等

断言与自检(design.md §1「断言与自检」四条,全部内置):
  1) 维度断言:sum(out_q,out_k,out_v) == 基座 qkv_proj 行数(基座头实读);
  2) 数值等价自检:抽 1 个 transformer 块,fp32 验证融合积行块 == 各自 up@down;
  3) 静态键校验:输出键剥 diffusion_model. 前缀后 ⊆ 基座键集;源模块位 == 312;
  4) --qkv-order 可换序(R4:本件 q/k/v 三头同维 7168,维度无法锁序,默认 qkv,
     若 A/B 预检崩坏换序重转重跑)。

幂等:输出键序固定(sorted),数值确定,bf16;重跑字节相同(外部 cmp 验证)。
"""

import argparse
import os
import re
import sys
import tempfile
from collections import OrderedDict

import torch
from safetensors import safe_open
from safetensors.torch import save_file

# ---------------- 常量:映射表(design.md §2 / research/dmad-verified-facts.md §4) ----------------

SRC_SUFFIX_ROLES = [
    (".lora.down.weight", "down"),
    (".lora.up.weight", "up"),
    (".lora_A.weight", "down"),  # diffusers PEFT 风:A=down [r,in]
    (".lora_B.weight", "up"),    # B=up [out,r]
]

# 源模块尾 → (目标叶, 角色)。qkv:q 表示参与 qkv_proj 融合的第 q 路。
SRC_TAIL_MAP = {
    "attn.to_q": ("attn.qkv_proj", "qkv:q"),
    "attn.to_k": ("attn.qkv_proj", "qkv:k"),
    "attn.to_v": ("attn.qkv_proj", "qkv:v"),
    "attn.to_out.0": ("attn.out_proj", "direct"),
    "ff.net.0.proj": ("mlp.fc1", "direct"),
    "ff.net.2": ("mlp.fc2", "direct"),
}

SRC_BLOCK_PREFIXES = [
    (re.compile(r"^transformer_blocks\.(\d+)\."), "blocks.{n}."),
    (re.compile(r"^token_refiner\.refiner_blocks\.(\d+)\."), "token_refiner.blocks.{n}."),
]

EXPECTED_MODULE_SLOTS = 312  # 52 块(50 主 + 2 refiner)× 6 模块位
OUT_PREFIX = "diffusion_model."
QKV_ORDERS = ["qkv", "qvk", "kqv", "kvq", "vqk", "vkq"]

DEFAULT_INPUT = "/tmp/dmad_ab/dmad_full_critic.safetensors"
DEFAULT_BASE = (
    "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/"
    "models/diffusion_models/minimax_h3_fl2va_pruned_bf16.safetensors"
)
DEFAULT_OUTPUT = (
    "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui/"
    "models/loras/dmad_minimax_h3_4step_full_critic_comfyui_bf16.safetensors"
)


# ---------------- 头扫描(零数据读) ----------------


def slice_dtype(f, key):
    """头级 dtype 字符串(不读 tensor 数据);不可用则退化为实读一个小 tensor。"""
    try:
        return str(f.get_slice(key).get_dtype())
    except Exception:
        return str(f.get_tensor(key).dtype)


def split_src_key(key):
    """源键 → (源模块名, down/up 角色);不认识的后缀返回 (None, None)。"""
    for suf, role in SRC_SUFFIX_ROLES:
        if key.endswith(suf):
            return key[: -len(suf)], role
    return None, None


def map_src_module(mod):
    """源模块名 → (目标模块名[无前缀], 角色);无法映射返回 None。"""
    for rx, dst_fmt in SRC_BLOCK_PREFIXES:
        m = rx.match(mod)
        if not m:
            continue
        rest = mod[m.end():]
        hit = SRC_TAIL_MAP.get(rest)
        if hit is None:
            return None
        leaf, role = hit
        return dst_fmt.format(n=m.group(1)) + leaf, role
    return None


# ---------------- 计划构建 + 断言(dry-run 全覆盖此段) ----------------


class Plan:
    def __init__(self):
        # direct 条目:dst_module -> dict(src_module=..., down_key=..., up_key=...)
        self.direct = OrderedDict()
        # qkv 条目:dst_module -> {"q": (down_key,up_key,down_shape,up_shape), ...}
        self.qkv = OrderedDict()
        self.src_module_count = 0
        self.src_dtype = None


def scan_and_plan(input_path, base_path, qkv_order):
    failures = []

    def check(cond, msg):
        if not cond:
            failures.append(msg)
        return cond

    # --- 源扫描 ---
    with safe_open(input_path, framework="pt") as f:
        src_keys = sorted(f.keys())
        src_shapes = {k: tuple(f.get_slice(k).get_shape()) for k in src_keys}
        src_dtype = slice_dtype(f, src_keys[0])

    plan = Plan()
    plan.src_dtype = src_dtype
    mods = {}  # src_module -> {"down": key, "up": key}
    for k in src_keys:
        mod, role = split_src_key(k)
        if mod is None:
            failures.append(f"源键后缀不可识别: {k}")
            continue
        mapped = map_src_module(mod)
        if mapped is None:
            failures.append(f"源模块不可映射: {mod}")
            continue
        mods.setdefault(mod, {})[role] = k
    plan.src_module_count = len(mods)

    for mod, pair in mods.items():
        if "down" not in pair or "up" not in pair:
            failures.append(f"源模块 {mod} 缺 down/up 配对(现有 {sorted(pair)})")

    # --- 基座扫描(键集 + shape) ---
    with safe_open(base_path, framework="pt") as f:
        base_keys = set(f.keys())
        base_shapes = {k: tuple(f.get_slice(k).get_shape()) for k in f.keys()}

    # --- 分组 ---
    for mod in sorted(mods):
        dst, role = map_src_module(mod)
        if role == "direct":
            plan.direct[dst] = {
                "src_module": mod,
                "down_key": mods[mod]["down"],
                "up_key": mods[mod]["up"],
            }
        else:
            part = role.split(":")[1]  # qkv:q -> q
            plan.qkv.setdefault(dst, {})[part] = {
                "src_module": mod,
                "down_key": mods[mod]["down"],
                "up_key": mods[mod]["up"],
                "down_shape": src_shapes[mods[mod]["down"]],
                "up_shape": src_shapes[mods[mod]["up"]],
            }

    # --- 断言 3(静态键校验,前半):源模块位 == 312 ---
    check(
        plan.src_module_count == EXPECTED_MODULE_SLOTS,
        f"源模块位 {plan.src_module_count} != 期望 {EXPECTED_MODULE_SLOTS}",
    )

    # --- 每 qkv 条目三路齐 + 断言 1(维度断言)+ rank/in 一致性 ---
    for dst, parts in plan.qkv.items():
        missing = [p for p in ("q", "k", "v") if p not in parts]
        if missing:
            failures.append(f"qkv 位 {dst} 缺路 {missing}")
            continue
        base_key = dst + ".weight"
        if base_key not in base_shapes:
            failures.append(f"基座无 qkv 键 {base_key}")
            continue
        base_rows, base_cols = base_shapes[base_key]
        in_dims = set()
        out_total = 0
        for p in qkv_order:
            d_sh = parts[p]["down_shape"]
            u_sh = parts[p]["up_shape"]
            check(len(d_sh) == 2 and len(u_sh) == 2, f"{dst} 路 {p} 非二维: {d_sh} {u_sh}")
            check(
                d_sh[0] == u_sh[1],
                f"{dst} 路 {p} rank 不一致: down {d_sh} vs up {u_sh}",
            )
            in_dims.add(d_sh[1])
            out_total += u_sh[0]
        check(
            len(in_dims) == 1,
            f"{dst} 三路输入维互异 {in_dims}(基座 qkv 只有一个输入维)",
        )
        check(
            in_dims == {base_cols},
            f"{dst} 输入维 {in_dims} != 基座 qkv 输入维 {base_cols}",
        )
        check(
            out_total == base_rows,
            f"【维度断言失败】{dst}: sum(out_q,out_k,out_v)={out_total} "
            f"!= 基座 qkv_proj 行数 {base_rows}",
        )

    # --- direct 条目维度断言 ---
    for dst, ent in plan.direct.items():
        base_key = dst + ".weight"
        if base_key not in base_shapes:
            failures.append(f"基座无 direct 键 {base_key}")
            continue
        base_rows, base_cols = base_shapes[base_key]
        d_sh = src_shapes[ent["down_key"]]
        u_sh = src_shapes[ent["up_key"]]
        check(len(d_sh) == 2 and len(u_sh) == 2, f"{dst} 非二维: {d_sh} {u_sh}")
        check(d_sh[0] == u_sh[1], f"{dst} rank 不一致: down {d_sh} vs up {u_sh}")
        check(d_sh[1] == base_cols, f"{dst} down 输入维 {d_sh[1]} != 基座 {base_cols}")
        check(u_sh[0] == base_rows, f"{dst} up 输出维 {u_sh[0]} != 基座 {base_rows}")

    # --- 断言 3(静态键校验,后半):输出键剥前缀 ⊆ 基座键集 ---
    out_modules = sorted(set(plan.direct) | set(plan.qkv))
    for dst in out_modules:
        if dst + ".weight" not in base_keys:
            failures.append(f"输出模块 {dst} 剥 {OUT_PREFIX!r} 前缀后不在基座键集")

    return plan, base_shapes, src_shapes, failures, src_dtype


# ---------------- 统计打印 ----------------


def print_stats(plan, src_shapes, qkv_order, failures):
    n_direct = len(plan.direct)
    n_qkv = len(plan.qkv)
    n_out_tensors = (n_direct + n_qkv) * 2
    print(f"  源模块位        : {plan.src_module_count}(期望 {EXPECTED_MODULE_SLOTS})")
    print(f"  源 dtype        : {plan.src_dtype}")
    print(f"  qkv 融合位      : {n_qkv}(每位 3 对 down/up → 融合 2 tensors)")
    print(f"  direct 搬运位   : {n_direct}(改名搬运 2 tensors)")
    print(f"  输出 tensor 数  : {n_out_tensors}")
    print(f"  qkv 拼接顺序    : {qkv_order}")
    for dst, parts in list(plan.qkv.items())[:1]:
        base_key = dst + ".weight"
        shapes = {p: (parts[p]["down_shape"], parts[p]["up_shape"]) for p in qkv_order}
        outs = [parts[p]["up_shape"][0] for p in qkv_order]
        print(f"  qkv 样例({dst}) : 基座 {base_key}")
        for p in qkv_order:
            d_sh, u_sh = shapes[p]
            print(f"    路 {p}: down {tuple(d_sh)} / up {tuple(u_sh)}")
        print(f"    → down_fused {(sum(parts[p]['down_shape'][0] for p in qkv_order), parts[qkv_order[0]]['down_shape'][1])}"
              f" / up_fused {(sum(outs), sum(parts[p]['down_shape'][0] for p in qkv_order))}(block_diag,零块稠密存)")
        same_dim = len(set(outs)) == 1
        if same_dim:
            print(f"    ⚠ R4:三头同维 {outs}——维度断言无法锁拼接顺序,当前按 --qkv-order {qkv_order} 假设;")
            print(f"      若 A/B 预检崩坏,换 --qkv-order 重转重跑(design.md §1 断言4)")
    # 预估输出体积
    nbytes = 0
    for dst, parts in plan.qkv.items():
        nbytes += sum(parts[p]["down_shape"][0] for p in qkv_order) * parts[qkv_order[0]]["down_shape"][1] * 2
        ranks = sum(parts[p]["down_shape"][0] for p in qkv_order)
        outs = sum(parts[p]["up_shape"][0] for p in qkv_order)
        nbytes += outs * ranks * 2
    for dst, ent in plan.direct.items():
        d_sh = src_shapes[ent["down_key"]]
        u_sh = src_shapes[ent["up_key"]]
        nbytes += (d_sh[0] * d_sh[1] + u_sh[0] * u_sh[1]) * 2
    print(f"  预估输出体积    : {nbytes / 1024**3:.2f} GiB(bf16)")
    if failures:
        print(f"\n  断言失败 {len(failures)} 条:")
        for msg in failures[:20]:
            print(f"    - {msg}")
        if len(failures) > 20:
            print(f"    ...(共 {len(failures)} 条)")


# ---------------- 输出 tensor 构造 ----------------


def build_output_tensors(input_path, plan, qkv_order):
    with safe_open(input_path, framework="pt") as f:
        out = {}
        # direct:改名搬运(零数学变换)
        for dst, ent in plan.direct.items():
            d = f.get_tensor(ent["down_key"]).to(torch.bfloat16)
            u = f.get_tensor(ent["up_key"]).to(torch.bfloat16)
            out[OUT_PREFIX + dst + ".lora_down.weight"] = d.contiguous()
            out[OUT_PREFIX + dst + ".lora_up.weight"] = u.contiguous()
        # qkv:融合数学
        for dst, parts in plan.qkv.items():
            downs = [f.get_tensor(parts[p]["down_key"]).to(torch.bfloat16) for p in qkv_order]
            ups = [f.get_tensor(parts[p]["up_key"]).to(torch.bfloat16) for p in qkv_order]
            down_fused = torch.cat(downs, dim=0)
            n_out = sum(u.shape[0] for u in ups)
            n_rank = sum(d.shape[0] for d in downs)
            up_fused = torch.zeros((n_out, n_rank), dtype=torch.bfloat16)
            r0 = c0 = 0
            for d, u in zip(downs, ups):
                up_fused[r0 : r0 + u.shape[0], c0 : c0 + d.shape[0]] = u
                r0 += u.shape[0]
                c0 += d.shape[0]
            out[OUT_PREFIX + dst + ".lora_down.weight"] = down_fused.contiguous()
            out[OUT_PREFIX + dst + ".lora_up.weight"] = up_fused.contiguous()
    # 键序固定(sorted)→ 幂等
    return OrderedDict(sorted(out.items()))


# ---------------- 自检(design.md §1 断言2:数值等价;附结构全量 bitwise) ----------------


def self_check(input_path, output_path, plan, qkv_order, block=0):
    """实跑后从两件重读验证。

    (a) 结构全量 bitwise:direct 模块逐位相等;qkv down 行段逐位相等、up 对角块逐位相等、
        非对角块全零(concat/block_diag 是精确操作,bf16 无损,应逐位相等);
    (b) 数值等价(design 口径):抽 transformer_blocks.{block},fp32 验证
        (up_fused @ down_fused) 的三个行块 == 各自 up_p @ down_p。
    """
    problems = []
    max_rel = 0.0
    with safe_open(input_path, framework="pt") as fi, safe_open(output_path, framework="pt") as fo:
        # (a1) direct 全量 bitwise
        n_checked = 0
        for dst, ent in plan.direct.items():
            for role, suffix in (("down", ".lora_down.weight"), ("up", ".lora_up.weight")):
                src_t = fi.get_tensor(ent[f"{role}_key"])
                out_t = fo.get_tensor(OUT_PREFIX + dst + suffix)
                if not torch.equal(src_t.to(torch.bfloat16), out_t):
                    problems.append(f"direct bitwise 不等: {dst}{suffix}")
                n_checked += 1
        # (a2) qkv 结构 bitwise
        # 注意两套游标:up_fused 行段按 out 维(7168)累加;down_fused 行段按 rank(128)累加。
        n_qkv_checked = 0
        for dst, parts in plan.qkv.items():
            od = fo.get_tensor(OUT_PREFIX + dst + ".lora_down.weight")
            ou = fo.get_tensor(OUT_PREFIX + dst + ".lora_up.weight")
            r_out = 0  # up_fused 行游标(按各路 out 行数)
            c_rank = 0  # up_fused 列游标 / down_fused 行游标(按各路 rank)
            for p in qkv_order:
                d = fi.get_tensor(parts[p]["down_key"]).to(torch.bfloat16)
                u = fi.get_tensor(parts[p]["up_key"]).to(torch.bfloat16)
                if not torch.equal(od[c_rank : c_rank + d.shape[0]], d):
                    problems.append(f"qkv down 行段 bitwise 不等: {dst} 路 {p}")
                blk = ou[r_out : r_out + u.shape[0], c_rank : c_rank + d.shape[0]]
                if not torch.equal(blk, u):
                    problems.append(f"qkv up 对角块 bitwise 不等: {dst} 路 {p}")
                n_qkv_checked += 1
                r_out += u.shape[0]
                c_rank += d.shape[0]
            # 非对角全零:克隆后置零对角块,剩余应全零
            ou2 = ou.clone()
            r_out = c_rank = 0
            for p in qkv_order:
                d = fi.get_tensor(parts[p]["down_key"])
                u = fi.get_tensor(parts[p]["up_key"])
                ou2[r_out : r_out + u.shape[0], c_rank : c_rank + d.shape[0]] = 0
                r_out += u.shape[0]
                c_rank += d.shape[0]
            if not torch.all(ou2 == 0):
                problems.append(f"qkv up 非对角块非零: {dst}")
        # (b) 数值等价:抽 1 个 transformer 块
        src_prefix = f"transformer_blocks.{block}."
        dst_prefix = f"blocks.{block}."
        qkv_dst = OUT_PREFIX + dst_prefix + "attn.qkv_proj"
        downs_f = {
            p: fi.get_tensor(f"{src_prefix}attn.to_{p}.lora.down.weight").float()
            for p in qkv_order
        }
        ups_f = {
            p: fi.get_tensor(f"{src_prefix}attn.to_{p}.lora.up.weight").float()
            for p in qkv_order
        }
        od = fo.get_tensor(qkv_dst + ".lora_down.weight").float()
        ou = fo.get_tensor(qkv_dst + ".lora_up.weight").float()
        r0 = 0
        for p in qkv_order:
            u_f = ups_f[p]
            d_f = downs_f[p]
            fused_blk = ou[r0 : r0 + u_f.shape[0]] @ od  # 融合积的行块
            sep_blk = u_f @ d_f  # 分离积
            diff = (fused_blk - sep_blk).abs().max().item()
            scale = max(sep_blk.abs().max().item(), 1e-8)
            rel = diff / scale
            max_rel = max(max_rel, rel)
            if rel > 1e-3:
                problems.append(
                    f"数值等价失败: blocks.{block} 路 {p}: max|diff|={diff:.3e} "
                    f"rel={rel:.3e}(阈值 1e-3)"
                )
            r0 += u_f.shape[0]
    return problems, max_rel, n_checked, n_qkv_checked


# ---------------- main ----------------


def main():
    ap = argparse.ArgumentParser(
        description="DMAD MiniMax-H3 4-step LoRA → ComfyUI 融合 qkv 转制(design.md §1§2)"
    )
    ap.add_argument("--input", default=DEFAULT_INPUT, help="DMAD 源件(原版命名)")
    ap.add_argument("--base", default=DEFAULT_BASE, help="ComfyUI 基座(UNET 权重,头实读)")
    ap.add_argument("--output", default=DEFAULT_OUTPUT, help="输出 LoRA 件路径")
    ap.add_argument("--qkv-order", default="qkv", choices=QKV_ORDERS,
                    help="qkv 融合拼接顺序(默认 qkv;R4 三头同维时维度无法锁序)")
    ap.add_argument("--dry-run", action="store_true", help="只扫描+断言+统计,零写入")
    args = ap.parse_args()

    for label, path in (("input", args.input), ("base", args.base)):
        if not os.path.isfile(path):
            print(f"[FAIL] {label} 文件不存在: {path}")
            return 2
    if os.path.isdir(args.output):
        print(f"[FAIL] output 是目录: {args.output}")
        return 2
    qkv_order = list(args.qkv_order.replace("-", ""))
    assert sorted(qkv_order) == ["k", "q", "v"], "qkv-order 必须是 q/k/v 的排列"

    print(f"[1/4] 扫描源件  : {args.input}")
    print(f"[2/4] 扫描基座  : {args.base}")
    plan, base_shapes, src_shapes, failures, src_dtype = scan_and_plan(
        args.input, args.base, qkv_order
    )
    print(f"[3/4] 映射统计与断言(dry-run 同口径):")
    print_stats(plan, src_shapes, qkv_order, failures)
    if failures:
        print("\n[FAIL] 断言未全绿,中止(零写入)")
        return 1

    if args.dry_run:
        print(f"\n[DRY-RUN] 零写入,通过。目标(未写): {args.output}")
        return 0

    print(f"\n[4/4] 实跑转制 → {args.output}")
    out_tensors = build_output_tensors(args.input, plan, qkv_order)
    out_dir = os.path.dirname(args.output)
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(prefix=".dmad_convert_", suffix=".tmp", dir=out_dir)
    os.close(fd)
    try:
        save_file(out_tensors, tmp_path)
        os.replace(tmp_path, args.output)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    out_size = os.path.getsize(args.output)
    print(f"  写入完成: {len(out_tensors)} tensors, {out_size / 1024**3:.2f} GiB, bf16, 键序 sorted")

    print("  自检:结构全量 bitwise + 数值等价(抽 transformer_blocks.0,fp32)...")
    problems, max_rel, n_direct_tensors, n_qkv_slots = self_check(
        args.input, args.output, plan, qkv_order, block=0
    )
    print(f"    direct bitwise   : {n_direct_tensors} tensors 全等")
    print(f"    qkv 结构 bitwise : {n_qkv_slots} 融合位(行段/对角块逐位相等,非对角全零)")
    print(f"    数值等价         : 融合积行块 vs 分离积,最大相对偏差 {max_rel:.3e}(阈值 1e-3)")
    if problems:
        print(f"\n[FAIL] 自检失败 {len(problems)} 条:")
        for msg in problems[:20]:
            print(f"    - {msg}")
        return 1
    print("\n[PASS] 转制完成,断言+自检全绿(输出件保留供诊断口径:不因失败删除)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
