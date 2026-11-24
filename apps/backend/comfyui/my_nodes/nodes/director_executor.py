# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台执行链(11-13-director-console-remake 阶段3+3.5,1114)。

结构借鉴 AIMixer/ComfyUI_MiniMaxH3_Director(Apache-2.0)executor 的
「计划→逐段循环→finalize」三段式——布局复刻、代码重写;采样内部零重写:
**直接调引擎在册节点类**(NODE_CLASS_MAPPINGS),配方与接线逐位取自纯净化
母本(单镜.json,66 节点),按引擎装载语义(widgets_values 位序对
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
from typing import Any

from .my_director_console import DIRECTOR_RECIPE
from .director_plan import (
    OUT_DIR_ROOT,
    P3_NAME,
    P2_NAME,
    P1_NAME,
    DRAFT_NAME,
    FINAL_NAME,
    PASS1_W,
    PASS1_H,
    PASS2_H,
    PASS2_W,
    artifact_prefix,
    resolve_plan,
    assemble_prompt,
    effective_seed,
    INTERRUPT_EXC_NAME,
    classify_interrupt,
    REF_SLOT_LIMIT,
    REF_DISTINCT_LIMIT,
    budget_ref_items,
    budget_ref_names,
    ref_name_list,
    MAX_AUDIO_REFS,
    normalize_audio_names,
    _PICTURE_TAG,
    shift_picture_tags,
    continuity_ref_names,
    resolve_continuity,
    FFMPEG_TIERS,
    ffmpeg_concat,
)


STAGE_LABEL = {"yicai": "一采", "ercai": "二采", "sancai": "三采"}


class DirectorError(RuntimeError):
    """计划级错误(缺上游/零勾选/类缺失/参考图缺失):逐镜点名,不静默跳过。"""


# ── 引擎动作集(注入式;默认装配在 my_director_console.bind_engine_hooks)──

class Hooks:
    def __init__(self, load_image=None, save_image=None, list_output=None,
                 output_path=None, copy_to_input=None, load_video=None,
                 ffmpeg=None, send_event=None, check_interrupt=None,
                 free_memory=None, log=None, open_run_log=None,
                 save_latent=None, load_latent=None,
                 load_audio=None, grab_last_frame=None):
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
        self.load_audio = load_audio          # input 文件名 -> AUDIO(缺件 None 点名)
        self.grab_last_frame = grab_last_frame  # (p1_rel, input名) -> input名|None


def latent_fingerprint(state: dict, seg: dict, ref_names, audios=None,
                       continuity=None) -> str:
    """av_latent 决定因素指纹(seed/模式/时长/提示词/参考图/步数/分辨率)。

    ☑2 单独的 latent 检查点缓存用它防串:任何输入变了→指纹变→缓存作废
    重采样(确定性同果)。1114 加速:二采单独免 ~一采采样时长/镜。
    1115 增两键:audios(参考音频名序;None=读 seg 兜底)与 continuity
    (段间衔接身份 f"{名}@{前镜p1 mtime_ns}";前镜 p1 重产→mtime 变→指纹
    变→陈 latent 作废,修D 裸名指纹吃陈缓存的坑就此钉死)。
    """
    import hashlib
    payload = json.dumps({
        "seed": effective_seed(state, seg),
        "mode": seg["mode"], "frames": seg["frames"],
        "prompt": seg.get("prompt") or {},
        "refs": list(ref_names or []),
        "audios": list(audios if audios is not None
                       else (seg.get("audios") or [])),
        "continuity": continuity or None,
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


def _load_images_by_names(hooks: Hooks, names) -> list:
    """按名装载参考图;缺件=DirectorError 点名(不静默跳过)。"""
    refs = []
    for name in names:
        img = hooks.load_image(name)
        if img is None:
            raise DirectorError(f"参考图 {name} 不在 input/,先在面板上传或改引用")
        refs.append(img)
    return refs


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
    return _load_images_by_names(hooks, names), names


def load_audios(hooks: Hooks, seg: dict, log=None) -> list:
    """按名装载参考音频(防御性去重≤3,对 canonical 输入 no-op);缺件=
    DirectorError 点名「参考音频 X 不在 input/」不静默跳(修I:引擎绑
    load_audio exists 先检→None,不裸 FileNotFoundError)。"""
    names = normalize_audio_names(seg.get("audios"))
    if not names:
        return []
    loader = getattr(hooks, "load_audio", None)
    out = []
    for name in names:
        audio = loader(name) if callable(loader) else None
        if audio is None:
            raise DirectorError(f"参考音频 {name} 不在 input/,先在面板上传或改引用")
        out.append(audio)
    if log:
        log(f"参考音频 装载=[{','.join(names)}]")
    return out


def conditioning(ctx: PassCtx, seg: dict, refs, ref_names, width, height,
                 clip, video_vae, audio_vae, audios=None):
    """t2v/r2v→ReferenceToVideo[16];i2v/fl2v→ImageToVideo[220](单源)。

    参考图顺序=面板 <Picture N> 语义(公共图区 1-3,本组从 4 续);
    i2v 首帧=本组分镜帧优先(seg.images[0]),fl2v 尾帧=本组末张;
    无名画布直喂张量(壳路径)直接作首帧。cond 行+prompt 全文逐字留痕。
    1115 缺口5:audios(已装载 AUDIO 张量,≤3)→ref_audios 聚合字典
    {ref_audio_N: AUDIO}(仿 ref_images AUTOGROW 口径);i2v/fl2v 分支
    不接(方案裁定)。
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
        if audios:
            kw["ref_audios"] = {f"ref_audio_{j}": a
                                for j, a in enumerate(audios[:MAX_AUDIO_REFS])}
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
          save=True, ref_names=None, audios=None):
    """一采(单源):采样→解码→(save)p1-draft;恒返 av_latent 供二采。

    返回 (p1_rel|None, av_latent, video|None):save=False=☑2 单独吃盘上 p1
    的确定性重采样(只取 latent,不落盘不解码);video=CreateVideo 产物
    (壳节点 VIDEO 出口用;save=False 时 None)。audios=参考音频张量
    (1115 缺口5;None=壳路径 no-op)。
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
                                clip, video_vae, audio_vae, audios=audios)
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
          clip, ref_names=None, audios=None):
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
                           clip, video_vae, audio_vae, audios=audios)
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


# ── 按需转出口(1124 超线文件拆分)────────────────────────────────────────────
# 下面这些名字住在 .director_run;它们要用到本文件里的定义,在本文件顶部 import 会
# 循环导入,故改为访问时再取。外部用法不变:director_executor.<名字> /
# from .director_executor import <名字>。
_LAZY_EXPORTS = frozenset({"DirectorExecutor", "NEEDED_CLASSES", "bind_engine_hooks"})


def __getattr__(name):
    if name in _LAZY_EXPORTS:
        from .director_run import DirectorExecutor, NEEDED_CLASSES, bind_engine_hooks

        return {
            "DirectorExecutor": DirectorExecutor,
            "NEEDED_CLASSES": NEEDED_CLASSES,
            "bind_engine_hooks": bind_engine_hooks,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
