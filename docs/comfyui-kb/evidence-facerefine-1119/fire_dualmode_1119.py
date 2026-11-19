#!/usr/bin/env python3
"""Dual-mode live fire (1119): four-collect subgraph of the new danjing.json (97-node dual-gear).

Two shots, same source/ref/seed/frames, serial (far first, then hd):
  far : 5111=False (1065=True face repair on)  -> exit 5023 far chain      -> dualmode/far
  hd  : 5111=True  (SAM3 mask + VOSR2 + 5024/5025 copy pair live)          -> dualmode/hd

hd2 fix (1119, mask autopsy): 5024 masks=[5104] was a silent passthrough.
Probe maskprobe1119 (A/B arms, probe_mask_1119.py): SAM3_VideoTrack text
"face" detects NOTHING on the 5011 crop canvases -> tracker.py 1790-91
packed_masks=None -> comfy_extras/nodes_sam3.py 498-500 returns zeros(N,768,768)
-> stitch masks branch mask_can==0 (nodes.py 2277-2287) -> mm_==0 -> out=base.
"person" arm is not a fix either (tracks die by f60 + person!=face semantics).
Minimal fix = masks dangling on 5024: paste_region=face_only already builds the
mask from transform.face_rect (nodes.py 2291-2300), the path proven by far.
hd tier keeps its real differentiator: VOSR2 refined crops (5110).

Graph = faithful API assembly of the four-collect group in
  apps/backend/comfyui/workflows/2_video/H3/1_manying-self-r2v/danjing.json (md5 cdd88a8b)
with 4002 (ReCaVSRUpscale in-memory p3) replaced by LoadVideo(src_4k_p3.mp4), per the
probe-1119 precedent. Canonical widgets aligned; links always ["id", slot]; seed sent as
plain int (control pseudo-widget omitted); VHS LoadVideo output consumed via GetVideoComponents.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ENGINE = "http://192.168.0.101:17000"
CLIENT = "dualmode-1119-" + uuid.uuid4().hex[:8]
HERE = os.path.dirname(os.path.abspath(__file__))

SRC_FILE = "src_4k_p3.mp4"          # 3840x2220x175 frames, with audio, already on engine input
REF_FILE = "ref_ch002_face.png"     # already on engine input
LENGTH = 175                        # source frame count; 175 = 5 + 17*10 on the 17k+5 grid
SEED = 42

IDENTITY_PROMPT = ("The same person as in the video: sharp detailed facial features, clear "
                   "bright eyes, well-defined facial contour, refined natural skin texture, "
                   "clean hair edges; keep the exact facial identity, skin tone and lighting "
                   "direction unchanged, no character redesign.")

TAGS = {"far": "dualmode/far", "hd": "dualmode/hd", "hd2": "dualmode/hd2"}
HD_TAGS = ("hd", "hd2")


class NoProxy:
    def __init__(self):
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def get(self, path, timeout=30):
        with self.opener.open(ENGINE + path, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def post_json(self, path, body, timeout=60):
        req = urllib.request.Request(ENGINE + path, data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json"})
        with self.opener.open(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))

    def download(self, path, dest, timeout=1800):
        with self.opener.open(ENGINE + path, timeout=timeout) as r, open(dest, "wb") as f:
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)


NET = NoProxy()


def track_crop_inputs(images, clip_vision):
    # canonical values, aligned with danjing.json node 5011 widgets
    return dict(
        images=images, identity_clip_vision=clip_vision,
        detector="face_yolov8m.pt", confidence=0.15, crop_factor=2.5,
        canvas_width=768, canvas_height=768, canvas_mode="auto_capped_768",
        smooth_window=21, size_smooth_window=51, smooth_method="gaussian",
        size_mode="per_frame", identity_track=True, identity_threshold=0.0,
        select="closest_to_xy", fallback_detector="segm\\person_yolov8m-seg.pt",
        fallback_head_frac=0.5, select_index=0, identity_model="clip_vision",
        cut_detection="none", cut_threshold=3.0, absent_shots="off",
        X=1920, Y=900, frame_index=170)


def stitch_inputs(base, crops, transform, masks=None):
    d = dict(base_images=base, refined_crops=crops, transform=transform,
             paste_region="face_only", mask_dilation=16, feather=24,
             colour_match=1.0, blend=1.0, undetected_frames="fade_out",
             feather_scales_with_crop=False)
    if masks is not None:
        d["masks"] = masks
    return d


def base_graph() -> dict:
    g = {}

    def N(cid, cls, **kw):
        g[str(cid)] = {"class_type": cls, "inputs": kw}

    # source & loaders (4002 p3 in-memory -> LoadVideo, probe precedent)
    N(41, "LoadVideo", file=SRC_FILE)
    N(1, "LoadImage", image=REF_FILE)
    N(800, "CLIPVisionLoader", clip_name="clip_vision_g.safetensors")
    N(1001, "UNETLoader",
      unet_name="Cobijada_H3_Hybrid_Uncensored_pruned_hybrid_int8_convrot_pruned.safetensors",
      weight_dtype="default")
    N(1002, "CLIPLoader", clip_name="qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
      type="minimax", device="default")
    N(1003, "VAELoader", vae_name="minimax_h3_video_vae_int8_convrot.safetensors")
    N(1004, "VAELoader", vae_name="minimax_h3_audio_vae_fp32.safetensors")
    N(5006, "LoraLoaderModelOnly", lora_name="pika_turbo_8step_fl2va.safetensors",
      strength_model=1.0, model=["1001", 0])
    N(25, "PrimitiveStringMultiline", value=IDENTITY_PROMPT)

    # canonical four-collect chain
    N(5002, "GetVideoComponents", video=["41", 0])
    N(5011, "H3FaceTrackCrop", **track_crop_inputs(["5002", 0], ["800", 0]))
    N(5012, "MiniMaxH3ReferenceToVideo", clip=["1002", 0], vae=["1003", 0],
      audio_vae=["1004", 0], prompt=["25", 0], width=["5011", 4], height=["5011", 5],
      length=LENGTH, ref_image_size="max", ref_images=[["1", 0]])
    N(5013, "H3InjectVideoLatent", av_latent=["5012", 1], images=["5011", 0],
      vae=["1003", 0])
    N(5014, "MiniMaxH3NativeAudioLock", model=["5006", 0], av_latent=["5013", 0],
      audio_vae=["1004", 0], audio=["5002", 1])
    N(5015, "H3PerFrameDenoise",
      denoise_multiplier_small_face=1.0, denoise_multiplier_large_face=0.35,
      scale_mode="absolute_px", face_px_small=60.0, face_px_large=200.0,
      gamma=1.0, smooth_frames=9,
      model=["5014", 0], av_latent=["5014", 1], transform=["5011", 1])
    N(5016, "RandomNoise", noise_seed=SEED)
    N(5017, "KSamplerSelect", sampler_name="lcm")
    N(5018, "BasicScheduler", scheduler="simple", steps=8, denoise=0.45,
      model=["5015", 2])
    N(5019, "BasicGuider", model=["5015", 2], conditioning=["5012", 0])
    N(5020, "SamplerCustomAdvanced", noise=["5016", 0], guider=["5019", 0],
      sampler=["5017", 0], sigmas=["5018", 0], latent_image=["5015", 0])
    N(5021, "VAEDecode", samples=["5020", 0], vae=["1003", 0])
    N(5022, "H3FaceStitch", **stitch_inputs(["5002", 0], ["5021", 0], ["5011", 1]))
    N(5023, "CreateVideo", images=["5022", 0], audio=["5002", 1], fps=24,
      bit_depth=8, color_space="sRGB", codec="none")

    # SAM3 mask branch (hd) — DEAD as of hd2 fix: nothing consumes 5104 any more.
    # Kept for the record; ComfyUI never executes unconsumed nodes. Text "face"
    # detection on the crop canvases is evidenced-dead (maskprobe1119 arm A all
    # zero; arm B "person" dies by f60 and is person-shaped, not face-shaped).
    N(5101, "CheckpointLoaderSimple", ckpt_name="sam3.1_multiplex_fp16.safetensors")
    N(5102, "CLIPTextEncode", text="face", clip=["5101", 1])
    N(5103, "SAM3_VideoTrack", images=["5011", 0], model=["5101", 0],
      conditioning=["5102", 0], detection_threshold=0.5, max_objects=1,
      detect_interval=1)
    N(5104, "SAM3_TrackToMask", track_data=["5103", 0], object_indices="0")

    # VOSR2 high-freq tail (hd)
    N(5109, "VOSR2ModelLoader", model="VOSR2", dtype="default")
    N(5110, "VOSR2Upscale", model=["5109", 0], image=["5021", 0],
      upscale=1, seed=300831622214023, color_alignment="wavelet",
      tile_size=512, tile_overlap=32, vae_tile_size=1024, vae_tile_overlap=32)

    # hd copy pair (hd2 fix: masks dangling -> face_only/transform.face_rect path)
    N(5024, "H3FaceStitch",
      **stitch_inputs(["5002", 0], ["5110", 0], ["5011", 1]))
    N(5025, "CreateVideo", images=["5024", 0], audio=["5002", 1], fps=24,
      bit_depth=8, color_space="sRGB", codec="none")

    # switches: 1065 final (True=repair film), 5111 gear, 5113 exit VIDEO switch
    N(1065, "PrimitiveBoolean", value=True)
    N(5111, "PrimitiveBoolean", value=False)  # set per tag by caller
    N(5113, "ComfySwitchNode", switch=["5111", 0],
      on_false=["5023", 0], on_true=["5025", 0])
    N(5100, "ComfySwitchNode", switch=["1065", 0],
      on_false=["41", 0], on_true=["5113", 0])  # on_false = p3 direct = source
    return g


def graph_for(tag: str) -> dict:
    g = base_graph()
    g["5111"]["inputs"]["value"] = tag in HD_TAGS
    g["4100"] = {"class_type": "SaveVideo", "inputs": dict(
        video=["5100", 0], filename_prefix=TAGS[tag], format="auto")}
    return g


def wait_queue_clear(tag: str, log, max_wait=14400):
    """Serial discipline: never jump a running foreign chain."""
    t0 = time.time()
    while True:
        q = NET.get("/queue")
        run, pend = q.get("queue_running", []), q.get("queue_pending", [])
        if not run and not pend:
            return
        msg = f"[{time.strftime('%H:%M:%S')}] [{tag}] queue busy (run={len(run)} pend={len(pend)}), waiting"
        print(msg, flush=True)
        log.write(msg + "\n")
        log.flush()
        if time.time() - t0 > max_wait:
            sys.exit(f"[TIMEOUT] {tag} queue never cleared in {max_wait}s")
        time.sleep(30)


def fire(tag: str, graph: dict, log, timeout_s=10800):
    r = NET.post_json("/prompt", {"prompt": graph, "client_id": CLIENT})
    if "prompt_id" not in r:
        sys.exit(f"[FATAL] {tag} rejected: {json.dumps(r)[:2000]}")
    pid = r["prompt_id"]
    msg = f"[FIRED] {tag} prompt_id={pid} nodes={len(graph)} at {time.strftime('%H:%M:%S')}"
    print(msg, flush=True)
    log.write(msg + "\n")
    log.flush()
    t0 = time.time()
    last = ""
    while True:
        time.sleep(15)
        h = NET.get(f"/history/{pid}")
        if pid not in h:
            q = NET.get("/queue")
            pos = sum(1 for x in q["queue_pending"] if x[1] == pid)
            cur = "running" if any(x[1] == pid for x in q["queue_running"]) else f"pending(pos={pos})"
            if cur != last:
                m = f"  [{tag}] {cur} +{time.time()-t0:.0f}s"
                print(m, flush=True)
                last = cur
            if time.time() - t0 > timeout_s:
                sys.exit(f"[TIMEOUT] {tag} {timeout_s}s")
            continue
        entry = h[pid]
        st = entry.get("status", {})
        with open(os.path.join(HERE, f"history_{tag}.json"), "w") as f:
            json.dump(entry, f, ensure_ascii=False, indent=1)
        if st.get("status_str") == "error":
            for m in st.get("messages", []):
                if m[0] == "execution_error":
                    sys.exit(f"[ERROR] {tag}: {json.dumps(m[1], ensure_ascii=False)[:2500]}")
            sys.exit(f"[ERROR] {tag}: {json.dumps(st, ensure_ascii=False)[:2500]}")
        if st.get("completed"):
            dt = time.time() - t0
            vids = []
            for node_out in entry.get("outputs", {}).values():
                for key in ("video", "gifs", "images", "video_files"):
                    if key in node_out:
                        vids.extend(node_out[key])
            msg = f"[DONE] {tag} {dt:.0f}s outputs={json.dumps(vids, ensure_ascii=False)[:400]}"
            print(msg, flush=True)
            log.write(msg + "\n")
            log.flush()
            return pid, vids, dt
        if time.time() - t0 > timeout_s:
            sys.exit(f"[TIMEOUT] {tag} {timeout_s}s")


def dl(tag: str, vids):
    dest = os.path.join(HERE, f"{tag}.mp4")
    cands = [v for v in vids if isinstance(v, dict) and v.get("type") == "output"]
    for v in cands:
        sub = v.get("subfolder", "")
        q = (f"/view?filename={urllib.parse.quote(v['filename'])}"
             f"&subfolder={urllib.parse.quote(sub)}&type=output")
        NET.download(q, dest)
        print(f"[DL] {tag} -> {dest} ({v['filename']})", flush=True)
        return dest
    sys.exit(f"[FATAL] {tag} no video output: {vids}")


def trace(tag: str):
    with open(os.path.join(HERE, f"history_{tag}.json")) as f:
        entry = json.load(f)
    msgs = entry.get("status", {}).get("messages", [])
    prog, executed, times = {}, set(), {}
    for m in msgs:
        if m[0] == "progress":
            d = m[1]
            prog.setdefault(d.get("node"), [0, None])
            prog[d.get("node")][0] = max(prog[d.get("node")][0], d.get("value", 0))
            prog[d.get("node")][1] = d.get("max")
        elif m[0] == "executed":
            executed.add(str(m[1].get("node")))
        elif m[0] == "execution_start":
            times["start"] = m[1].get("prompt_id")
    watch = ("5011", "5012", "5020", "5021", "5103", "5110", "5024", "5025",
             "5113", "5100", "5022", "5023")
    sam3 = {k: v for k, v in prog.items() if k and str(k) in watch}
    print(f"[TRACE] {tag} executed_nodes={sorted(executed)}")
    print(f"[TRACE] {tag} watch progress={json.dumps(sam3)}")
    hd_only = {"5101", "5102", "5103", "5104", "5109", "5110", "5024", "5025"}
    print(f"[TRACE] {tag} hd-arm executed: {sorted(executed & hd_only)}")
    return executed


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "dump":
        for tag in ("far", "hd", "hd2"):
            with open(os.path.join(HERE, f"graph_{tag}.json"), "w") as f:
                json.dump(graph_for(tag), f, ensure_ascii=False, indent=1)
            print(f"[DUMP] graph_{tag}.json nodes={len(graph_for(tag))}")
        sys.exit(0)
    acct = {}
    tags = ("far", "hd") if cmd == "all" else (cmd,)
    with open(os.path.join(HERE, "fire_log.txt"), "a") as log:
        log.write(f"\n=== dual-mode fire {time.strftime('%Y-%m-%d %H:%M:%S')} client={CLIENT} tags={tags} ===\n")
        for tag in tags:
            g = graph_for(tag)
            wait_queue_clear(tag, log)
            t_fire = time.time()
            pid, vids, dt = fire(tag, g, log)
            dest = dl(tag, vids)
            trace(tag)
            acct[tag] = dict(prompt_id=pid, seconds=round(dt), product=dest,
                             fired_at=time.strftime("%H:%M:%S", time.localtime(t_fire)))
            with open(os.path.join(HERE, "accounting.json"), "w") as f:
                json.dump(acct, f, ensure_ascii=False, indent=1)
    print("[ALL DONE]", json.dumps(acct))
