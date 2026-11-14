# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台执行链(11-13-director-console-remake 阶段3+3.5,1114)。

结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director(Apache-2.0)executor 的
「计划→逐段循环→finalize」三段式——布局复刻、代码重写;采样内部零重写:
**直接调引擎在册节点类**(NODE_CLASS_MAPPINGS),配方与接线逐位取自纯净化
母本(三采-单镜.json,66 节点),按引擎装载语义(widgets_values 位序对
required 键序)赋参=与母本实跑逐位同值。

三臂模型链(母本锚点):
- r2v 臂 [145→262→263→140]:flex_ref2va LoRA→BSA(sol-attn)→CFF(2,4096)
  →kitchen;guider 侧经 ModelPreviewOverrideKJ[266] 包 switch[218](True=r2v)
- i2v 臂 [216→260→261→217→251]:turbo_fl2va LoRA→BSA→CFF(2,4096)→kitchen
  →σ(6,3)[251];σ 臂恒供 BasicScheduler[250](母本接线原样:调度器读 σ 模型)
- 二采臂 [202→267→223→203→215]:taomate(0.7)→BSA→CFF(1,4096)→σ(12,3)
  →kitchen;guider[210] 读 kitchen 侧,scheduler[209] 读 σ 侧

阶段语义(PRD R1.5 勾啥跑啥;1112 批量役实证工艺同源):
- 勾1=逐镜一采→p1-draft→章草片;1+2=接二采→p2-final
- 1+2+3=/free 卸载→三采 ReCaVSR(文件化交接:output→input→LoadVideo,
  批量役 stage3 同工艺)→p3-recavsr→章终片
- ☑2 单独=吃盘上 p1 只落 p2(**一采重采样取 latent**:同 seed 确定性,
  批量役 stage2 同义——av_latent 是张量,mp4 不回得去,禁 VAEEncode 代差)
- 检查点=产物链在盘即跳过;重掷 rerun=True 强制覆盖(旧件挪 .bak)
- 取消=检查点语义:已完镜保留,章级拼接停

阶段3.5(1114 可观测+单源拆壳):
- 三采执行核抽为模块级显式参数函数(PassCtx 上下文;build_model_kit/
  pass1/pass2/pass3/emit_preview/ffmpeg_concat 单源)——DirectorExecutor
  方法变薄委托,三个调试薄壳节点(director_pass_nodes)共用同一真源;
  ffmpeg 三挡降挡上提=无头可测(run_cmd 注入)。
- RunLog 双落点(daoyan_runlog)贯穿:计划门控/三臂构建/阶段开始结束/
  条件构造 prompt 全文/潜放大形状/三采交接/落盘诊断/章级拼接逐挡/中断
  ——每行可独立回答审计一个 gap;Hooks.open_run_log 注入(缺省=空记录器)。
- 阶段级 try/except 全包(裸异常也带镜/阶段/seed/σ 上下文包装上抛)+
  失败终态事件(message 含「失败」,面板清 running 判据)+终态事件带
  chapter_outputs;daoyan_preview payload 对齐 live.js 消费契约
  ({node_id,segment_id,segment_index,step,total,url})。
- 中断分类 classify_interrupt:InterruptProcessingException→取消,其余
  异常原样上抛不再吞(采样 K 步内逐步行需改引擎本体=禁区不做,只在
  阶段边界检查)。

可注入式:classes/hooks 全可换=无头 pytest 伪类干跑(零引擎零 GPU);
引擎真绑= my_director_console.execute(lazy import)。
"""
from __future__ import annotations

import json

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .daoyan_runlog import NullRunLog
from .my_director_console import DIRECTOR_RECIPE

# ── 产物目录规范(PRD R1.3 ⑤):video/导演台/{章节}/{镜id}/p1-draft|…────
OUT_DIR_ROOT = "video/导演台"
P1_NAME, P2_NAME, P3_NAME = "p1-draft", "p2-final", "p3-recavsr"
DRAFT_NAME, FINAL_NAME = "章草片", "章终片"

PASS1_W, PASS1_H = DIRECTOR_RECIPE["first_pass_resolution"]    # 960×544
PASS2_W, PASS2_H = DIRECTOR_RECIPE["second_pass_resolution"]   # 1440×832

STAGE_LABEL = {"yicai": "一采", "ercai": "二采", "sancai": "三采"}


class DirectorError(RuntimeError):
    """计划级错误(缺上游/零勾选/类缺失/参考图缺失):逐镜点名,不静默跳过。"""


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

    def hit(prefix: str) -> str | None:
        # 视频扩展名白名单(纵深:.latent/.bak 恒不入产物册;1114 整章二发勘误)
        found = [p for p in (list_output(prefix) or [])
                 if p.lower().endswith((".mp4", ".webm", ".mov", ".mkv"))]
        return found[0] if found else None

    for i, seg in enumerate(segs):
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


# ── 引擎动作集(注入式;默认装配在 my_director_console.bind_engine_hooks)──

class Hooks:
    def __init__(self, load_image=None, save_image=None, list_output=None,
                 output_path=None, copy_to_input=None, load_video=None,
                 ffmpeg=None, send_event=None, check_interrupt=None,
                 free_memory=None, log=None, open_run_log=None,
                 save_latent=None, load_latent=None):
        self.load_image = load_image          # input 文件名 -> IMAGE
        self.save_image = save_image          # (images, prefix) -> UI dict
        self.list_output = list_output        # prefix -> [output 相对路径]
        self.output_path = output_path        # 相对路径 -> 绝对 Path
        self.copy_to_input = copy_to_input    # output 相对路径 -> input 文件名
        self.load_video = load_video          # input 文件名 -> VIDEO
        self.ffmpeg = ffmpeg                  # (output相对路径列表, 出[, log]) -> None
        self.send_event = send_event          # (type, payload) -> None
        self.check_interrupt = check_interrupt
        self.free_memory = free_memory
        self.log = log or (lambda *a: None)
        self.open_run_log = open_run_log      # chapter -> RunLog(双落点;缺省空)
        self.save_latent = save_latent        # (rel, payload) -> None(加速缓存)
        self.load_latent = load_latent        # rel -> payload|None(指纹自核)


def latent_fingerprint(state: dict, seg: dict, ref_names) -> str:
    """av_latent 决定因素指纹(seed/模式/时长/提示词/参考图/步数/分辨率)。

    ☑2 单独的 latent 检查点缓存用它防串:任何输入变了→指纹变→缓存作废
    重采样(确定性同果)。1114 加速:二采单独免 ~一采采样时长/镜。
    """
    import hashlib
    payload = json.dumps({
        "seed": effective_seed(state, seg),
        "mode": seg["mode"], "frames": seg["frames"],
        "prompt": seg.get("prompt") or {},
        "refs": list(ref_names or []),
        "steps": state["advanced"]["first_steps"],
        "res": [PASS1_W, PASS1_H],
    }, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def _call(classes: dict, name: str, **kwargs):
    """在册节点类直调(零改类本体)。

    双约定自适应:经典节点=FUNCTION 属性+返元组;DSL 节点(io.ComfyNode,
    如核心 BSA/SaveVideo)=classmethod execute+返 io.NodeOutput(支持
    [i] 索引)。动态组合(DynamicCombo)参数吃解析后的结构体字典
    (1114 实弹 R1 定谳:selection=裸串→「string indices」TypeError)。
    """
    cls = classes.get(name)
    if cls is None:
        raise DirectorError(f"引擎缺节点类 {name}(对应插件未装/未注册)")
    # DSL 节点(io.ComfyNode)的 hidden 类属性由 harness 执行期填,节点内
    # 直调=None→Save 族读 extra_pnginfo 即 AttributeError(1114 R1 实弹
    # 五拦定谳);空 Holder=全 None 安全跳元数据,图跑时 harness 自覆写
    if getattr(cls, "SCHEMA", None) is not None \
            and getattr(cls, "hidden", "set") is None:
        class _EmptyHidden:
            def __getattr__(self, _key):
                return None
        cls.hidden = _EmptyHidden()
    fn_name = getattr(cls, "FUNCTION", None)
    if not fn_name:
        fn_name = "execute" if hasattr(cls, "execute") else "run"
    out = getattr(cls(), fn_name)(**kwargs)
    if isinstance(out, tuple) or hasattr(out, "__getitem__"):
        return out  # 元组/io.NodeOutput 均支持 [i]
    return (out,)


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


# ── 三臂模型链(单源:DirectorExecutor 与三薄壳共用)───────────────────

class ModelKit:
    """三臂模型链(母本 [145/216/202] 三 LoRA 臂;每次执行构建一次)。

    BSA 参数=引擎装载母本的同一语义:widgets[sol-attn,1.3,0,1] 位序赋给
    required(selection,start_percent,end_percent,dense_blocks),其余吃默认
    ——与三采收官实跑逐位同值(fidelity-by-construction)。
    构建真源=模块级 build_model_kit(逐臂留痕版;本构造器薄委托)。
    """

    def __init__(self, classes: dict, model: Any, log=None):
        _build_kit(self, classes, model, log or (lambda *a: None))

    def preview_wrap(self, classes, model, video_vae, audio_vae, log=None):
        """[266] ModelPreviewOverrideKJ:实时预览原生通道(母本 widgets 原样)。

        可失败降级:该件吃执行上下文(dynprompt,1114 R1 实弹四拦定谳),
        节点内直调无上下文=AttributeError;预览加速非正确性依赖,失败即
        回退裸臂模型(采样配方零影响;降级留痕;面板实时预览走
        daoyan_preview 事件)。
        """
        log = log or (lambda *a: None)
        try:
            return _call(classes, "ModelPreviewOverrideKJ", model=model,
                         max_resolution=1024, jpeg_quality=80,
                         suppress_default_preview=True, preview_frames=1,
                         preview_fps=12, vae=video_vae,
                         tiny_vae="taeh3.safetensors", audio_vae=audio_vae)[0]
        except Exception as err:
            log(f"预览包装降级(裸模型直跑):{err}")
            return model


def _build_kit(kit: ModelKit, classes: dict, model: Any, log) -> ModelKit:
    r = DIRECTOR_RECIPE
    # BSA=核心 DSL 节点:动态组合 selection 吃结构体(母本 widgets
    # [sol-attn,1.3,0,1] 真义=method sol-attn/tau1.3/全域0→1;
    # 1114 R1 实弹定谳,余参取类默认)
    bsa = dict(selection={"selection": "sol-attn", "tau": 1.3},
               start_percent=0.0, end_percent=1.0, dense_blocks="",
               min_tokens=12288, extra_tokens=0,
               sink_conditioning="exact_kv_and_rows", verbose=False)

    def lora(name, strength, m):
        return _call(classes, "LoraLoaderModelOnly", model=m,
                     lora_name=name, strength_model=strength)[0]

    def bsa_(m):
        return _call(classes, "BlockSparseAttention", model=m, **bsa)[0]

    def cff(m, chunks):
        return _call(classes, "MiniMaxChunkFeedForward", model=m,
                     chunks=chunks, seq_threshold=4096)[0]

    def kitchen(m):
        return _call(classes, "ModelAttentionBackend", model=m,
                     attention="comfy kitchen attention")[0]

    def arm(title: str, build):
        """逐臂独立 try:失败行点名臂名(不再是无名堆栈)。"""
        try:
            return build()
        except DirectorError:
            raise
        except Exception as err:
            log(f"kit {title} 臂构建失败:{err!r}")
            raise DirectorError(f"{title} 臂构建失败:{err}") from err

    def _r2v():
        m = lora(*r["lora_r2v"], model)
        out = kitchen(cff(bsa_(m), 2))
        log(f"kit r2v 臂构建 lora={r['lora_r2v'][0]}×{r['lora_r2v'][1]}"
            f" τ={bsa['selection']['tau']} cff=2")
        return out

    def _i2v():
        m = lora(*r["lora_i2v"], model)
        out = _call(classes, "MiniMaxH3SigmaShift",
                    model=kitchen(cff(bsa_(m), 2)),
                    shift_video=6.0, shift_audio=3.0)[0]
        log(f"kit i2v 臂构建 lora={r['lora_i2v'][0]}×{r['lora_i2v'][1]}"
            f" τ={bsa['selection']['tau']} cff=2 σ=(6,3)")
        return out

    def _second():
        m = lora(*r["lora_second_pass"], model)
        sigma = _call(classes, "MiniMaxH3SigmaShift",
                      model=cff(bsa_(m), 1),
                      shift_video=12.0, shift_audio=3.0)[0]
        kit.kitchen_p2 = kitchen(sigma)
        log(f"kit 二采臂构建 lora={r['lora_second_pass'][0]}"
            f"×{r['lora_second_pass'][1]} τ={bsa['selection']['tau']}"
            f" cff=1 σ=(12,3)")
        return sigma

    # r2v 臂 [145→262→263→140]
    kit.r2v = arm("r2v", _r2v)
    # i2v 臂 [216→260→261→217→251](σ(6,3) 恒供调度器,母本接线原样)
    kit.sigma_p1 = arm("i2v", _i2v)
    # 二采臂 [202→267→223→203→215]
    kit.sigma_p2 = arm("二采", _second)
    return kit


def build_model_kit(classes: dict, model: Any, log=None) -> ModelKit:
    """三臂模型链构建(模块级单源:executor.run 与三薄壳共用;逐臂留痕)。"""
    kit = ModelKit.__new__(ModelKit)
    return _build_kit(kit, classes, model, log or (lambda *a: None))


# ── 单源三采上下文(阶段3.5:壳节点与 executor 共用)──────────────────

@dataclass
class PassCtx:
    """模块级三采函数的显式参数束(splitSpec 1114:采子图路线B)。"""

    classes: dict                   # 在册节点类注册表(注入式)
    hooks: Hooks                    # 文件/事件钩子
    chapter: str                    # 产物章节目录名
    seg_index: int                  # 0 基镜号(日志「第N镜」与事件索引)
    first_steps: int                # 一采步数(高级区)
    second_steps: int               # 二采步数
    log: Any                        # RunLog(双落点)或兼容记录器
    unique_id: Any = None           # 节点号(事件回填路由)
    seed: int = 42                  # 全局 seed 兜底(seg.seed None 时)
    color_fix: str = "none"         # 三采色彩修正档


def seg_label(ctx: PassCtx, seg: dict) -> str:
    return f"第{ctx.seg_index + 1}镜({seg['id']})"


def _seg_seed(ctx: PassCtx, seg: dict) -> int:
    seed = seg.get("seed")
    return int(seed) if seed is not None else int(ctx.seed)


def _shape(x) -> str:
    """张量形状入日志行(1114 整章实弹勘误:LATENT=dict 无 shape,str 兜底
    会把整包张量倾倒进 run-log——dict=逐键内形状摘要,兜底截 60 字)。"""
    shape = getattr(x, "shape", None)
    if shape is not None:
        try:
            return "(" + ",".join(str(d) for d in shape) + ")"
        except Exception:
            pass
    if isinstance(x, dict):
        return "{" + ",".join(f"{k}:{_shape(v)}" for k, v in list(x.items())[:4]) + "}"
    return str(x)[:60]


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


def load_refs(hooks: Hooks, state: dict, seg: dict,
              log=None) -> tuple[list, list]:
    """按名装载参考图(9槽/8异图预算截尾,弃件留痕);缺件=DirectorError
    点名(不静默跳过)。"""
    raw = [n for n in (state.get("common_images") or [])
           + (seg.get("images") or []) if n]
    names, _, dropped = budget_ref_names(raw)
    if dropped and log:
        log(f"参考图预算截尾(9槽/8异图,App 组装器同口径):"
            f"弃 [{','.join(dropped)}]")
    refs = []
    for name in names:
        img = hooks.load_image(name)
        if img is None:
            raise DirectorError(f"参考图 {name} 不在 input/,先在面板上传或改引用")
        refs.append(img)
    return refs, names


def conditioning(ctx: PassCtx, seg: dict, refs, ref_names, width, height,
                 clip, video_vae, audio_vae):
    """t2v/r2v→ReferenceToVideo[16];i2v/fl2v→ImageToVideo[220](单源)。

    参考图顺序=面板 <Picture N> 语义(公共图区 1-3,本组从 4 续);
    i2v 首帧=本组分镜帧优先(seg.images[0]),fl2v 尾帧=本组末张;
    无名画布直喂张量(壳路径)直接作首帧。cond 行+prompt 全文逐字留痕。
    """
    log = ctx.log
    prompt = assemble_prompt(seg)
    mode = seg["mode"]
    frames = seg["frames"]
    own = seg.get("images") or []
    if mode in ("t2v", "r2v"):
        kw = dict(clip=clip, prompt=prompt, width=width, height=height,
                  length=frames,
                  ref_image_size="max")  # t2v 无参考恒 max;r2v 预算后自适应
        if mode == "r2v":
            kw.update(vae=video_vae, audio_vae=audio_vae)
            # AUTOGROW 类直调=聚合字典 {ref_image_N: IMAGE}(引擎把点分
            # 子槽聚成 dict 传类;1114 R1 实弹三拦定谳,消费方
            # .values()/.items() 遍历)
            # 末端口径预算(单源守门,executor/壳全路径):9槽/8异图,
            # 重复名不占预算;无名画布张量(壳路径)保守各计 1 异图
            names = [str(n) for n in (ref_names or [])]
            keys = names + [f"(画布直喂{j})"
                            for j in range(len(names), len(refs))]
            keep, distinct, drop = budget_ref_items(keys)
            if drop:
                log(f"参考图预算截尾(9槽/8异图):"
                    f"弃 [{','.join(keys[j] for j in drop)}]")
            kw["ref_images"] = {f"ref_image_{j}": refs[idx]
                                for j, idx in enumerate(keep)}
            # 1114 自适应(用户裁定):异图≤4 保 max(1110 定律原面);
            # ≥5 降 match(实测 大参考数×max=引擎原生崩)
            kw["ref_image_size"] = "max" if distinct <= 4 else "match"
        log(f"cond mode={mode} refs=[{','.join(ref_names or [])}]"
            f" 首帧=- 尾帧=- {width}×{height} length={frames}")
        log(f"prompt 全文:\n{prompt}")
        return _call(ctx.classes, "MiniMaxH3ReferenceToVideo", **kw)
    first_desc = last_desc = "-"
    kw = dict(clip=clip, vae=video_vae, prompt=prompt, width=width,
              height=height, length=frames)
    if own:
        kw["first_frame"] = ctx.hooks.load_image(own[0])
        first_desc = own[0]
    elif ref_names:
        kw["first_frame"] = ctx.hooks.load_image(ref_names[0])
        first_desc = ref_names[0]
    elif refs:
        kw["first_frame"] = refs[0]  # 画布直喂张量(壳路径)
        first_desc = "(画布直喂)"
    if mode == "fl2v" and len(own) > 1:
        kw["last_frame"] = ctx.hooks.load_image(own[-1])
        last_desc = own[-1]
    log(f"cond mode={mode} refs=[{','.join(ref_names or [])}]"
        f" 首帧={first_desc} 尾帧={last_desc} {width}×{height} length={frames}")
    log(f"prompt 全文:\n{prompt}")
    return _call(ctx.classes, "MiniMaxH3ImageToVideo", **kw)


def _sample(classes, seed, guider_model, cond, sampler, sigmas, latent):
    noise = _call(classes, "RandomNoise", noise_seed=seed)[0]
    guider = _call(classes, "BasicGuider", model=guider_model,
                   conditioning=cond)[0]
    return _call(classes, "SamplerCustomAdvanced", noise=noise,
                 guider=guider, sampler=sampler, sigmas=sigmas,
                 latent_image=latent)


def save_video(classes, hooks: Hooks, log, video, chapter, seg_id,
               name) -> str:
    """落盘+检查点诊断:SaveVideo 抛异常(类名)与返回但盘上无命中
    (疑似写往别处)分开口径;重掷旧件让名 .bak×n 入行。"""
    prefix = artifact_prefix(chapter, seg_id, name)
    olds = [p for p in (hooks.list_output(prefix) or [])
            if p.lower().endswith((".mp4", ".webm", ".mov", ".mkv"))]  # 重掷:旧件让名(白名单=视频)
    for old in olds:
        # output_path 可注入缺省 None(既有伪钩子)=跳让名,不炸
        src = hooks.output_path(old) if callable(hooks.output_path) else None
        if src:
            src.rename(str(src) + ".bak")
    try:
        _call(classes, "SaveVideo", video=video, filename_prefix=prefix,
              format={"format": "auto"})
    except Exception as err:
        log(f"落盘失败 SaveVideo 抛异常({type(err).__name__}):{err!r}")
        raise DirectorError(
            f"SaveVideo 未落盘:{prefix}(抛异常 {type(err).__name__}:{err})"
        ) from err
    hits = [p for p in (hooks.list_output(prefix) or [])
            if p.lower().endswith((".mp4", ".webm", ".mov", ".mkv"))]
    if not hits:
        log(f"落盘失败 SaveVideo 返回但盘上无命中(prefix={prefix} 疑似写往别处)")
        raise DirectorError(
            f"SaveVideo 未落盘:{prefix}(返回但盘上无命中,疑似写往别处)")
    log(f"落盘 {hits[0]}" + (f"(旧件让名 .bak×{len(olds)})" if olds else ""))
    return hits[0]


def video_from(classes, images, audio):
    """[130] CreateVideo(母本 widgets 24/8/sRGB/none)。"""
    return _call(classes, "CreateVideo", images=images, fps=24, audio=audio,
                 bit_depth="auto", color_space="sRGB",
                 chroma_subsampling="auto", codec="none")[0]


def emit_preview(hooks: Hooks, unique_id, seg_index, seg_id, chapter,
                 images) -> bool:
    """daoyan_preview 事件发射(payload 对齐 live.js 消费契约:
    {node_id,segment_id,segment_index,step,total,url};step/total=采样步内
    行需改引擎本体=禁区,如实置 null)。预览失败不咬主路。"""
    try:
        ui = hooks.save_image(images[:1], f"daoyan_preview/{chapter}")
        url = None
        if isinstance(ui, dict) and ui.get("filename"):
            url = (f"/view?filename={ui['filename']}"
                   f"&subfolder={ui.get('subfolder', '')}"
                   f"&type={ui.get('type', 'output')}")
        hooks.send_event("daoyan_preview", {
            "node_id": unique_id, "segment_id": seg_id,
            "segment_index": seg_index, "step": None, "total": None,
            "url": url})
        return True
    except Exception as err:  # 预览失败不咬主路
        hooks.log(f"预览事件失败(不咬主路):{err}")
        return False


# ── 三采单源(模块级;DirectorExecutor 与三薄壳共用)──────────────────

def pass1(ctx: PassCtx, seg, kit, refs, model, video_vae, audio_vae, clip,
          save=True, ref_names=None):
    """一采(单源):采样→解码→(save)p1-draft;恒返 av_latent 供二采。

    返回 (p1_rel|None, av_latent, video|None):save=False=☑2 单独吃盘上 p1
    的确定性重采样(只取 latent,不落盘不解码);video=CreateVideo 产物
    (壳节点 VIDEO 出口用;save=False 时 None)。
    """
    log = ctx.log
    ref_names = list(ref_names or [])
    seed = _seg_seed(ctx, seg)
    mode = seg["mode"]
    label = seg_label(ctx, seg)
    arm_name = "flex_ref2va" if mode in ("t2v", "r2v") else "turbo_fl2va"
    log.stage(label, STAGE_LABEL["yicai"], "开始", mode=mode, seed=seed,
              frames=seg["frames"], size=f"{PASS1_W}×{PASS1_H}",
              steps=ctx.first_steps, sigma=(6, 3),
              sampler=DIRECTOR_RECIPE["sampler_first_pass"],
              臂=arm_name, save=bool(save))
    if not save:
        log(f"{label} 一采 重采样 latent-only(吃盘上p1,同seed确定性)"
            f" seed={seed}")
    cond, latent = conditioning(ctx, seg, refs, ref_names, PASS1_W, PASS1_H,
                                clip, video_vae, audio_vae)
    arm = kit.r2v if mode in ("t2v", "r2v") else kit.sigma_p1
    guider_model = kit.preview_wrap(ctx.classes, arm, video_vae, audio_vae,
                                    log=log)
    sampler = _call(ctx.classes, "KSamplerSelect",
                    sampler_name=DIRECTOR_RECIPE["sampler_first_pass"])[0]
    sigmas = _call(ctx.classes, "BasicScheduler", model=kit.sigma_p1,
                   scheduler="simple", steps=ctx.first_steps, denoise=1.0)[0]
    samples, av_latent = _sample(ctx.classes, seed, guider_model, cond,
                                 sampler, sigmas, latent)
    if not save:  # ☑2 单独吃盘上 p1:重采样只取 latent(批量役 stage2 同义)
        log(f"{label} 一采 结束 ok=1 latent-only"
            f"(latent_in={_shape(latent)} latent_out={_shape(av_latent)})")
        return None, av_latent, None
    images = _call(ctx.classes, "VAEDecode", samples=samples, vae=video_vae)[0]
    audio = _call(ctx.classes, "VAEDecodeAudio", samples=samples,
                  vae=audio_vae)[0]
    emit_preview(ctx.hooks, ctx.unique_id, ctx.seg_index, seg["id"],
                 ctx.chapter, images)
    video = video_from(ctx.classes, images, audio)
    p1_rel = save_video(ctx.classes, ctx.hooks, log, video, ctx.chapter,
                        seg["id"], P1_NAME)
    log.stage(label, STAGE_LABEL["yicai"], "结束", ok=1, 产物=p1_rel)
    return p1_rel, av_latent, video


def pass2(ctx: PassCtx, seg, kit, refs, av_latent, video_vae, audio_vae,
          clip, ref_names=None):
    """二采(单源):潜放大 1440×832 + taomate 3步 σ(12,3) → p2-final。"""
    log = ctx.log
    ref_names = list(ref_names or [])
    seed = _seg_seed(ctx, seg)
    label = seg_label(ctx, seg)
    log.stage(label, STAGE_LABEL["ercai"], "开始", mode=seg["mode"], seed=seed,
              frames=seg["frames"], size=f"{PASS2_W}×{PASS2_H}",
              steps=ctx.second_steps, sigma=(12, 3),
              sampler=DIRECTOR_RECIPE["sampler_first_pass"], 臂="taomate",
              save=True)
    video_latent, audio_latent = _call(ctx.classes, "LTXVSeparateAVLatent",
                                       av_latent=av_latent)
    up = _call(ctx.classes, "MinimaxH3LatentUpscaler3D", latent=video_latent,
               model_name="minimax_h3_latent_upscaler_3d_bf16.safetensors",
               mode={"mode": "target dimensions", "width": PASS2_W,
                     "height": PASS2_H},
               align=32, enable_temporal_chunking=True, force_unload=True,
               device="cuda", precision="fp16")[0]
    log(f"潜放大 vl={_shape(video_latent)}→up={_shape(up)} 对齐=32"
        f" {PASS2_W}×{PASS2_H}")
    latent = _call(ctx.classes, "LTXVConcatAVLatent", video_latent=up,
                   audio_latent=audio_latent)[0]
    cond, _ = conditioning(ctx, seg, refs, ref_names, PASS2_W, PASS2_H,
                           clip, video_vae, audio_vae)
    guider_model = kit.preview_wrap(ctx.classes, kit.kitchen_p2, video_vae,
                                    audio_vae, log=log)
    sampler = _call(ctx.classes, "KSamplerSelect",
                    sampler_name=DIRECTOR_RECIPE["sampler_first_pass"])[0]
    sigmas = _call(ctx.classes, "BasicScheduler", model=kit.sigma_p2,
                   scheduler="simple", steps=ctx.second_steps,
                   denoise=DIRECTOR_RECIPE["second_pass_denoise"])[0]
    samples, _ = _sample(ctx.classes, seed, guider_model, cond, sampler,
                         sigmas, latent)
    images = _call(ctx.classes, "VAEDecode", samples=samples, vae=video_vae)[0]
    audio = _call(ctx.classes, "VAEDecodeAudio", samples=samples,
                  vae=audio_vae)[0]
    emit_preview(ctx.hooks, ctx.unique_id, ctx.seg_index, seg["id"],
                 ctx.chapter, images)
    video = video_from(ctx.classes, images, audio)
    p2_rel = save_video(ctx.classes, ctx.hooks, log, video, ctx.chapter,
                        seg["id"], P2_NAME)
    log.stage(label, STAGE_LABEL["ercai"], "结束", ok=1, 产物=p2_rel)
    return p2_rel, video


def pass3(ctx: PassCtx, seg, video, seed, p2_rel=None):
    """三采(单源):ReCaVSR 超分 → p3-recavsr。

    video=None 时文件化交接吃 p2(output→input→LoadVideo,批量役 stage3
    同工艺,交接行留痕);video 直喂=壳节点画布路(LoadVideo/Pass2 出口)。
    返回 (p3_rel, video_out)。
    """
    log = ctx.log
    label = seg_label(ctx, seg)
    if video is None:
        if not p2_rel:
            raise DirectorError(f"{seg['id']} p2 缺失,三采无从起")
        name = ctx.hooks.copy_to_input(p2_rel)
        log(f"三采 copy_to_input→{name}(源={p2_rel})")
        video = ctx.hooks.load_video(name)
    log.stage(label, STAGE_LABEL["sancai"], "开始", seed=seed, scale=2.0,
              color_fix=ctx.color_fix, 源=str(p2_rel or "(画布直喂)"))
    rc_model = _call(ctx.classes, "ReCaVSRLoader",
                     transformer=DIRECTOR_RECIPE["recavsr_transformer"])[0]
    out = _call(ctx.classes, "ReCaVSRUpscale", model=rc_model, scale=2.0,
                color_fix=ctx.color_fix, seed=seed,
                decoder="flashdecoder", kernels="fast", kv_offload=False,
                encoder="auto", fps=30.0, video=video)[0]
    p3_rel = save_video(ctx.classes, ctx.hooks, log, out, ctx.chapter,
                        seg["id"], P3_NAME)
    log.stage(label, STAGE_LABEL["sancai"], "结束", ok=1, 产物=p3_rel)
    return p3_rel, out


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


# ── 逐镜调度器(方法面=薄委托;主循环同 AIMixer executor)──────────────

class DirectorExecutor:
    """逐镜三采调度器(AIMixer executor 主循环同构,拆写为注入式)。"""

    def __init__(self, classes: dict, hooks: Hooks):
        self.C = classes
        self.H = hooks
        self._log = None
        self._freed = False

    # ── 薄委托(兼容面;run() 直调模块单源函数)─────────────────────
    def _ctx_for(self, state, seg) -> PassCtx:
        idx = next((i for i, s in enumerate(state["segments"])
                    if s["id"] == seg.get("id")), 0)
        return PassCtx(classes=self.C, hooks=self.H,
                       chapter=state["chapter"], seg_index=idx,
                       first_steps=state["advanced"]["first_steps"],
                       second_steps=state["advanced"]["second_steps"],
                       log=self._log or NullRunLog(),
                       seed=state["common_params"]["seed"],
                       color_fix=state.get("color_fix", "none"))

    def _pass1(self, state, seg, kit, refs, model, video_vae, audio_vae, clip,
               save=True):
        p1_rel, av_latent, _ = pass1(self._ctx_for(state, seg), seg, kit,
                                     refs, model, video_vae, audio_vae, clip,
                                     save=save)
        return p1_rel, av_latent

    def _pass2(self, state, seg, kit, refs, av_latent, video_vae, audio_vae,
               clip):
        p2_rel, _ = pass2(self._ctx_for(state, seg), seg, kit, refs,
                          av_latent, video_vae, audio_vae, clip)
        return p2_rel

    def _pass3(self, state, seg, p2_rel, seed):
        p3_rel, _ = pass3(self._ctx_for(state, seg), seg, None, seed,
                          p2_rel=p2_rel)
        return p3_rel

    def _emit_preview(self, state, seg_id, images):
        idx = next((i for i, s in enumerate(state["segments"])
                    if s["id"] == seg_id), 0)
        return emit_preview(self.H, None, idx, seg_id, state["chapter"],
                            images)

    def _load_refs(self, state, seg) -> list:
        refs, _ = load_refs(self.H, state, seg)
        return refs

    # ── 主循环(AIMixer executor 主循环同构)─────────────────────────
    def run(self, model, video_vae, audio_vae, clip, state: dict,
            unique_id=None) -> dict:
        chapter = state["chapter"]
        log = self._open_log(chapter)
        self._log = log
        runs, errors, artifacts = resolve_plan(state, self.H.list_output)
        if errors:
            log(f"run 拒绝:{'; '.join(errors)}")
            raise DirectorError("; ".join(errors))
        total = len(runs)
        done = 0
        cancelled = False
        fail_no = None
        sel = "+".join(str(n) for n, k in zip((1, 2, 3),
                                              ("yicai", "ercai", "sancai"))
                       if state["stages"][k]) or "-"
        log(f"═══ run 开始 章节={chapter} 勾选={sel}"
            f" 镜数={len(state['segments'])} 运行清单={total}镜")
        # 计划门控决策留痕(resolve_plan 的逐镜命中/todo/rerun 决策入行)
        todo_by_index = {r["index"]: r["do"] for r in runs}
        for i, seg in enumerate(state["segments"]):
            art = artifacts.get(seg["id"], {})

            def hit(v):
                return f"命中:{v}" if v else "未命中"

            todo = todo_by_index.get(i)
            log(f"plan 第{i + 1}镜({seg['id']}) p1={hit(art.get('p1'))}"
                f" p2={hit(art.get('p2'))} p3={hit(art.get('p3'))}"
                f" rerun={1 if seg.get('rerun') else 0}"
                f" todo={','.join(todo) if todo else '-(已完跳过)'}")
        chapter_outputs: dict = {}
        kit = None
        try:
            for item in runs:
                i, seg, todo = item["index"], item["seg"], item["do"]
                ctx = PassCtx(classes=self.C, hooks=self.H, chapter=chapter,
                              seg_index=i,
                              first_steps=state["advanced"]["first_steps"],
                              second_steps=state["advanced"]["second_steps"],
                              log=log, unique_id=unique_id,
                              seed=state["common_params"]["seed"],
                              color_fix=state.get("color_fix", "none"))
                av_latent = None
                for stage in todo:
                    self._tick(unique_id, i, len(state["segments"]), stage,
                               done, total)
                    try:
                        if stage in ("yicai", "ercai") and kit is None:
                            kit = build_model_kit(self.C, model, log)
                        refs, ref_names = load_refs(self.H, state, seg, log)
                        if stage == "yicai":
                            p1_rel, av_latent, _ = pass1(
                                ctx, seg, kit, refs, model, video_vae,
                                audio_vae, clip, save=True,
                                ref_names=ref_names)
                            artifacts.setdefault(seg["id"], {})["p1"] = p1_rel
                            if self.H.save_latent and av_latent is not None:
                                # 种缓存:将来 ☑2 单独/重掷二采=零采样直吃
                                self.H.save_latent(artifact_prefix(
                                    state["chapter"], seg["id"], P1_NAME)
                                    + ".latent", {
                                        "fp": latent_fingerprint(
                                            state, seg, ref_names),
                                        "latent": av_latent})
                        elif stage == "ercai":
                            if av_latent is None:
                                # 加速:latent 检查点缓存命中=零采样直吃
                                # (指纹含 seed/提示词/参考图/步数,变则作废)
                                fp = latent_fingerprint(state, seg, ref_names)
                                cache_rel = artifact_prefix(
                                    state["chapter"], seg["id"],
                                    P1_NAME) + ".latent"
                                cached = self.H.load_latent(cache_rel) \
                                    if self.H.load_latent else None
                                if cached and cached.get("fp") == fp:
                                    av_latent = cached["latent"]
                                    log("latent 缓存命中(零采样,指纹 "
                                        + fp + "):" + seg["id"])
                                else:
                                    # 吃盘上 p1:确定性重采样取 latent(不落盘)
                                    _, av_latent, _ = pass1(
                                        ctx, seg, kit, refs, model, video_vae,
                                        audio_vae, clip, save=False,
                                        ref_names=ref_names)
                                    if self.H.save_latent:
                                        self.H.save_latent(cache_rel, {
                                            "fp": fp, "latent": av_latent})
                                        log("latent 已缓存(下次二采单独零采样)")
                            p2_rel, _ = pass2(ctx, seg, kit, refs, av_latent,
                                              video_vae, audio_vae, clip,
                                              ref_names=ref_names)
                            artifacts.setdefault(seg["id"], {})["p2"] = p2_rel
                        else:  # sancai(三采前统一卸载:首批进三采时一次)
                            if not self._freed:
                                log("三采前统一卸载(首次)")
                                self.H.free_memory()
                                self._freed = True
                            reg = artifacts.get(seg["id"], {}).get("p2")
                            p2_rel, src = reg, "登记"
                            if not p2_rel:
                                p2_rel = next(
                                    (p for p in (self.H.list_output(
                                        artifact_prefix(chapter, seg["id"],
                                                        P2_NAME))
                                        or []) if p.lower().endswith(
                                            (".mp4", ".webm", ".mov", ".mkv"))),
                                    None)
                                src = "盘glob"
                            if not p2_rel:
                                raise DirectorError(
                                    f"第{i + 1}镜({seg['id']})"
                                    f"无p2,三采无从起")
                            log(f"三采 p2 来源={src}:{p2_rel}")
                            p3_rel, _ = pass3(
                                ctx, seg, None, effective_seed(state, seg),
                                p2_rel=p2_rel)
                            artifacts.setdefault(seg["id"], {})["p3"] = p3_rel
                    except DirectorError as err:
                        raise DirectorError(
                            f"第{i + 1}镜({seg['id']}):{err}") from err
                    except Exception as err:  # 阶段失败全包(裸异常带上下文)
                        fail_no = i + 1
                        log(f"第{i + 1}镜({seg['id']})·{STAGE_LABEL[stage]}"
                            f" 失败 {_stage_context(stage, ctx, seg)}"
                            f" err={err!r}")
                        raise DirectorError(
                            f"第{i + 1}镜({seg['id']})·{STAGE_LABEL[stage]}"
                            f"失败 {_stage_context(stage, ctx, seg)}:{err}"
                        ) from err
                    self._emit_artifact(unique_id, i, seg["id"],
                                         artifacts[seg["id"]])
                    if self.H.check_interrupt():
                        cancelled = True  # 检查点语义:已完镜保留,就地停
                        log(f"中断(用户取消) 第{i + 1}镜({seg['id']})"
                            f" 已完={done}")
                        break
                if cancelled:
                    break
                done += 1
            chapter_outputs = self._finalize(chapter, state, artifacts,
                                             cancelled, log=log)
        except Exception as err:  # 失败终态事件(面板清 running 判据:含「失败」)
            if fail_no is None:
                fail_no = done + 1
            message = f"失败 第{fail_no}/{total} 镜:{str(err)[:200]}"
            try:
                self.H.send_event("daoyan_progress", {
                    "node_id": unique_id, "done": done, "total": total,
                    "message": message, "chapter_outputs": chapter_outputs})
                log(f"run 终态 {message}")
            except Exception:  # noqa: BLE001 - 事件失败不咬上抛主路
                pass
            raise
        log(f"run 完成 done={done}/{total}"
            f" 取消={1 if cancelled else 0}"
            f" 章草片={chapter_outputs.get('draft') or '-'}"
            f" 章终片={chapter_outputs.get('final') or '-'}")
        self.H.send_event("daoyan_progress", {
            "node_id": unique_id,
            "message": ("═══ run 终态 已取消(已完镜产物保留)" if cancelled else "═══ run 终态 全部完成")
                       + f" {done}/{total} 镜",
            "done": done, "total": total, "chapter_outputs": chapter_outputs})
        return {"artifacts": artifacts, "chapter_outputs": chapter_outputs,
                "done": done, "total": total, "cancelled": cancelled}

    def _open_log(self, chapter):
        opener = getattr(self.H, "open_run_log", None)
        if callable(opener):
            try:
                return opener(chapter)
            except Exception:  # noqa: BLE001 - 日志开不了不咬执行
                pass
        return NullRunLog()

    def _finalize(self, chapter, state, artifacts, cancelled, log=None):
        """章草片(p1 拼接)/章终片(p3 拼接):ffmpeg 外拼(批量役 concat 同款)。
        取消=不拼半章(已完镜检查点在盘,补跑完成后自拼);源/跳过逐镜点名。"""
        log = log or (lambda *a: None)
        out = {}
        if cancelled:
            log("finalize 取消=不拼半章(已完镜检查点在盘,补跑完成后自拼)")
            return out

        stages = state["stages"]
        sel = "+".join(str(n) for n, k in zip((1, 2, 3),
                                              ("yicai", "ercai", "sancai"))
                       if stages[k]) or "-"
        plans = []
        if stages["yicai"]:  # 勾1 即拼(全链同跑也拼;1114 整章实弹勘误)
            plans.append(("p1", DRAFT_NAME, "draft"))
        if stages["sancai"]:
            plans.append(("p3", FINAL_NAME, "final"))
        log(f"finalize 勾={sel} "
            + ("+".join(label for _, label, _ in plans) if plans
               else "无章级拼接"))

        def rels(key):
            return [artifacts.get(s["id"], {}).get(key)
                    for s in state["segments"]
                    if artifacts.get(s["id"], {}).get(key)]

        for key, label, out_key in plans:
            have = [(s["id"], artifacts.get(s["id"], {}).get(key))
                    for s in state["segments"]
                    if artifacts.get(s["id"], {}).get(key)]
            miss = [f"{s['id']}(无{key})"
                    for s in state["segments"]
                    if not artifacts.get(s["id"], {}).get(key)]
            if not have:
                if miss:
                    log(f"{label} 源=0镜 跳过={len(miss)}镜[{','.join(miss)}](不拼)")
                continue
            log(f"{label} 源={len(have)}镜[{','.join(i for i, _ in have)}]"
                + (f" 跳过={len(miss)}镜[{','.join(miss)}]" if miss else ""))
            target = f"{OUT_DIR_ROOT}/{chapter}/{label}.mp4"
            self._ffmpeg(rels(key), target, log)
            out[out_key] = target
        return out

    def _ffmpeg(self, rels, target, log):
        """ffmpeg 钩子委托:三参签名(log 尾随)可用则带日志,旧二参兼容。"""
        import inspect
        try:
            arity = len(inspect.signature(self.H.ffmpeg).parameters)
        except (TypeError, ValueError):
            arity = 2
        if arity >= 3:
            self.H.ffmpeg(rels, target, log)
        else:
            self.H.ffmpeg(rels, target)

    def _tick(self, unique_id, index, seg_total, stage, done, total):
        self.H.send_event("daoyan_progress", {
            "node_id": unique_id, "segment_index": index,
            "stage": stage, "done": done, "total": total,
            "message": f"第{index + 1}/{seg_total} 镜 · {STAGE_LABEL[stage]}"
                       f" 运行中 · 进度 {done}/{total}"})

    def _emit_artifact(self, unique_id, index, seg_id, art):
        self.H.send_event("daoyan_artifacts", {
            "node_id": unique_id, "segment_index": index, "segment_id": seg_id,
            "artifacts": {k: v for k, v in art.items() if v}})


def _stage_context(stage: str, ctx: PassCtx, seg: dict) -> str:
    """阶段失败行的 seed/步骤/σ/分辨率上下文(审计定位四件套;
    seed=组级覆盖优先,空=继承全局,与 _seg_seed 同口径)。"""
    seed = _seg_seed(ctx, seg)
    if stage == "yicai":
        return f"seed={seed} steps={ctx.first_steps} σ=(6,3) {PASS1_W}×{PASS1_H}"
    if stage == "ercai":
        return (f"seed={seed} steps={ctx.second_steps} σ=(12,3)"
                f" {PASS2_W}×{PASS2_H}")
    return f"seed={seed} scale=2.0 color_fix={ctx.color_fix}"


# ── 引擎真绑(懒加载:源码位可测,引擎态才 import)────────────────────

# 执行链所需在册节点类(缺一=DirectorError 点名;全在 17000 引擎在册实证)
NEEDED_CLASSES = (
    "LoraLoaderModelOnly", "BlockSparseAttention", "MiniMaxChunkFeedForward",
    "ModelAttentionBackend", "MiniMaxH3SigmaShift", "ModelPreviewOverrideKJ",
    "MiniMaxH3ReferenceToVideo", "MiniMaxH3ImageToVideo", "RandomNoise",
    "BasicGuider", "KSamplerSelect", "BasicScheduler",
    "SamplerCustomAdvanced", "VAEDecode", "VAEDecodeAudio", "CreateVideo",
    "SaveVideo", "SaveImage", "LoadVideo", "LTXVSeparateAVLatent",
    "MinimaxH3LatentUpscaler3D", "LTXVConcatAVLatent", "ReCaVSRLoader",
    "ReCaVSRUpscale",
)


def bind_engine_hooks():
    """引擎态装配:类注册表+文件系统/事件/中断/卸载/日志钩子(1112 批量役
    同工艺:output 检查点 glob/input 通道装载/ffmpeg concat -c copy)。"""
    import shutil
    import subprocess
    from pathlib import Path

    import nodes as comfy_nodes
    import folder_paths
    from server import PromptServer

    from .daoyan_runlog import RunLog

    missing = [n for n in NEEDED_CLASSES if n not in comfy_nodes.NODE_CLASS_MAPPINGS]
    if missing:
        raise DirectorError("引擎缺节点类:" + ",".join(missing))

    out_dir = Path(folder_paths.get_output_directory())
    input_dir = Path(folder_paths.get_input_directory())

    def list_output(prefix):
        # 1114 整章二发勘误:p1-draft.latent(加速缓存)撞 p1-draft* glob 混入
        # 产物册喂 ffmpeg——产物册恒只认视频扩展名
        return [str(p.relative_to(out_dir))
                for p in sorted(out_dir.glob(prefix + "*"))
                if p.suffix.lower() in ("mp4", "webm", "mov", "mkv")]

    def output_path(rel):
        p = out_dir / rel
        return p if p.exists() else None

    def copy_to_input(rel):
        src = out_dir / rel
        dst = input_dir / src.name
        if not dst.exists():
            shutil.copy2(src, dst)
        return dst.name

    def load_image(name):
        p = input_dir / name
        if not p.exists():
            return None
        return comfy_nodes.NODE_CLASS_MAPPINGS["LoadImage"]().load_image(name)[0]

    def save_image(images, prefix):
        ui = comfy_nodes.NODE_CLASS_MAPPINGS["SaveImage"]().save_images(
            images, filename_prefix=prefix)[0]["ui"]["images"][0]
        return ui

    def load_video(name):
        cls = comfy_nodes.NODE_CLASS_MAPPINGS["LoadVideo"]
        fn = getattr(cls, "FUNCTION", None) or "load_video"
        return getattr(cls(), fn)(file=name)[0]

    def open_run_log(chapter):
        return RunLog(chapter, out_dir, echo=True)

    def ffmpeg(rels, out_rel, log=None):
        """章级拼接委托(三挡降挡单源 ffmpeg_concat;逐挡留痕)。"""
        ffmpeg_concat(out_dir, rels, out_rel, log)

    def send_event(etype, payload):
        try:
            PromptServer.Instance.send_sync(etype, payload)
        except Exception as err:  # 事件哑发留痕(面板不在线/程序化直投)
            print(f"[daoyan] 事件 {etype} 发送失败(面板不在线?):{err}",
                  flush=True)

    def check_interrupt():
        try:
            from comfy.model_management import \
                throw_exception_if_processing_interrupted
            throw_exception_if_processing_interrupted()
            return False
        except BaseException as err:  # noqa: BLE001 - 分类:取消 vs 真错误
            if classify_interrupt(err):
                print(f"[daoyan] 中断(用户取消):{type(err).__name__}",
                      flush=True)
                return True
            print(f"[daoyan] 中断检查异常(非取消,上抛):{err!r}", flush=True)
            raise

    def free_memory():
        """三采前卸载(批量役 POST /free {'unload_models': True} 同义)。"""
        from comfy.model_management import soft_empty_cache, unload_all_models
        unload_all_models()
        soft_empty_cache()

    def log(msg):
        print(f"[daoyan] {msg}", flush=True)

    def save_latent(rel, payload):
        """latent 检查点缓存(加速:☑2 单独零采样;本地受信文件)。"""
        import torch
        p = out_dir / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        torch.save(payload, p)

    def load_latent(rel):
        import torch
        p = out_dir / rel
        if not p.exists():
            return None
        try:
            return torch.load(p, map_location="cpu", weights_only=False)
        except Exception as err:  # 损坏缓存不当咬主路
            log(f"latent 缓存读取失败(作废重采样):{err}")
            return None

    hooks = Hooks(load_image=load_image, save_image=save_image,
                  list_output=list_output, output_path=output_path,
                  copy_to_input=copy_to_input, load_video=load_video,
                  ffmpeg=ffmpeg, send_event=send_event,
                  check_interrupt=check_interrupt, free_memory=free_memory,
                  log=log, open_run_log=open_run_log,
                  save_latent=save_latent, load_latent=load_latent)
    return {n: comfy_nodes.NODE_CLASS_MAPPINGS[n] for n in NEEDED_CLASSES}, hooks
