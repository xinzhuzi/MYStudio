"""Controlled serial A/B BFS face-transfer test; does not alter production workflows."""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
import time
import urllib.request
import uuid

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / ".trellis/tasks/10-22-bfs-qwen21-color-diagnosis/research"
PLAN = RESEARCH / "face-test-input-plan.json"
API_SOURCE = RESEARCH / "v2.actual-api.json"
GUI_SOURCE = ROOT / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/2_图生图/BFS-换头术-Qwen2.1.json"
HOME_DIR = Path("/Users/zhengbingjin/Project/IP/漫影工作室/comfyui")
BODY_NAME = "face-ab-1023-body-crop-1024.png"
CONTROL_NAME = "face-ab-1023-a-same-body-crop-1024.png"
REFERENCE_NAME = "face-ab-1023-b-neutral-reference-1024.png"
PROMPT = (
    "head_swap: start with <image1> as the base image, keeping its lighting, "
    "environment, and background. remove the head from <image1> completely and "
    "replace it with the head from <image2>, strictly preserving the hair, eye "
    "color, nose structure from <image2>. copy the direction of the eye, head "
    "rotation, micro expressions from <image1>, high quality, sharp details, 4k"
)
PREFIXES = {"a": "BFS_face_ab_A_self_control", "b": "BFS_face_ab_B_neutral_reference"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_once(path: Path, data: bytes) -> None:
    if path.exists():
        if path.read_bytes() != data:
            raise RuntimeError(f"Refusing to overwrite divergent artifact: {path}")
        return
    path.write_bytes(data)


def write_json_once(path: Path, value: object) -> None:
    write_once(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode())


def image_bytes(image: Image.Image) -> bytes:
    from io import BytesIO

    stream = BytesIO()
    image.save(stream, format="PNG", optimize=True)
    return stream.getvalue()


def prepare_assets() -> dict[str, Path]:
    plan = json.loads(PLAN.read_text(encoding="utf-8"))
    body_path = Path(plan["body"]["path"])
    reference_path = Path(plan["reference"]["path"])
    if sha256(body_path) != plan["body"]["sha256"]:
        raise RuntimeError("Body source hash differs from the approved test plan.")
    if sha256(reference_path) != plan["reference"]["sha256"]:
        raise RuntimeError("Reference source hash differs from the approved test plan.")
    x0, y0, x1, y1 = plan["proposed_body_crop_xyxy"]
    canvas = int(plan["proposed_test_canvas"])
    with Image.open(body_path) as source:
        crop = source.convert("RGB").crop((x0, y0, x1, y1)).resize((canvas, canvas), Image.Resampling.LANCZOS)
    with Image.open(reference_path) as source:
        rgba = source.convert("RGBA")
        neutral = Image.new("RGB", rgba.size, (249, 246, 241))
        neutral.paste(rgba.convert("RGB"), mask=rgba.getchannel("A"))
        neutral = neutral.resize((canvas, canvas), Image.Resampling.LANCZOS)
    body = RESEARCH / BODY_NAME
    control = RESEARCH / CONTROL_NAME
    reference = RESEARCH / REFERENCE_NAME
    data = image_bytes(crop)
    write_once(body, data)
    write_once(control, data)
    write_once(reference, image_bytes(neutral))
    record = {
        "contract": "A/B only changes image2; A is image1 itself, B is neutral-composited reference.",
        "body_crop_xyxy": [x0, y0, x1, y1],
        "canvas": [canvas, canvas],
        "neutral_background_rgb": [249, 246, 241],
        "assets": {name: {"file": path.name, "sha256": sha256(path)} for name, path in {"image1": body, "A_image2": control, "B_image2": reference}.items()},
    }
    write_json_once(RESEARCH / "face-ab.input-assets.json", record)
    return {"body": body, "a": control, "b": reference}


def build_prompt(head_name: str, prefix: str) -> dict:
    prompt = json.loads(API_SOURCE.read_text(encoding="utf-8"))
    prompt["470"]["inputs"]["image"] = BODY_NAME
    prompt["475"]["inputs"]["image"] = head_name
    prompt["496"]["inputs"]["prompt"] = PROMPT
    prompt["490"]["inputs"].update({"seed": 42, "steps": 20, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0})
    prompt["493"]["inputs"]["strength_model"] = 1.0
    prompt["461"]["inputs"]["filename_prefix"] = prefix
    return prompt


def gui_copy(api: dict, head_name: str, prefix: str) -> dict:
    gui = json.loads(GUI_SOURCE.read_text(encoding="utf-8"))
    for node in gui["nodes"]:
        if node["id"] == 470:
            node["widgets_values"][0] = BODY_NAME
        elif node["id"] == 475:
            node["widgets_values"][0] = head_name
        elif node["id"] == 490:
            node["widgets_values"] = [42, "fixed", 20, 1, "euler", "simple", 1]
        elif node["id"] == 493:
            node["widgets_values"] = ["bfs_head_v1.1_qwen_2.1.safetensors", 1.0]
        elif node["id"] == 461:
            node["widgets_values"][0] = prefix
        elif node["id"] == 496:
            node["widgets_values"][0] = PROMPT
    return gui


def manifest_and_base() -> tuple[dict, str]:
    manifest = json.loads((HOME_DIR / "manifest.json").read_text(encoding="utf-8"))
    return manifest, f"http://127.0.0.1:{manifest['engine']['port']}"


def get(base: str, endpoint: str) -> dict:
    with urllib.request.urlopen(base + endpoint, timeout=20) as response:
        return json.load(response)


def wait_idle(base: str) -> None:
    started = time.monotonic()
    while True:
        queue = get(base, "/queue")
        if not queue["queue_running"] and not queue["queue_pending"]:
            return
        if time.monotonic() - started > 1800:
            raise TimeoutError("Shared queue remained occupied; no prompt submitted.")
        time.sleep(15)


def upload(base: str, path: Path) -> dict:
    boundary = "bfsface" + uuid.uuid4().hex
    body = b"".join([
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n".encode(),
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{path.name}\"\r\nContent-Type: image/png\r\n\r\n".encode(),
        path.read_bytes(), f"\r\n--{boundary}--\r\n".encode(),
    ])
    request = urllib.request.Request(base + "/upload/image", data=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def remote_name(uploaded: dict) -> str:
    return "/".join(value for value in [uploaded.get("subfolder"), uploaded["name"]] if value)


def run_case(case: str, base: str, head_path: Path, gui: dict, body_name: str) -> None:
    head_upload = upload(base, head_path)
    write_json_once(RESEARCH / f"face-ab-{case}.upload.json", head_upload)
    prompt = build_prompt(remote_name(head_upload), PREFIXES[case])
    prompt["470"]["inputs"]["image"] = body_name
    write_json_once(RESEARCH / f"face-ab-{case}.submitted-api.json", prompt)
    payload = {"prompt": prompt, "client_id": str(uuid.uuid4()), "extra_data": {"extra_pnginfo": {"workflow": gui}}}
    request = urllib.request.Request(base + "/prompt", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        submitted = json.load(response)
    write_json_once(RESEARCH / f"face-ab-{case}.submission.json", submitted)
    if submitted.get("node_errors"):
        raise RuntimeError(f"{case} rejected before queueing: {submitted['node_errors']}")
    prompt_id = submitted["prompt_id"]
    print("SUBMITTED", case, prompt_id, flush=True)
    started = time.monotonic()
    while True:
        history = get(base, "/history/" + prompt_id).get(prompt_id)
        if history:
            write_json_once(RESEARCH / f"face-ab-{case}.history.json", history)
            status = history["status"]
            if status["status_str"] != "success" or not status["completed"]:
                raise RuntimeError(f"{case} failed: {status}")
            print("SUCCESS", case, prompt_id, flush=True)
            return
        if time.monotonic() - started > 1800:
            raise TimeoutError(f"{case} unresolved; inspect its prompt_id before any new action.")
        time.sleep(15)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare-only", action="store_true", help="Create and verify inputs/API/GUI copies; submit nothing.")
    args = parser.parse_args()
    assets = prepare_assets()
    for case in ("a", "b"):
        api = build_prompt(CONTROL_NAME if case == "a" else REFERENCE_NAME, PREFIXES[case])
        write_json_once(RESEARCH / f"face-ab-{case}.api.json", api)
        write_json_once(RESEARCH / f"face-ab-{case}.gui.json", gui_copy(api, CONTROL_NAME if case == "a" else REFERENCE_NAME, PREFIXES[case]))
    if args.prepare_only:
        print("PREPARED_ONLY", RESEARCH, flush=True)
        return
    manifest, base = manifest_and_base()
    write_json_once(RESEARCH / "face-ab.manifest.json", manifest)
    wait_idle(base)
    body_upload = upload(base, assets["body"])
    write_json_once(RESEARCH / "face-ab-body.upload.json", body_upload)
    # The body upload name is immutable in input; update each stored API copy before submission.
    for case in ("a", "b"):
        api_path = RESEARCH / f"face-ab-{case}.api.json"
        api = json.loads(api_path.read_text(encoding="utf-8"))
        api["470"]["inputs"]["image"] = remote_name(body_upload)
        write_json_once(RESEARCH / f"face-ab-{case}.with-uploaded-body-api.json", api)
    run_case("a", base, assets["a"], json.loads((RESEARCH / "face-ab-a.gui.json").read_text(encoding="utf-8")), remote_name(body_upload))
    wait_idle(base)
    run_case("b", base, assets["b"], json.loads((RESEARCH / "face-ab-b.gui.json").read_text(encoding="utf-8")), remote_name(body_upload))


if __name__ == "__main__":
    main()
