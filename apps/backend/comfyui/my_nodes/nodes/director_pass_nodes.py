# Copyright (c) 2025 hotflow2024
# Licensed under AGPL-3.0-or-later. See LICENSE for details.
# Commercial licensing available. See COMMERCIAL_LICENSE.md.
"""导演台三采调试薄壳(11-13-director-console-remake 阶段3.5,1114)。

采子图探查路线B(用户定案):三采执行核已抽为 director_executor 模块级
单源函数(PassCtx/build_model_kit/pass1/pass2/pass3),本件=三个独立
调试节点把 widgets 显式参数组装成 seg+ctx 后委托单源——**与导演台
MyDirectorConsole 同一执行真源**(类调用序列逐位同构,test_director_
pass_nodes.py::test_single_source_parity 钉死)。

画布用法(导演台.json 零动,本件仅注册不进导演台工作流):
- 调试画布=四 loader→Pass1→(LATENT)→Pass2→(VIDEO)→Pass3 一条链单镜
  调试;或任一壳单独接 LoadVideo/LoadImage 手喂。
- 多镜循环恒留 Python(导演台;镜数动态,画布表达不了)。
- 产物落与导演台检查点同目录(video/导演台/{chapter}/{seg_id}/
  p1-draft|p2-final|p3-recavsr)=调试产物可直接被导演台 ☑2/☑3 复用。

仅注册面=my_nodes/__init__.py 双表;零改 ComfyUI 本体。
"""
from __future__ import annotations

from .director_executor import (REF_DISTINCT_LIMIT, PassCtx,
                                budget_ref_names, build_model_kit, pass1,
                                pass2, pass3)
from .my_director_console import DIRECTOR_RECIPE

CATEGORY = "漫影/导演台"
_PROMPT_FIELDS = ("summary", "retention", "description", "soundscape")


def _bind_engine_hooks():
    """引擎态装配(director_executor.bind_engine_hooks 委托;测试注入位:
    monkeypatch 本模块级名即可伪 classes/hooks 干跑)。"""
    from .director_executor import bind_engine_hooks
    return bind_engine_hooks()


def _open_log(hooks, chapter):
    opener = getattr(hooks, "open_run_log", None)
    if callable(opener):
        try:
            return opener(chapter)
        except Exception:  # noqa: BLE001 - 日志开不了不咬执行
            pass
    from .daoyan_runlog import NullRunLog
    return NullRunLog()


def _split_ref_names(ref_names) -> list[str]:
    """ref_names widget:逗号/换行分隔 input/ 文件名序列。"""
    if not ref_names:
        return []
    return [x.strip() for x in str(ref_names).replace("\n", ",").split(",")
            if x.strip()]


def _load_ref_images(hooks, names, extra_image=None):
    """按名装载参考图(缺件=DirectorError 点名);画布直喂张量排末位。"""
    refs = []
    for name in names:
        img = hooks.load_image(name)
        if img is None:
            raise Exception(  # noqa: TRY003 - 壳层直接可读
                f"参考图 {name} 不在 input/,先上传或改引用")
        refs.append(img)
    if extra_image is not None:
        refs.append(extra_image)
    return refs


def _prompt_kwargs():
    return {f"prompt_{k}": ("STRING", {"multiline": True, "default": ""})
            for k in _PROMPT_FIELDS}


class MyDaoyanPass1:
    """导演台·一采单镜:四模型口→(VIDEO, LATENT);恒落盘 p1-draft。"""

    CATEGORY = CATEGORY
    FUNCTION = "execute"
    RETURN_TYPES = ("VIDEO", "LATENT")
    OUTPUT_TOOLTIPS = ("一采 CreateVideo 产物(p1-draft 已落盘检查点目录)",
                       "av_latent(喂二采壳 av_latent 口=免重采样直通)")

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "video_vae": ("VAE",),
                "audio_vae": ("VAE",),
                "clip": ("CLIP",),
                "mode": (["t2v", "i2v", "fl2v", "r2v"], {"default": "r2v"}),
                "frames": ("INT", {"default": 124, "min": 5, "step": 17}),
                "seed": ("INT", {"default": 42}),
                **_prompt_kwargs(),
                "ref_names": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "input/ 参考图文件名,逗号/换行分隔(公共卡在前)"}),
                "chapter": ("STRING", {"default": "chapter-debug"}),
                "seg_id": ("STRING", {"default": "debug-01"}),
            },
            "optional": {"ref_image": ("IMAGE",)},
        }

    def execute(self, model, video_vae, audio_vae, clip, mode="r2v",
                frames=124, seed=42, prompt_summary="", prompt_retention="",
                prompt_description="", prompt_soundscape="", ref_names="",
                chapter="chapter-debug", seg_id="debug-01", ref_image=None):
        classes, hooks = _bind_engine_hooks()
        log = _open_log(hooks, chapter)
        # 9槽/8异图预算(1114 用户裁定):画布直喂张量占 1 异图名额
        # (名预算让位;末端口径 conditioning 再兜底)
        names, _, dropped = budget_ref_names(
            _split_ref_names(ref_names),
            distinct=REF_DISTINCT_LIMIT - (0 if ref_image is None else 1))
        if dropped:
            log(f"参考图预算截尾(画布直喂张量占1异图名额):"
                f"弃 [{','.join(dropped)}]")
        seg = {"id": seg_id, "mode": mode, "frames": int(frames),
               "seed": int(seed),
               "prompt": dict(zip(_PROMPT_FIELDS,
                                  (prompt_summary, prompt_retention,
                                   prompt_description, prompt_soundscape))),
               "images": list(names)}
        ctx = PassCtx(classes=classes, hooks=hooks, chapter=chapter,
                      seg_index=0,
                      first_steps=DIRECTOR_RECIPE["first_pass_steps"],
                      second_steps=DIRECTOR_RECIPE["second_pass_steps"],
                      log=log, seed=int(seed), color_fix="none")
        refs = _load_ref_images(hooks, names, ref_image)
        kit = build_model_kit(classes, model, log)
        _, av_latent, video = pass1(ctx, seg, kit, refs, model, video_vae,
                                    audio_vae, clip, save=True,
                                    ref_names=names)
        return (video, av_latent)


class MyDaoyanPass2:
    """导演台·二采单镜:不接 av_latent=确定性重采样路;落盘 p2-final。"""

    CATEGORY = CATEGORY
    FUNCTION = "execute"
    RETURN_TYPES = ("VIDEO",)
    OUTPUT_TOOLTIPS = ("二采 CreateVideo 产物(p2-final 已落盘检查点目录)",)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "video_vae": ("VAE",),
                "audio_vae": ("VAE",),
                "clip": ("CLIP",),
                "mode": (["t2v", "i2v", "fl2v", "r2v"], {"default": "r2v"}),
                "frames": ("INT", {"default": 124, "min": 5, "step": 17}),
                "seed": ("INT", {"default": 42}),
                **_prompt_kwargs(),
                "ref_names": ("STRING", {
                    "default": "", "multiline": True,
                    "tooltip": "input/ 参考图文件名,逗号/换行分隔(与一采同参)"}),
                "chapter": ("STRING", {"default": "chapter-debug"}),
                "seg_id": ("STRING", {"default": "debug-01"}),
            },
            "optional": {"av_latent": ("LATENT",)},
        }

    def execute(self, model, video_vae, audio_vae, clip, mode="r2v",
                frames=124, seed=42, prompt_summary="", prompt_retention="",
                prompt_description="", prompt_soundscape="", ref_names="",
                chapter="chapter-debug", seg_id="debug-01", av_latent=None):
        classes, hooks = _bind_engine_hooks()
        log = _open_log(hooks, chapter)
        # 9槽/8异图预算(1114 用户裁定;末端口径 conditioning 再兜底)
        names, _, dropped = budget_ref_names(_split_ref_names(ref_names))
        if dropped:
            log(f"参考图预算截尾(9槽/8异图,App 组装器同口径):"
                f"弃 [{','.join(dropped)}]")
        seg = {"id": seg_id, "mode": mode, "frames": int(frames),
               "seed": int(seed),
               "prompt": dict(zip(_PROMPT_FIELDS,
                                  (prompt_summary, prompt_retention,
                                   prompt_description, prompt_soundscape))),
               "images": list(names)}
        ctx = PassCtx(classes=classes, hooks=hooks, chapter=chapter,
                      seg_index=0,
                      first_steps=DIRECTOR_RECIPE["first_pass_steps"],
                      second_steps=DIRECTOR_RECIPE["second_pass_steps"],
                      log=log, seed=int(seed), color_fix="none")
        refs = _load_ref_images(hooks, names)
        kit = build_model_kit(classes, model, log)
        if av_latent is None:  # 确定性重采样路(吃同 seed 一采 latent)
            _, av_latent, _ = pass1(ctx, seg, kit, refs, model, video_vae,
                                    audio_vae, clip, save=False,
                                    ref_names=names)
        _, video = pass2(ctx, seg, kit, refs, av_latent, video_vae,
                         audio_vae, clip, ref_names=names)
        return (video,)


class MyDaoyanPass3:
    """导演台·三采单镜:p2_video 画布直喂(LoadVideo 或 Pass2 出口)。"""

    CATEGORY = CATEGORY
    FUNCTION = "execute"
    RETURN_TYPES = ("VIDEO",)
    OUTPUT_TOOLTIPS = ("三采 ReCaVSR 终片(p3-recavsr 已落盘检查点目录)",)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "p2_video": ("VIDEO",),
                "color_fix": (["none", "adain", "wavelet"],
                              {"default": "none"}),
                "seed": ("INT", {"default": 42}),
                "chapter": ("STRING", {"default": "chapter-debug"}),
                "seg_id": ("STRING", {"default": "debug-01"}),
            },
        }

    def execute(self, p2_video, color_fix="none", seed=42,
                chapter="chapter-debug", seg_id="debug-01"):
        classes, hooks = _bind_engine_hooks()
        log = _open_log(hooks, chapter)
        ctx = PassCtx(classes=classes, hooks=hooks, chapter=chapter,
                      seg_index=0,
                      first_steps=DIRECTOR_RECIPE["first_pass_steps"],
                      second_steps=DIRECTOR_RECIPE["second_pass_steps"],
                      log=log, seed=int(seed), color_fix=color_fix)
        seg = {"id": seg_id, "seed": int(seed)}
        _, video = pass3(ctx, seg, p2_video, int(seed))
        return (video,)
