# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台执行链(11-13-director-console-remake 阶段3,1114)。

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

可注入式:classes/hooks 全可换=无头 pytest 伪类干跑(零引擎零 GPU);
引擎真绑= my_director_console.execute(lazy import)。
"""
from __future__ import annotations

from typing import Any, Callable

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
        found = [p for p in (list_output(prefix) or []) if not p.endswith(".bak")]
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
                 free_memory=None, log=None):
        self.load_image = load_image          # input 文件名 -> IMAGE
        self.save_image = save_image          # (images, prefix) -> UI dict
        self.list_output = list_output        # prefix -> [output 相对路径]
        self.output_path = output_path        # 相对路径 -> 绝对 Path
        self.copy_to_input = copy_to_input    # output 相对路径 -> input 文件名
        self.load_video = load_video          # input 文件名 -> VIDEO
        self.ffmpeg = ffmpeg                  # (output相对路径列表, 出) -> None
        self.send_event = send_event          # (type, payload) -> None
        self.check_interrupt = check_interrupt
        self.free_memory = free_memory
        self.log = log or (lambda *a: None)


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


class ModelKit:
    """三臂模型链(母本 [145/216/202] 三 LoRA 臂;每次执行构建一次)。

    BSA 参数=引擎装载母本的同一语义:widgets[sol-attn,1.3,0,1] 位序赋给
    required(selection,start_percent,end_percent,dense_blocks),其余吃默认
    ——与三采收官实跑逐位同值(fidelity-by-construction)。
    """

    def __init__(self, classes: dict, model: Any):
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

        # r2v 臂 [145→262→263→140]
        m = lora(*r["lora_r2v"], model)
        self.r2v = kitchen(cff(bsa_(m), 2))
        # i2v 臂 [216→260→261→217→251](σ(6,3) 恒供调度器,母本接线原样)
        m = lora(*r["lora_i2v"], model)
        self.sigma_p1 = _call(classes, "MiniMaxH3SigmaShift",
                              model=kitchen(cff(bsa_(m), 2)),
                              shift_video=6.0, shift_audio=3.0)[0]
        # 二采臂 [202→267→223→203→215]
        m = lora(*r["lora_second_pass"], model)
        self.sigma_p2 = _call(classes, "MiniMaxH3SigmaShift",
                              model=cff(bsa_(m), 1),
                              shift_video=12.0, shift_audio=3.0)[0]
        self.kitchen_p2 = kitchen(self.sigma_p2)

    def preview_wrap(self, classes, model, video_vae, audio_vae):
        """[266] ModelPreviewOverrideKJ:实时预览原生通道(母本 widgets 原样)。

        可失败降级:该件吃执行上下文(dynprompt,1114 R1 实弹四拦定谳),
        节点内直调无上下文=AttributeError;预览加速非正确性依赖,失败即
        回退裸臂模型(采样配方零影响;面板实时预览走 daoyan_preview 事件)。
        """
        try:
            return _call(classes, "ModelPreviewOverrideKJ", model=model,
                         max_resolution=1024, jpeg_quality=80,
                         suppress_default_preview=True, preview_frames=1,
                         preview_fps=12, vae=video_vae,
                         tiny_vae="taeh3.safetensors", audio_vae=audio_vae)[0]
        except Exception as err:
            return model


class DirectorExecutor:
    """逐镜三采调度器(AIMixer executor 主循环同构,拆写为注入式)。"""

    def __init__(self, classes: dict, hooks: Hooks):
        self.C = classes
        self.H = hooks

    # ── 条件与潜空间 ────────────────────────────────────────────────
    def _conditioning(self, state, seg, refs, width, height, clip,
                      video_vae, audio_vae):
        """t2v/r2v→ReferenceToVideo[16];i2v/fl2v→ImageToVideo[220]。

        参考图顺序=面板 <Picture N> 语义(公共图区 1-3,本组从 4 续);
        i2v 首帧=本组分镜帧优先(seg.images[0]),fl2v 尾帧=本组末张。
        """
        prompt = assemble_prompt(seg)
        mode = seg["mode"]
        frames = seg["frames"]
        if mode in ("t2v", "r2v"):
            kw = dict(clip=clip, prompt=prompt, width=width, height=height,
                      length=frames, ref_image_size="max")  # 产线定谳:ref 恒 max
            if mode == "r2v":
                kw.update(vae=video_vae, audio_vae=audio_vae)
                # AUTOGROW 类直调=聚合字典 {ref_image_N: IMAGE}(引擎把点分
                # 子槽聚成 dict 传类;1114 R1 实弹三拦定谳,消费方
                # .values()/.items() 遍历)
                kw["ref_images"] = {f"ref_image_{j}": img
                                    for j, img in enumerate(refs[:9])}
            return _call(self.C, "MiniMaxH3ReferenceToVideo", **kw)
        own = seg.get("images") or []
        kw = dict(clip=clip, vae=video_vae, prompt=prompt, width=width,
                  height=height, length=frames)
        if own or refs:
            kw["first_frame"] = self.H.load_image(own[0] if own else refs[0])
            if mode == "fl2v" and len(own) > 1:
                kw["last_frame"] = self.H.load_image(own[-1])
        return _call(self.C, "MiniMaxH3ImageToVideo", **kw)

    def _sample(self, seed, guider_model, conditioning, sampler, sigmas, latent):
        noise = _call(self.C, "RandomNoise", noise_seed=seed)[0]
        guider = _call(self.C, "BasicGuider", model=guider_model,
                       conditioning=conditioning)[0]
        return _call(self.C, "SamplerCustomAdvanced", noise=noise,
                     guider=guider, sampler=sampler, sigmas=sigmas,
                     latent_image=latent)

    def _save_video(self, video, chapter, seg_id, name) -> str:
        prefix = artifact_prefix(chapter, seg_id, name)
        for old in [p for p in (self.H.list_output(prefix) or [])
                    if not p.endswith(".bak")]:  # 重掷:旧件让名(SaveVideo 自增计数)
            src = self.H.output_path(old)
            if src:
                src.rename(str(src) + ".bak")
        _call(self.C, "SaveVideo", video=video, filename_prefix=prefix,
              format={"format": "auto"})
        hits = [p for p in (self.H.list_output(prefix) or [])
                if not p.endswith(".bak")]
        if not hits:
            raise DirectorError(f"SaveVideo 未落盘:{prefix}")
        self.H.log(f"[daoyan] 落盘 {hits[0]}")
        return hits[0]

    def _video_from(self, images, audio):
        """[130] CreateVideo(母本 widgets 24/8/sRGB/none)。"""
        return _call(self.C, "CreateVideo", images=images, fps=24, audio=audio,
                     bit_depth="auto", color_space="sRGB",
                     chroma_subsampling="auto", codec="none")[0]

    # ── 三采 ───────────────────────────────────────────────────────
    def _pass1(self, state, seg, kit, refs, model, video_vae, audio_vae, clip,
               save=True):
        """一采:采样→解码→(save)p1-draft;恒返 av_latent 供二采。"""
        cond, latent = self._conditioning(state, seg, refs, PASS1_W, PASS1_H,
                                          clip, video_vae, audio_vae)
        arm = kit.r2v if seg["mode"] in ("t2v", "r2v") else kit.sigma_p1
        guider_model = kit.preview_wrap(self.C, arm, video_vae, audio_vae)
        sampler = _call(self.C, "KSamplerSelect",
                        sampler_name=DIRECTOR_RECIPE["sampler_first_pass"])[0]
        sigmas = _call(self.C, "BasicScheduler", model=kit.sigma_p1,
                       scheduler="simple",
                       steps=state["advanced"]["first_steps"], denoise=1.0)[0]
        samples, av_latent = self._sample(effective_seed(state, seg),
                                          guider_model, cond, sampler,
                                          sigmas, latent)
        if not save:  # ☑2 单独吃盘上 p1:重采样只取 latent(批量役 stage2 同义)
            return None, av_latent
        images = _call(self.C, "VAEDecode", samples=samples, vae=video_vae)[0]
        audio = _call(self.C, "VAEDecodeAudio", samples=samples, vae=audio_vae)[0]
        self._emit_preview(state, seg["id"], images)
        return self._save_video(self._video_from(images, audio),
                                state["chapter"], seg["id"], P1_NAME), av_latent

    def _pass2(self, state, seg, kit, refs, av_latent, video_vae, audio_vae,
               clip):
        """二采:潜放大 1440×832 + taomate 3步 σ(12,3) → p2-final。"""
        video_latent, audio_latent = _call(self.C, "LTXVSeparateAVLatent",
                                           av_latent=av_latent)
        up = _call(self.C, "MinimaxH3LatentUpscaler3D", latent=video_latent,
                   model_name="minimax_h3_latent_upscaler",
                   mode={"mode": "target dimensions", "width": PASS2_W,
                         "height": PASS2_H},
                   align=32, enable_temporal_chunking=True, force_unload=True,
                   device="cuda", precision="fp16")[0]
        latent = _call(self.C, "LTXVConcatAVLatent", video_latent=up,
                       audio_latent=audio_latent)[0]
        cond, _ = self._conditioning(state, seg, refs, PASS2_W, PASS2_H,
                                     clip, video_vae, audio_vae)
        guider_model = kit.preview_wrap(self.C, kit.kitchen_p2, video_vae,
                                        audio_vae)
        sampler = _call(self.C, "KSamplerSelect",
                        sampler_name=DIRECTOR_RECIPE["sampler_first_pass"])[0]
        sigmas = _call(self.C, "BasicScheduler", model=kit.sigma_p2,
                       scheduler="simple",
                       steps=state["advanced"]["second_steps"],
                       denoise=DIRECTOR_RECIPE["second_pass_denoise"])[0]
        samples, _ = self._sample(effective_seed(state, seg), guider_model,
                                  cond, sampler, sigmas, latent)
        images = _call(self.C, "VAEDecode", samples=samples, vae=video_vae)[0]
        audio = _call(self.C, "VAEDecodeAudio", samples=samples, vae=audio_vae)[0]
        self._emit_preview(state, seg["id"], images)
        return self._save_video(self._video_from(images, audio),
                                state["chapter"], seg["id"], P2_NAME)

    def _pass3(self, state, seg, p2_rel, seed):
        """三采:文件化交接吃 p2(output→input→LoadVideo,批量役 stage3 同工艺)。"""
        if not p2_rel:
            raise DirectorError(f"第N镜({seg['id']})p2 缺失,三采无从起")
        name = self.H.copy_to_input(p2_rel)
        video_in = self.H.load_video(name)
        rc_model = _call(self.C, "ReCaVSRLoader",
                         transformer=DIRECTOR_RECIPE["recavsr_transformer"])[0]
        out = _call(self.C, "ReCaVSRUpscale", model=rc_model, scale=2.0,
                    color_fix=state["color_fix"], seed=seed,
                    decoder="flashdecoder", kernels="fast", kv_offload=False,
                    encoder="auto", fps=30.0, video=video_in)[0]
        return self._save_video(out, state["chapter"], seg["id"], P3_NAME)

    def _emit_preview(self, state, seg_id, images):
        try:
            ui = self.H.save_image(images[:1],
                                   f"daoyan_preview/{state['chapter']}")
            url = None
            if isinstance(ui, dict) and ui.get("filename"):
                url = (f"/view?filename={ui['filename']}"
                       f"&subfolder={ui.get('subfolder', '')}"
                       f"&type={ui.get('type', 'output')}")
            self.H.send_event("daoyan_preview", {"segment_id": seg_id,
                                                 "url": url})
        except Exception as err:  # 预览失败不咬主路
            self.H.log(f"[daoyan] 预览事件失败(不咬主路):{err}")

    # ── 主循环(AIMixer executor 主循环同构)─────────────────────────
    def run(self, model, video_vae, audio_vae, clip, state: dict,
            unique_id=None) -> dict:
        chapter = state["chapter"]
        runs, errors, artifacts = resolve_plan(state, self.H.list_output)
        if errors:
            raise DirectorError("; ".join(errors))
        kit = ModelKit(self.C, model)
        total = len(runs)
        done = 0
        cancelled = False
        for item in runs:
            i, seg, todo = item["index"], item["seg"], item["do"]
            av_latent = None
            for stage in todo:
                self._tick(unique_id, i, len(state["segments"]), stage,
                           done, total)
                try:
                    refs = self._load_refs(state, seg)
                    if stage == "yicai":
                        p1_rel, av_latent = self._pass1(
                            state, seg, kit, refs, model, video_vae, audio_vae,
                            clip, save=True)
                        artifacts.setdefault(seg["id"], {})["p1"] = p1_rel
                    elif stage == "ercai":
                        if av_latent is None:  # 吃盘上 p1:确定性重采样取 latent
                            _, av_latent = self._pass1(
                                state, seg, kit, refs, model, video_vae,
                                audio_vae, clip, save=False)
                        p2_rel = self._pass2(state, seg, kit, refs, av_latent,
                                             video_vae, audio_vae, clip)
                        artifacts.setdefault(seg["id"], {})["p2"] = p2_rel
                    else:  # sancai(三采前统一卸载:首批进三采时一次)
                        if not getattr(self, "_freed", False):
                            self.H.free_memory()
                            self._freed = True
                        p2_rel = artifacts.get(seg["id"], {}).get("p2") or next(
                            (p for p in (self.H.list_output(
                                artifact_prefix(chapter, seg["id"], P2_NAME))
                                or []) if not p.endswith(".bak")), None)
                        p3_rel = self._pass3(state, seg, p2_rel,
                                             effective_seed(state, seg))
                        artifacts.setdefault(seg["id"], {})["p3"] = p3_rel
                except DirectorError as err:
                    raise DirectorError(f"第{i + 1}镜({seg['id']}):{err}") from err
                self._emit_artifact(unique_id, i, seg["id"], artifacts[seg["id"]])
                if self.H.check_interrupt():
                    cancelled = True  # 检查点语义:已完镜保留,就地停
                    break
            if cancelled:
                break
            done += 1

        chapter_outputs = self._finalize(chapter, state, artifacts, cancelled)
        self.H.send_event("daoyan_progress", {
            "node_id": unique_id,
            "message": ("已取消(已完镜产物保留)" if cancelled else "全部完成")
                       + f" {done}/{total} 镜"})
        return {"artifacts": artifacts, "chapter_outputs": chapter_outputs,
                "done": done, "total": total, "cancelled": cancelled}

    def _load_refs(self, state, seg) -> list:
        """r2v 参考图序列=公共(角色卡,Picture 1-3)+本组(分镜帧,4+),≤9。"""
        names = ((state.get("common_images") or [])
                 + (seg.get("images") or []))[:9]
        refs = []
        for name in names:
            if not name:
                continue
            img = self.H.load_image(name)
            if img is None:
                raise DirectorError(f"参考图 {name} 不在 input/,先在面板上传或改引用")
            refs.append(img)
        return refs

    def _finalize(self, chapter, state, artifacts, cancelled):
        """章草片(p1 拼接)/章终片(p3 拼接):ffmpeg 外拼(批量役 concat 同款)。
        取消=不拼半章(已完镜检查点在盘,补跑完成后自拼)。"""
        out = {}
        if cancelled:
            return out

        def rels(key):
            return [artifacts.get(s["id"], {}).get(key)
                    for s in state["segments"]
                    if artifacts.get(s["id"], {}).get(key)]

        if state["stages"]["yicai"] and not state["stages"]["sancai"]:
            p1s = rels("p1")
            if p1s:
                target = f"{OUT_DIR_ROOT}/{chapter}/{DRAFT_NAME}.mp4"
                self.H.ffmpeg(p1s, target)
                out["draft"] = target
        if state["stages"]["sancai"]:
            p3s = rels("p3")
            if p3s:
                target = f"{OUT_DIR_ROOT}/{chapter}/{FINAL_NAME}.mp4"
                self.H.ffmpeg(p3s, target)
                out["final"] = target
        return out

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
    """引擎态装配:类注册表+文件系统/事件/中断/卸载钩子(1112 批量役
    同工艺:output 检查点 glob/input 通道装载/ffmpeg concat -c copy)。"""
    import shutil
    import subprocess
    from pathlib import Path

    import nodes as comfy_nodes
    import folder_paths
    from server import PromptServer

    missing = [n for n in NEEDED_CLASSES if n not in comfy_nodes.NODE_CLASS_MAPPINGS]
    if missing:
        raise DirectorError("引擎缺节点类:" + ",".join(missing))

    out_dir = Path(folder_paths.get_output_directory())
    input_dir = Path(folder_paths.get_input_directory())

    def list_output(prefix):
        return [str(p.relative_to(out_dir))
                for p in sorted(out_dir.glob(prefix + "*"))]

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

    def ffmpeg(rels, out_rel):
        """章级拼接(批量役 concat 同款:-f concat -safe 0 -c copy)。"""
        out = out_dir / out_rel
        out.parent.mkdir(parents=True, exist_ok=True)
        lst = out.with_suffix(".txt")
        lst.write_text("".join(f"file '{r}'\n" for r in rels),
                       encoding="utf-8")
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
             "-i", lst.name, "-c", "copy", out.name],
            check=True, cwd=str(out_dir))
        lst.unlink(missing_ok=True)

    def send_event(etype, payload):
        try:
            PromptServer.Instance.send_sync(etype, payload)
        except Exception:
            pass  # 面板不在线(程序化直投)时事件静默

    def check_interrupt():
        try:
            from comfy.model_management import \
                throw_exception_if_processing_interrupted
            throw_exception_if_processing_interrupted()
            return False
        except Exception:
            return True

    def free_memory():
        """三采前卸载(批量役 POST /free {'unload_models': True} 同义)。"""
        from comfy.model_management import soft_empty_cache, unload_all_models
        unload_all_models()
        soft_empty_cache()

    hooks = Hooks(load_image=load_image, save_image=save_image,
                  list_output=list_output, output_path=output_path,
                  copy_to_input=copy_to_input, load_video=load_video,
                  ffmpeg=ffmpeg, send_event=send_event,
                  check_interrupt=check_interrupt, free_memory=free_memory)
    return {n: comfy_nodes.NODE_CLASS_MAPPINGS[n] for n in NEEDED_CLASSES}, hooks
