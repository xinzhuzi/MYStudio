#!/usr/bin/env python3
"""Fisher-Pose 实弹发车器(1010 实弹测试役)。

官方 FisherQwenFreePose 工作流(2_图生图/官方-fisher-pose-无限姿势.json)主链的 API 展平直跑:
  UNETLoader(qwen2.1 bf16)→ VNCCS LoRA → KSampler → VAEDecode → SaveImage
  FisherQwenFreePose(clip/vae/人物图=reference_image=image2,pose_json 内烘焙 image1)
换机位链(TripoSplat/AnyAngle 六模型)未装,不进本流(加载级验证另报)。

image1 姿势参考三源:
  y        自绘白底 OpenPose 骨架「Y-pose:双臂高举斜上+双腿并拢」(程序化姿势 A)
  t        自绘白底 OpenPose 骨架「T-pose:双臂水平平举+双腿 A 字大开」(程序化姿势 B)
  mannequin 官方内置双人偶渲染图右半裁剪(单手高举者,官方域参考)

pose_json 为最小构造(服务端 free_pose.py 只读 people/referenceMode/poseReference(File)/
outputSkeleton 四键,people_sides<2 人即单人指令;pose_reference.py 走 poseReference base64 路)。

用法:python3 fisher_pose_fire.py --pose y --steps 10 --size 768 --seed 42 --tag smoke_y
"""
import argparse
import base64
import io
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw

ENGINE = "http://127.0.0.1:17001"
REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
OUT_DIR = REPO / "apps/output/fisher-pose-test"
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/官方-fisher-pose-无限姿势.json"
ENGINE_INPUT = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/input")
BUILTIN_MANNEQUIN = "/tmp/fisher_builtin_mannequin.png"  # 官方 pose_json 解码件(本会话生成)

PERSON_UPLOAD_NAME = "fisher_pose_person.png"  # image2:my-shot 三人水墨群像右侧白衣年轻人裁片

# ── OpenPose 18 关节与四肢(官方配色惯例)──
LIMBS = [(0, 14), (14, 16), (0, 15), (15, 17), (0, 1), (1, 2), (2, 3), (3, 4),
         (1, 5), (5, 6), (6, 7), (2, 8), (8, 9), (9, 10), (5, 11), (11, 12), (12, 13), (1, 8), (8, 11)]
COLORS = [(255, 0, 0), (255, 85, 0), (255, 170, 0), (255, 255, 0), (170, 255, 0), (85, 255, 0), (0, 255, 0),
          (0, 255, 85), (0, 255, 170), (0, 255, 255), (0, 170, 255), (0, 85, 255), (0, 0, 255), (85, 0, 255),
          (170, 0, 255), (255, 0, 255), (255, 0, 170), (255, 0, 85)]


def draw_skeleton(pose: str) -> bytes:
    """白底 1024x768 OpenPose 骨架 PNG(y/t 两姿势)。"""
    if pose == "y":  # 双臂高举斜上 45°,双腿并拢
        j = {0: (512, 150), 14: (497, 145), 15: (527, 145), 16: (485, 150), 17: (539, 150),
             1: (512, 205), 2: (442, 220), 3: (392, 125), 4: (342, 42), 5: (582, 220), 6: (632, 125), 7: (682, 42),
             8: (472, 485), 9: (472, 615), 10: (472, 742), 11: (552, 485), 12: (552, 615), 13: (552, 742)}
    else:  # t:双臂水平平举,双腿 A 字大开
        j = {0: (512, 150), 14: (497, 145), 15: (527, 145), 16: (485, 150), 17: (539, 150),
             1: (512, 205), 2: (442, 220), 3: (352, 218), 4: (262, 215), 5: (582, 220), 6: (672, 218), 7: (762, 215),
             8: (472, 485), 9: (432, 615), 10: (392, 742), 11: (552, 485), 12: (592, 615), 13: (632, 742)}
    im = Image.new("RGB", (1024, 768), (255, 255, 255))
    dr = ImageDraw.Draw(im)
    for idx, (a, b) in enumerate(LIMBS):
        if a in j and b in j:
            dr.line([j[a], j[b]], fill=COLORS[idx % len(COLORS)], width=14)
    for k, xy in j.items():
        dr.ellipse([xy[0] - 11, xy[1] - 11, xy[0] + 11, xy[1] + 11], fill=COLORS[k % len(COLORS)])
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def pose_json_for(pose: str) -> str:
    """最小 pose_json:单人 + base64 人偶/骨架图 + outputSkeleton=True(骨架引导豁免句)。"""
    if pose == "mannequin":
        img = Image.open(BUILTIN_MANNEQUIN).crop((560, 0, 1024, 768))  # 右半:单手高举人偶
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png = buf.getvalue()
    else:
        png = draw_skeleton(pose)
    b64 = "data:image/png;base64," + base64.b64encode(png).decode()
    (OUT_DIR / f"image1_{pose}.png").write_bytes(png)  # 参考图存档
    return json.dumps({"version": 2, "kind": "vnccs-free-pose",
                       "people": [{"transform": {"x": 0.0, "y": 0.0}}],  # 1 人=单人指令
                       "referenceMode": "group", "outputSkeleton": True, "poseReference": b64})


def build_graph(pose: str, steps: int, size: int, seed: int, person: str, extra: str = "", cfg: float = 1.0) -> dict:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    nodes = {n["id"]: n for n in wf["nodes"]}
    g = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": nodes[1]["widgets_values"][0], "weight_dtype": "default"}},
        "2": {"class_type": "LoraLoaderModelOnly", "inputs": {
            "lora_name": nodes[2]["widgets_values"][0], "strength_model": 1.0, "strength_clip": 1.0,
            "model": ["1", 0]}},
        "3": {"class_type": "CLIPLoader", "inputs": {"clip_name": nodes[3]["widgets_values"][0],
                                                     "type": "qwen_image", "device": "default"}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": nodes[4]["widgets_values"][0]}},
        "5": {"class_type": "LoadImage", "inputs": {"image": person, "upload": {"name": person, "type": "input"}}},
        "6": {"class_type": "FisherQwenFreePose", "inputs": {
            "clip": ["3", 0], "vae": ["4", 0], "reference_image": ["5", 0],
            "width": size, "height": size, "reference_resolution": 1024,
            "extra_prompt": extra, "pose_json": pose_json_for(pose)}},
        "7": {"class_type": "KSampler", "inputs": {
            "seed": seed, "steps": steps, "cfg": cfg, "sampler_name": "euler", "scheduler": "simple",
            "denoise": 1.0, "model": ["2", 0], "positive": ["6", 0], "negative": ["6", 1],
            "latent_image": ["6", 2]}},
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["4", 0]}},
        "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": f"fisher_pose/{pose}"}},
        "10": {"class_type": "PreviewImage", "inputs": {"images": ["6", 4]}},  # 人偶/骨架参考回显
    }
    return g


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pose", required=True, choices=["y", "t", "mannequin"])
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--size", type=int, default=768)
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--tag", default=None)
    ap.add_argument("--person", default=PERSON_UPLOAD_NAME)
    ap.add_argument("--extra-prompt", default="", help="外观/色彩锚(注入 FisherQwenFreePose.extra_prompt)")
    ap.add_argument("--cfg", type=float, default=1.0)
    args = ap.parse_args()
    seed = args.seed if args.seed is not None else random.randint(1, 2**31 - 1)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    g = build_graph(args.pose, args.steps, args.size, seed, args.person, extra=args.extra_prompt, cfg=args.cfg)
    req = urllib.request.Request(f"{ENGINE}/prompt",
                                 data=json.dumps({"prompt": g, "client_id": "fisher-pose-fire"}).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as e:
        sys_exit = SystemExit(f"400: {e.read().decode()[:2000]}")
        raise sys_exit
    print(f"[fire] pose={args.pose} steps={args.steps} size={args.size} seed={seed} queued={pid}")

    t0, fn, fn_meta = time.time(), None, {}
    while time.time() - t0 < 1500:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=15) as r:
            hist = json.load(r)
        if pid in hist:
            ent = hist[pid]
            status = ent.get("status", {})
            for nid, o in ent.get("outputs", {}).items():
                for img in o.get("images", []):
                    if fn is None and img.get("type") == "output":
                        fn = img["filename"]
                        fn_meta = {"subfolder": img.get("subfolder", ""), "type": img.get("type", "output")}
            if status.get("completed") or fn:
                break
            if status.get("status_str") == "error":
                raise SystemExit(f"执行错误: {json.dumps(status, ensure_ascii=False)[:800]}")
    assert fn, "1500s 无产物"
    tag = args.tag or f"{args.pose}_s{args.steps}"
    out = OUT_DIR / f"{tag}.png"
    view = f"{ENGINE}/view?filename={urllib.parse.quote(fn)}&subfolder={urllib.parse.quote(fn_meta.get('subfolder',''))}&type={fn_meta.get('type','output')}"
    urllib.request.urlretrieve(view, out)
    # 实际提示词(history 里 FisherQwenFreePose 的 ui.fisher_prompt=终稿真值)
    prompt_true = None
    for nid, o in hist.get(pid, {}).get("outputs", {}).items():
        cand = o.get("ui") or o
        if isinstance(cand, dict) and "fisher_prompt" in cand:
            prompt_true = "".join(cand["fisher_prompt"])
            break
    meta = {"pose": args.pose, "steps": args.steps, "size": args.size, "seed": seed,
            "engine_fn": fn, "prompt_true": prompt_true, "seconds": round(time.time() - t0)}
    (OUT_DIR / f"{tag}.meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1))
    print(f"DONE {fn} ({meta['seconds']}s) → {out}")
    print(f"实际提示词: {prompt_true}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
