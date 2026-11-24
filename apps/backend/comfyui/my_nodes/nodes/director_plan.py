"""director_plan.py — 导演台执行链的计划层(纯函数,无头可测;1124 超线文件拆分:自 director_executor.py 原样搬出)。

产物目录规范常量、计划解析、种子与潜变量指纹、中断分类、参考图预算、参考音频名归一、
段间连续性(衔接图/参考名预算)、画面序号平移、章级 ffmpeg 拼接。
director_executor.py 经 from .director_plan import … 使用并转出口;外部仍可经 director_executor.<名字> 访问。
"""

from __future__ import annotations

from typing import Callable
from .my_director_console import DIRECTOR_RECIPE
from pathlib import Path
import re


# ── 产物目录规范(PRD R1.3 ⑤):video/导演台/{章节}/{镜id}/p1-draft|…────
OUT_DIR_ROOT = "video/导演台"
P1_NAME, P2_NAME, P3_NAME = "p1-draft", "p2-final", "p3-recavsr"
DRAFT_NAME, FINAL_NAME = "章草片", "章终片"

PASS1_W, PASS1_H = DIRECTOR_RECIPE["first_pass_resolution"]    # 960×544
PASS2_W, PASS2_H = DIRECTOR_RECIPE["second_pass_resolution"]   # 1440×832


# ── 计划解析(纯函数,无头可测)────────────────────────────────────────

def artifact_prefix(chapter: str, seg_id: str, name: str) -> str:
    return f"{OUT_DIR_ROOT}/{chapter}/{seg_id}/{name}"


def resolve_plan(state: dict, list_output: Callable[[str], list],
                 ) -> tuple[list[dict], list[str], dict]:
    """阶段勾选×逐镜×盘上检查点 → (运行清单, 错误清单, 产物登记)。

    - 勾啥跑啥:勾1=每镜 do=[yicai];1+2=[yicai,ercai];2单独:盘上有 p1 的镜
      do=[ercai](latent 由执行链重采样),无 p1 → 逐镜点名
    - 检查点:list_output(prefix) 命中即已完(artifacts 登记,跳过);
      rerun=True=强制覆盖该镜所有已勾阶段
    """
    stages = state["stages"]
    segs = state["segments"]
    errors: list[str] = []
    runs: list[dict] = []
    artifacts: dict[str, dict] = {}

    if not any(stages.values()):
        return [], ["未勾任何阶段(勾啥跑啥:一采/二采/三采至少勾一)"], artifacts
    if not segs:
        return [], ["零素材组:先在面板添加第一组再运行"], artifacts
    # 1115 逐段参与运行:segs 非空但全部 skip=无可运行(与既有两门共存)
    if all(seg.get("skip") is True for seg in segs):
        return [], ["全部镜已勾选跳过,无可运行"], artifacts

    def hit(prefix: str) -> str | None:
        # 视频扩展名白名单(纵深:.latent/.bak 恒不入产物册;1114 整章二发勘误)
        found = [p for p in (list_output(prefix) or [])
                 if p.lower().endswith((".mp4", ".webm", ".mov", ".mkv"))]
        return found[0] if found else None

    for i, seg in enumerate(segs):
        if seg.get("skip") is True:
            # 1115 逐段参与运行:循环首(在 hit()/缺上游点名/rerun 读取之前)
            # ——skip 段零 todo/零产物登记/不报缺上游;skip 与 rerun 并存=skip 胜
            artifacts[seg["id"]] = {}
            continue
        chapter = state["chapter"]
        p1 = hit(artifact_prefix(chapter, seg["id"], P1_NAME))
        p2 = hit(artifact_prefix(chapter, seg["id"], P2_NAME))
        p3 = hit(artifact_prefix(chapter, seg["id"], P3_NAME))
        rerun = seg.get("rerun") is True
        art: dict[str, str | None] = {}

        todo: list[str] = []
        if stages["yicai"]:
            if rerun or not p1:
                todo.append("yicai")
            else:
                art["p1"] = p1  # 检查点命中:跳过(二采仍可吃其确定性重采样)
        if stages["ercai"]:
            if stages["yicai"] or p1:
                todo.append("ercai")
            else:
                errors.append(f"第{i + 1}镜({seg['id']})无p1,先跑一采")
        elif p2 and not (rerun and stages["yicai"]):
            art["p2"] = p2
        if stages["sancai"]:
            if stages["ercai"] or p2:
                todo.append("sancai")
            else:
                errors.append(f"第{i + 1}镜({seg['id']})无p2,先跑二采(或勾1+2+3全链)")
        elif p3 and not rerun:
            art["p3"] = p3
        # 盘上已有产物全量登记(面板产物槽点亮;重跑项由执行链落盘后覆盖)
        for key, hit_path in (("p1", p1), ("p2", p2), ("p3", p3)):
            if hit_path and key not in art:
                art[key] = hit_path
        if todo:
            runs.append({"index": i, "seg": seg, "do": todo})
        artifacts[seg["id"]] = art
    return runs, errors, artifacts


def assemble_prompt(seg: dict) -> str:
    """四段提示词 → 单文(非空段空行接;面板=唯一交互真源)。"""
    p = seg.get("prompt") or {}
    parts = [p.get(k, "") for k in ("summary", "retention", "description", "soundscape")]
    return "\n\n".join(x for x in parts if x and x.strip())


def effective_seed(state: dict, seg: dict) -> int:
    """seed:组级覆盖优先,空=继承全局(PRD R1.7)。"""
    seed = seg.get("seed")
    if seed is None:
        seed = state["common_params"]["seed"]
    return int(seed)


# ── 中断分类(纯函数;gap8:中断与真错误可辨)──────────────────────────

INTERRUPT_EXC_NAME = "InterruptProcessingException"


def classify_interrupt(exc: BaseException) -> bool:
    """用户中断判定:InterruptProcessingException(引擎 nodes/utils 与
    comfy.model_management 双模块候选 import+类名兜底)→True(=取消);
    其余异常 False(调用方须原样上抛,不再吞成「取消」)。"""
    if type(exc).__name__ == INTERRUPT_EXC_NAME:
        return True
    import importlib
    for mod_name in ("nodes", "comfy.model_management"):
        try:
            mod = importlib.import_module(mod_name)
        except Exception:
            continue
        cls = getattr(mod, INTERRUPT_EXC_NAME, None)
        if isinstance(cls, type) and isinstance(exc, cls):
            return True
    return False


# ── 参考图预算口径(1114 用户裁定,与 App 组装器 buildShotH3SancaiApiWorkflow
#    同源):17000 实测 异图≥9 或 大参考数×max=引擎原生崩,8异图×match 稳;
#    槽≤9(AUTOGROW ref_image_0..8),异图按名去重≤8(重复图不占预算)───
REF_SLOT_LIMIT = 9
REF_DISTINCT_LIMIT = 8


def budget_ref_items(keys, slots=REF_SLOT_LIMIT,
                     distinct=REF_DISTINCT_LIMIT):
    """预算单源:keys 按槽序(名或无名张量伪名);重复键不占预算,
    超 slots/distinct 截尾。返回(保留下标序, 异图数, 弃件下标)。"""
    seen: set = set()
    keep: list[int] = []
    drop: list[int] = []
    for j, key in enumerate(keys):
        if key in seen:
            keep.append(j)
        elif len(seen) < distinct and len(keep) < slots:
            seen.add(key)
            keep.append(j)
        else:
            drop.append(j)
    return keep, len(seen), drop


def budget_ref_names(names, slots=REF_SLOT_LIMIT,
                     distinct=REF_DISTINCT_LIMIT):
    """名版预算(ref_name_list/调试壳共用):返回(保留名序, 异图数, 弃名)。"""
    keys = [n for n in names if n]
    keep, n_distinct, drop = budget_ref_items(keys, slots, distinct)
    return ([keys[j] for j in keep], n_distinct,
            [keys[j] for j in drop])


def ref_name_list(state: dict, seg: dict) -> list[str]:
    """r2v 参考图名序列=公共(角色卡,Picture 1-3)+本组(分镜帧,4+);
    9槽/8异图预算(超预算截尾,面板 <Picture N> 语义按保留序)。"""
    names = (state.get("common_images") or []) + (seg.get("images") or [])
    kept, _, _ = budget_ref_names(names)
    return kept


# ── 参考音频(1115 缺口5):引擎 AUTOGROW ref_audio_0..2=max 3(JZL H3
#    nodes.py 实证),面板 <Audio J> 编号=运行时列,归一面去重帽3收敛──

MAX_AUDIO_REFS = 3


def normalize_audio_names(names) -> list:
    """音频名归一:按名去重保序+帽 MAX_AUDIO_REFS(修E:与 serial.js/
    _normalize_segment 同构;手改/外部导入的超限在归一面收敛,chips 编号
    恒不悬空)。"""
    seen: set = set()
    out: list[str] = []
    for n in names or []:
        n = str(n or "").strip()
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out[:MAX_AUDIO_REFS]


# ── 段间连续性(1115 缺口7):pass1 第 i>0 镜参考图首槽插上一镜衔接图 ──

_PICTURE_TAG = re.compile(r"<Picture (\d+)>")


def shift_picture_tags(prompt, offset: int):
    """<Picture N> 标签平移(衔接图占首槽后,用户标签整体 +offset);
    无标签原样透传。"""
    text = str(prompt or "")
    if offset == 0 or "<Picture " not in text:
        return text
    return _PICTURE_TAG.sub(
        lambda m: f"<Picture {int(m.group(1)) + offset}>", text)


def continuity_ref_names(names, cont_key):
    """衔接版参考名预算:cont_key=None→budget_ref_names 原面;否则 cont
    恒 slot1,余量 slots-1/distinct-1 给 user 尾弃(引擎 ref_image_0..8
    =9 槽硬帽)。返回(保留名序, 异图数, 弃名)。"""
    names = [n for n in (names or []) if n]
    if not cont_key:
        return budget_ref_names(names)
    return budget_ref_names([str(cont_key)] + names)


def resolve_continuity(state, artifacts, index, hooks, log=None):
    """上一参与(非 skip)镜的衔接图解析 → (input名, 身份) | None。

    身份=f"{名}@{前镜p1 mtime_ns}"(经 hooks.output_path(rel).stat();
    不可用=裸名回退)——前镜 p1 重产→mtime 变→后镜 ☑2 latent 指纹变→
    陈缓存作废(修D)。前镜 p1(册或盘 glob)→grab_last_frame 恒覆盖写
    落 input/(幂等跳过废除:前镜重跑后旧帧即过期,恒重写=恒新);
    gf 失败→fallback 前镜首张参考图;再无→跳注入留痕。legacy/无头钩子
    面无 grab_last_frame=首行守卫跳过(修B:不炸,现状断言不动)。
    """
    log = log or (lambda *a: None)
    gf = getattr(hooks, "grab_last_frame", None)
    if not callable(gf):
        log("段间引导 跳过(无 grab_last_frame 钩子,legacy/无头钩子面)")
        return None
    if state.get("continuity") is False:  # 默认开:仅显式 False 关
        return None
    prev = None
    for cand in reversed((state.get("segments") or [])[:index]):
        if cand.get("skip") is not True:
            prev = cand
            break
    if prev is None:
        return None
    chapter = state["chapter"]
    p1 = (artifacts.get(prev.get("id")) or {}).get("p1")
    if not p1:
        hits = [p for p in (hooks.list_output(
            artifact_prefix(chapter, prev["id"], P1_NAME)) or [])
            if p.lower().endswith((".mp4", ".webm", ".mov", ".mkv"))]
        p1 = hits[0] if hits else None
    if p1:
        target = f"daoyan-cont-{chapter}-{prev['id']}.png"
        try:
            grabbed = gf(p1, target)
        except Exception:  # noqa: BLE001 - 抓帧失败=fallback 面,不咬主路
            grabbed = None
        if grabbed:
            mtime_ns = None
            op = getattr(hooks, "output_path", None)
            if callable(op):
                try:
                    p = op(p1)
                    if p is not None:
                        mtime_ns = p.stat().st_mtime_ns
                except OSError:
                    mtime_ns = None
            return target, (f"{target}@{mtime_ns}"
                            if mtime_ns is not None else target)
    fallback = ref_name_list(state, prev)
    if fallback:
        return fallback[0], fallback[0]
    log(f"段间引导 跳过(前镜 {prev.get('id')} 无 p1 无参考图,无可注入)")
    return None


FFMPEG_TIERS = ("copy", "copy+hvc1", "x264")


def ffmpeg_concat(out_dir, rels, out_rel, log, run_cmd=None) -> bool:
    """章级拼接(单源;批量役 concat 同式:cwd=清单同目录+相对条目)。

    引擎侧 ffmpeg 构建对 HEVC-in-mp4 直拷会败(1114 R3 定谳:p3=hevc
    2K,p1=h264 可拷)——分级降挡:copy → copy+hvc1 标签 → 末档 x264 转码
    (保底出片);逐挡留痕(挡N(名) rc=/成功)。run_cmd 注入=无头可测。
    """
    import os
    import subprocess
    if run_cmd is None:
        run_cmd = subprocess.run
    log = log or (lambda *a: None)
    out_dir = Path(out_dir)
    out = out_dir / out_rel
    out.parent.mkdir(parents=True, exist_ok=True)
    lst = out.with_suffix(".txt")
    entries = "".join(
        "file '%s'\n" % os.path.relpath(out_dir / r, out.parent)
        .replace("\\", "/")
        for r in rels)
    lst.write_text(entries, encoding="utf-8")
    base = ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
            "-i", lst.name]
    stages = (
        [*base, "-c", "copy", out.name],
        [*base, "-c", "copy", "-tag:v", "hvc1", out.name],
        [*base, "-c:v", "libx264", "-preset", "veryfast", "-crf", "16",
         "-c:a", "copy", out.name],
    )
    last_err = None
    for i, (tier, args) in enumerate(zip(FFMPEG_TIERS, stages), 1):
        proc = run_cmd(args, cwd=str(out.parent), capture_output=True,
                       text=True)
        rc = getattr(proc, "returncode", 1)
        stderr = (getattr(proc, "stderr", "") or "").strip()
        if rc == 0:
            lst.unlink(missing_ok=True)
            log(f"ffmpeg 挡{i}({tier}) 成功")
            return True
        last_err = stderr[-300:]
        log(f"ffmpeg 挡{i}({tier}) rc={rc} stderr尾={stderr[-120:]!r}")
    raise RuntimeError(f"ffmpeg 章级拼接三挡全败:{out.name}:{last_err}")
