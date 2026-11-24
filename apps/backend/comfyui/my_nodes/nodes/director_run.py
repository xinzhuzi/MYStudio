"""director_run.py — 导演台执行链的运行层:逐镜调度器与引擎挂钩绑定(1124 超线文件拆分:自 director_executor.py 原样搬出)。

DirectorExecutor(计划→逐镜三采→finalize)与 bind_engine_hooks(引擎态装配:类注册表+文件系统/
事件/中断/卸载/日志钩子)。它要用到 director_executor.py 里的各 pass 与工具函数;外部仍经
director_executor.DirectorExecutor / director_executor.bind_engine_hooks 访问(原文件按需转出)。
"""

from __future__ import annotations

from pathlib import Path

from .daoyan_runlog import NullRunLog
from .director_plan import (
    OUT_DIR_ROOT,
    P1_NAME,
    P2_NAME,
    DRAFT_NAME,
    FINAL_NAME,
    artifact_prefix,
    resolve_plan,
    effective_seed,
    classify_interrupt,
    normalize_audio_names,
    shift_picture_tags,
    continuity_ref_names,
    resolve_continuity,
    ffmpeg_concat,
)
from .director_executor import (
    DirectorError,
    Hooks,
    PassCtx,
    STAGE_LABEL,
    _load_images_by_names,
    _stage_context,
    build_model_kit,
    emit_preview,
    latent_fingerprint,
    load_audios,
    load_refs,
    pass1,
    pass2,
    pass3,
)



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
        perf = state.get("perf") or {}
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
                f" skip={1 if seg.get('skip') else 0}"
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
                # 1115 缺口7:pass1 消费面(一采/☑2 重采样)进 stage 前算一次
                # 衔接图+effective refs/names+参考音频;pass2 refs 不动
                # (需求范围=pass1 图级衔接);指纹/缓存与 pass1 同输入(防串)
                prepared = False
                cont_key = cont_identity = None
                eff_refs: list = []
                eff_names: list = []
                auds: list = []
                audio_names: list = []
                seg_p1 = seg
                for stage in todo:
                    self._tick(unique_id, i, len(state["segments"]), stage,
                               done, total)
                    try:
                        if stage in ("yicai", "ercai") and kit is None:
                            kit = build_model_kit(self.C, model, log)
                        if stage in ("yicai", "ercai") and not prepared:
                            cont = resolve_continuity(state, artifacts, i,
                                                      self.H, log)
                            if cont is not None:
                                cont_key, cont_identity = cont
                            raw = [n for n in (state.get("common_images") or [])
                                   + (seg.get("images") or []) if n]
                            eff_names, _, dropped = continuity_ref_names(
                                raw, cont_key)
                            if cont_key:
                                log(f"段间引导 注入={cont_identity}"
                                    f" 预算弃=[{','.join(dropped)}]")
                            elif dropped:
                                log(f"参考图预算截尾(9槽/8异图,App 组装器"
                                    f"同口径):弃 [{','.join(dropped)}]")
                            eff_refs = _load_images_by_names(self.H, eff_names)
                            if cont_key:  # 衔接图占首槽→用户 <Picture N> +1
                                seg_p1 = dict(seg, prompt={
                                    k: shift_picture_tags(v, 1)
                                    for k, v in
                                    (seg.get("prompt") or {}).items()})
                            auds = load_audios(self.H, seg, log)
                            audio_names = normalize_audio_names(
                                seg.get("audios"))
                            prepared = True
                        if stage == "yicai":
                            p1_rel, av_latent, _ = pass1(
                                ctx, seg_p1, kit, eff_refs, model, video_vae,
                                audio_vae, clip, save=True,
                                ref_names=eff_names, audios=auds)
                            artifacts.setdefault(seg["id"], {})["p1"] = p1_rel
                            if self.H.save_latent and av_latent is not None:
                                # 种缓存:将来 ☑2 单独/重掷二采=零采样直吃
                                self.H.save_latent(artifact_prefix(
                                    state["chapter"], seg["id"], P1_NAME)
                                    + ".latent", {
                                        "fp": latent_fingerprint(
                                            state, seg_p1, eff_names,
                                            audios=audio_names,
                                            continuity=cont_identity),
                                        "latent": av_latent})
                        elif stage == "ercai":
                            if av_latent is None:
                                # 加速:latent 检查点缓存命中=零采样直吃
                                # (指纹含 seed/提示词/参考图/步数,变则作废)
                                fp = latent_fingerprint(
                                    state, seg_p1, eff_names,
                                    audios=audio_names,
                                    continuity=cont_identity)
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
                                        ctx, seg_p1, kit, eff_refs, model,
                                        video_vae, audio_vae, clip, save=False,
                                        ref_names=eff_names, audios=auds)
                                    if self.H.save_latent:
                                        self.H.save_latent(cache_rel, {
                                            "fp": fp, "latent": av_latent})
                                        log("latent 已缓存(下次二采单独零采样)")
                            # pass2 吃原面 refs(段间引导=pass1 域,不动)
                            refs, ref_names = load_refs(self.H, state, seg,
                                                        log)
                            p2_rel, _ = pass2(ctx, seg, kit, refs, av_latent,
                                              video_vae, audio_vae, clip,
                                              ref_names=ref_names, audios=auds)
                            artifacts.setdefault(seg["id"], {})["p2"] = p2_rel
                        else:  # sancai(三采前统一卸载:首批进三采时一次)
                            if not self._freed:
                                if perf.get("free_h3", True):
                                    log("三采前统一卸载(首次)")
                                    self.H.free_memory()
                                else:
                                    log("三采前卸载已关(perf.free_h3=False)")
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
                if perf.get("vram_clear", True) and len(runs) > 1:
                    try:
                        from comfy.model_management import soft_empty_cache
                        soft_empty_cache()
                    except Exception:
                        pass
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
                    if s.get("skip") is not True  # 1115:skip 段不入拼接源
                    and artifacts.get(s["id"], {}).get(key)]

        for key, label, out_key in plans:
            have = [(s["id"], artifacts.get(s["id"], {}).get(key))
                    for s in state["segments"]
                    if s.get("skip") is not True
                    and artifacts.get(s["id"], {}).get(key)]
            miss = [f"{s['id']}(无{key})"
                    for s in state["segments"]
                    if s.get("skip") is not True  # 1115:skip 段不算 miss 点名
                    and not artifacts.get(s["id"], {}).get(key)]
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
    "ReCaVSRUpscale", "LoadAudio",  # 1115 缺口5:参考音频(core 在册)
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
                if p.suffix.lower() in (".mp4", ".webm", ".mov", ".mkv")]

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

    def load_audio(name):
        # 1115 缺口5(修I):抄 load_image 先检纪律(input/name exists→
        # None 由执行链点名),不抄 load_video 裸调(缺件=裸 FileNotFoundError)
        p = input_dir / name
        if not p.exists():
            return None
        cls = comfy_nodes.NODE_CLASS_MAPPINGS["LoadAudio"]  # DSL execute 直调
        return cls.execute(audio=name)[0]

    def grab_last_frame(p1_rel, target_name):
        """前镜 p1 末帧→input/<target_name>(1115 缺口7;恒覆盖写=前镜重跑
        后旧帧即过期,幂等跳过废除修D)。ffmpeg -sseof 尾帧单发;失败 None
        (fallback 前镜首张参考图由 resolve_continuity 接管)。"""
        import subprocess
        src = out_dir / p1_rel
        if not src.exists():
            return None
        dst = input_dir / target_name
        try:
            proc = subprocess.run(
                ["ffmpeg", "-y", "-v", "error", "-sseof", "-0.1",
                 "-i", str(src), "-update", "1", "-frames:v", "1",
                 str(dst)], capture_output=True, text=True, timeout=120)
        except Exception:  # noqa: BLE001 - 抓帧失败=降级面,不咬主路
            return None
        return target_name if proc.returncode == 0 and dst.exists() else None

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
                  save_latent=save_latent, load_latent=load_latent,
                  load_audio=load_audio, grab_last_frame=grab_last_frame)
    return {n: comfy_nodes.NODE_CLASS_MAPPINGS[n] for n in NEEDED_CLASSES}, hooks
