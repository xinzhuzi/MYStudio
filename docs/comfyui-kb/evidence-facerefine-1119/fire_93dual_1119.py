#!/usr/bin/env python3
"""93-final dual-mode live fire (1119 evening): four-collect segment of the
93-node 终版 单镜.json, ch002 inputs, correction round.

Previous rounds:
  fire_dualmode_1119.py - four-collect cut from the 97-node danjing.json
    (predecessor), ch002 inputs (src_4k_p3.mp4 + ref_ch002_face.png). Products
    far.mp4/hd.mp4/hd2.mp4 = the V2.1 stand-in line, equivalence targets.
  fire_final_1119.py    - the WHOLE 93 file, but fired with ref_body.png +
    pottery prompt -> content ran off-brief, user rejected. THIS round is the
    correction: 93 final base x ch002 video.

Graph = four-collect segment of the 93 final file, SAM3 branch 5101-5104
already absent in the file (cut in 93; was dead-unconsumed in the 97 version
anyway - ComfyUI never executes unconsumed nodes, so far.mp4 ran without it
too).  Two states, identical inputs/seed (42 fixed):

  far93 : 1065=True + 5111=False -> 5023 far chain -> dualmode/far93
  hd93  : 1065=True + 5111=True  -> 5025 hd chain -> dualmode/hd93

Only 5111 + SaveVideo prefix differ between the two prompts.

Deltas vs the 97-era precedent graph (graph_far.json), all documented:
  - 5101/5102/5103/5104 REMOVED (93 file cut them; they were unconsumed).
  - 5002.video and 5100.on_false eat ["41",0] LoadVideo(src_4k_p3.mp4)
    (93 file wires 4002 ReCaVSRUpscale; stand-in swap per probe-1119
    precedent, ch002 source explicitly).
  - 1.image = ref_ch002_face.png (file placeholder replaced, ch002 face ref).
  - 5012.length = literal 175 (file links node-52 formula for in-graph
    generation; source clip is 175 frames).
  - 5011.identity_clip_vision = ["800",0]: DANGLING in the 93 file (editing
    artifact of the SAM3 cut - 800 has zero consumers there), but the file
    sets identity_model="clip_vision" and object_info says that model slot is
    "used only when identity_model is clip_vision". Wired per the proven
    precedent run (far.mp4) so the equivalence closure far93 vs far.mp4
    compares like with like.
Everything else byte-identical to the file's canonical widgets - enforced at
runtime by verify_93() against 单镜.json on disk.
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
CLIENT = "93dual-1119-" + uuid.uuid4().hex[:8]
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.expanduser("~/Project/Github/MYStudio")
WF_FILE = f"{REPO}/apps/backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/单镜.json"

SRC_FILE = "src_4k_p3.mp4"          # 3840x2220x175 frames, with audio, engine input
REF_FILE = "ref_ch002_face.png"     # engine input
LENGTH = 175                        # source frame count (17k+5 grid: 5 + 17*10)
SEED = 42

IDENTITY_PROMPT = ("The same person as in the video: sharp detailed facial features, clear "
                   "bright eyes, well-defined facial contour, refined natural skin texture, "
                   "clean hair edges; keep the exact facial identity, skin tone and lighting "
                   "direction unchanged, no character redesign.")

TAGS = {"far93": "dualmode/far93", "hd93": "dualmode/hd93"}
HD_TAGS = ("hd93",)


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
    # canonical values, positionally identical to 93-file node 5011 widgets
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


def stitch_inputs(base, crops, transform):
    # masks deliberately absent (hd2 fix: dangling -> face_only/transform path)
    return dict(
        base_images=base, refined_crops=crops, transform=transform,
        paste_region="face_only", mask_dilation=16, feather=24,
        colour_match=1.0, blend=1.0, undetected_frames="fade_out",
        feather_scales_with_crop=False)


def base_graph() -> dict:
    g = {}

    def N(cid, cls, **kw):
        g[str(cid)] = {"class_type": cls, "inputs": kw}

    # source & loaders (93 file: 4002 ReCaVSR in-memory -> LoadVideo stand-in)
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

    # canonical four-collect chain (93-file widgets, see module docstring)
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

    # VOSR2 high-freq tail (hd) - 93 file cut SAM3 5101-5104; not rebuilt here
    N(5109, "VOSR2ModelLoader", model="VOSR2", dtype="default")
    N(5110, "VOSR2Upscale", model=["5109", 0], image=["5021", 0],
      upscale=1, seed=300831622214023, color_alignment="wavelet",
      tile_size=512, tile_overlap=32, vae_tile_size=1024, vae_tile_overlap=32)

    # hd copy pair (masks dangling on both stitch nodes = hd2-fix path)
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
      on_false=["41", 0], on_true=["5113", 0])  # on_false = LoadVideo = source
    return g


def graph_for(tag: str) -> dict:
    g = base_graph()
    g["5111"]["inputs"]["value"] = tag in HD_TAGS
    g["4100"] = {"class_type": "SaveVideo", "inputs": dict(
        video=["5100", 0], filename_prefix=TAGS[tag], format="auto")}
    return g


def verify_93() -> None:
    """Assert every widget we send matches the 93 final file on disk."""
    wf = json.load(open(WF_FILE))
    nodes = {n["id"]: n for n in wf["nodes"]}
    ids = set(nodes)
    for gone in (5101, 5102, 5103, 5104):
        assert gone not in ids, f"SAM3 node {gone} present - not the 93 file?"
    assert len(wf["nodes"]) == 93, f"node count {len(wf['nodes'])} != 93"
    g = graph_for("far93")

    def file_w(nid):
        return nodes[nid].get("widgets_values") or []

    checks = [  # (node, file widget list, our literal inputs subset, label)
        ("800", file_w(800), g["800"]["inputs"], "clip_vision_g"),
        ("1001", file_w(1001), g["1001"]["inputs"], "unet"),
        ("1002", file_w(1002), g["1002"]["inputs"], "clip"),
        ("1003", file_w(1003), g["1003"]["inputs"], "video vae"),
        ("1004", file_w(1004), g["1004"]["inputs"], "audio vae"),
        ("5006", file_w(5006)[:2], g["5006"]["inputs"], "pika lora"),
        ("5011", file_w(5011), g["5011"]["inputs"], "face track crop"),
        ("5015", file_w(5015), g["5015"]["inputs"], "per-frame denoise"),
        ("5018", file_w(5018), g["5018"]["inputs"], "scheduler"),
        ("5022", file_w(5022), g["5022"]["inputs"], "stitch far"),
        ("5024", file_w(5024), g["5024"]["inputs"], "stitch hd"),
        ("5023", file_w(5023), g["5023"]["inputs"], "video far"),
        ("5025", file_w(5025), g["5025"]["inputs"], "video hd"),
        ("5109", file_w(5109), g["5109"]["inputs"], "vosr2 loader"),
    ]
    # positional widget -> input-name maps (object_info order, control omitted)
    order = {
        "800": ["clip_name"],
        "1001": ["unet_name", "weight_dtype"],
        "1002": ["clip_name", "type", "device"],
        "1003": ["vae_name"], "1004": ["vae_name"],
        "5006": ["lora_name", "strength_model"],
        "5011": ["detector", "confidence", "crop_factor", "canvas_width",
                 "canvas_height", "canvas_mode", "smooth_window",
                 "size_smooth_window", "smooth_method", "size_mode",
                 "identity_track", "identity_threshold", "select",
                 "fallback_detector", "fallback_head_frac", "select_index",
                 "identity_model", "cut_detection", "cut_threshold",
                 "absent_shots", "X", "Y", "frame_index"],
        "5015": ["denoise_multiplier_small_face", "denoise_multiplier_large_face",
                 "scale_mode", "face_px_small", "face_px_large", "gamma",
                 "smooth_frames"],
        "5018": ["scheduler", "steps", "denoise"],
        "5022": ["paste_region", "mask_dilation", "feather", "colour_match",
                 "blend", "undetected_frames", "feather_scales_with_crop"],
        "5024": ["paste_region", "mask_dilation", "feather", "colour_match",
                 "blend", "undetected_frames", "feather_scales_with_crop"],
        "5023": ["fps", "bit_depth", "color_space", "codec"],
        "5025": ["fps", "bit_depth", "color_space", "codec"],
        "5109": ["model", "dtype"],
    }
    for nid, wv, ours, label in checks:
        names = order[nid]
        assert len(wv) >= len(names), f"{nid} {label}: file widgets {wv} too short"
        for i, name in enumerate(names):
            fv, ov = wv[i], ours[name]
            if isinstance(fv, float) or isinstance(ov, float):
                ok = abs(float(fv) - float(ov)) < 1e-9
            else:
                ok = fv == ov
            assert ok, f"{nid} {label}: widget {name} file={fv!r} ours={ov!r}"
    # seed widgets: 5016 [42,'fixed'], 5110 seed 300831622214023 'fixed'
    assert file_w(5016)[0] == SEED and file_w(5016)[1] == "fixed", file_w(5016)
    assert file_w(5110)[1] == g["5110"]["inputs"]["seed"] == 300831622214023
    assert file_w(5110)[2] == "fixed", file_w(5110)
    # canonical prompt #25 byte-identical
    assert file_w(25)[0] == g["25"]["inputs"]["value"] == IDENTITY_PROMPT
    # 5012 ref_image_size + 1065 default False in file (we inject True per task)
    assert file_w(5012)[4] == "max"
    assert file_w(1065) == [False]
    # every link target exists; only expected node set
    want = {str(x) for x in (41, 1, 800, 1001, 1002, 1003, 1004, 5006, 25, 5002,
                             5011, 5012, 5013, 5014, 5015, 5016, 5017, 5018,
                             5019, 5020, 5021, 5022, 5023, 5109, 5110, 5024,
                             5025, 1065, 5111, 5113, 5100, 4100)}
    assert set(g) == want, set(g) ^ want
    for nid, spec in g.items():
        for k, v in spec["inputs"].items():
            if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                assert v[0] in g, f"{nid}.{k} -> missing node {v[0]}"
    far, hd = graph_for("far93"), graph_for("hd93")
    diff = {n for n in far if far[n] != hd[n]}
    assert diff == {"5111", "4100"}, diff  # only gear + prefix differ
    print(f"[VERIFY] 93-file widget parity OK; nodes={len(far)}; "
          f"far/hd diff={sorted(diff)}; SAM3 5101-5104 absent")


def _get_retry(path, tries=5, sleep=20):
    """GET with transient-network tolerance (engine restart mid-wait, 1119)."""
    for i in range(tries):
        try:
            return NET.get(path)
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            if i == tries - 1:
                raise
            print(f"[NET] {path} failed ({e}), retry {i+1}/{tries}", flush=True)
            time.sleep(sleep)


def wait_queue_clear(tag: str, log, max_wait=14400):
    """Serial discipline: never jump a running foreign chain."""
    t0 = time.time()
    while True:
        q = _get_retry("/queue")
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
        h = _get_retry(f"/history/{pid}", tries=8, sleep=30)
        if pid not in h:
            q = _get_retry("/queue")
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
    prog, executed = {}, set()
    for m in msgs:
        if m[0] == "progress":
            d = m[1]
            prog.setdefault(d.get("node"), [0, None])
            prog[d.get("node")][0] = max(prog[d.get("node")][0], d.get("value", 0))
            prog[d.get("node")][1] = d.get("max")
        elif m[0] == "executed":
            executed.add(str(m[1].get("node")))
    watch = ("5011", "5012", "5020", "5021", "5110", "5024", "5025",
             "5113", "5100", "5022", "5023")
    print(f"[TRACE] {tag} executed_nodes={sorted(executed)}")
    print(f"[TRACE] {tag} watch progress={json.dumps({k: v for k, v in prog.items() if k and str(k) in watch})}")
    hd_only = {"5109", "5110", "5024", "5025"}
    print(f"[TRACE] {tag} hd-arm executed: {sorted(executed & hd_only)}")
    sam3 = executed & {"5101", "5102", "5103", "5104"}
    assert not sam3, f"SAM3 executed?! {sam3}"
    return executed


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    if cmd == "dump":
        verify_93()
        for tag in TAGS:
            with open(os.path.join(HERE, f"graph_{tag}.json"), "w") as f:
                json.dump(graph_for(tag), f, ensure_ascii=False, indent=1)
            print(f"[DUMP] graph_{tag}.json nodes={len(graph_for(tag))}")
        sys.exit(0)
    acct = {}
    tags = tuple(TAGS) if cmd == "all" else (cmd,)
    verify_93()
    with open(os.path.join(HERE, "fire_log.txt"), "a") as log:
        log.write(f"\n=== 93-final dual fire {time.strftime('%Y-%m-%d %H:%M:%S')} client={CLIENT} tags={tags} ===\n")
        for tag in tags:
            g = graph_for(tag)
            wait_queue_clear(tag, log)
            t_fire = time.time()
            pid, vids, dt = fire(tag, g, log)
            dest = dl(tag, vids)
            trace(tag)
            acct[tag] = dict(prompt_id=pid, seconds=round(dt), product=dest,
                             fired_at=time.strftime("%H:%M:%S", time.localtime(t_fire)))
            with open(os.path.join(HERE, "accounting_93.json"), "w") as f:
                json.dump(acct, f, ensure_ascii=False, indent=1)
    print("[ALL DONE]", json.dumps(acct))
