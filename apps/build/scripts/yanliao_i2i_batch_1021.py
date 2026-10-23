"""晏燎十期正视图 i2i 批量役(10-21 用户令):每期四产物,App 同款桥模板路。
直连引擎 17001(sidecar 已随 App 关闭);官方节点覆写(6:4010 型/6:4011 用途/6:180 透明);
指令已过门禁四族预检(衣色/鞋履/配饰/发色触发词全避);断点续跑;日志双落。
"""
import base64, json, sys, time, uuid, importlib.util
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps/backend"))
from engines.image_engine.comfyui_bridge import instantiate_template, load_template  # noqa: E402

ENGINE = "http://127.0.0.1:17001"
ROLE_DIR = Path("/Users/zhengbingjin/Project/IP/MA/store/assets/files/role/晏燎")
LOG_DIR = ROOT / "apps/output/yanliao-i2i-batch-1021"
STAGES = [
    ("透明立绘", "自由出图", "人物", "true",
     "去除画面全部背景，仅保留人物主体本身；人物的身份、姿态、原有画法与色彩保持原样，轮廓完整清晰，其余内容保持原样。"),
    ("风格转换", "道劫美术风格转换", "人物", "true",
     "将画面按美术风格底座重绘为底座所述画风，人物的身份、年龄感、姿态与构图保持原样。"),
    ("高清人脸", "道劫美术类型", "高清人脸", "自动",
     "原图人物的面部特写：青年男性，面容光洁无须；发型、发色与面部五官严格按参考图原样呈现，年龄感与神态和原图一致，眉眼细节清晰，肤纹质感分明，肩线以上近景构图。"),
    ("多视图", "道劫美术类型", "人物多视图", "自动",
     "图中青年人物的四视图，正面、左侧、右侧与背面各一幅，人物整体样貌四幅严格一致。"),
]

def _upload(png_bytes: bytes, name: str) -> str:
    boundary = uuid.uuid4().hex
    body = (b"--" + boundary.encode()
            + f'Content-Disposition: form-data; name="image"; filename="{name}"'.encode()
            .replace(b'Content-', b'\r\nContent-')
            + b"\r\nContent-Type: image/png\r\n\r\n" + png_bytes
            + b"\r\n--" + boundary.encode() + b"--\r\n")
    req = ureq.Request(ENGINE + "/upload/image", data=body,
                       headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with ureq.urlopen(req, timeout=60) as r:
        return json.load(r)["name"]

def _post(path, payload):
    req = ureq.Request(ENGINE + path, data=json.dumps(payload).encode(),
                       headers={"Content-Type": "application/json"})
    with ureq.urlopen(req, timeout=30) as r:
        return json.load(r)

def log(msg):
    print(msg, flush=True)
    with open(LOG_DIR / "run.log", "a") as f:
        f.write(msg + "\n")

def run_job(out_path, purpose, type_zh, rgba_mode, instruction, upload_name):
    template = load_template("qwen21_道劫_i2i_api")
    seed = uuid.uuid4().int % (2**31 - 1)
    graph = instantiate_template(template, instruction, None, 8, seed, "1:1", [upload_name])
    # 单参考剪除 11→17→4015.image_2 链(krea2_edit_ref 同款先例:
    # 无绑定的 LoadImage 死文件名过不了引擎校验)
    for nid in ("11", "17"):
        graph.pop(nid, None)
    graph.get("4015", {}).get("inputs", {}).pop("images.image_2", None)
    for nid, key, val in (("6:4010", "base", type_zh),
                          ("6:4011", "组装用途", purpose),
                          ("6:4022", "组装用途", purpose),  # 用途画幅路由:道劫美术类型→型画幅
                          ("6:180", "mode", rgba_mode)):
        node = graph.get(nid)
        assert isinstance(node, dict) and key in node.get("inputs", {}), f"桥缺 {nid}.{key}"
        node["inputs"][key] = val
    submitted = _post("/prompt", {"prompt": graph, "client_id": "yanliao-batch-1021"})
    pid = submitted.get("prompt_id")
    assert pid and not submitted.get("node_errors"), str(submitted)[:300]
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        time.sleep(3)
        with ureq.urlopen(ENGINE + "/history/" + pid, timeout=10) as r:
            rec = json.load(r).get(pid)
        if not rec:
            continue
        if rec["status"]["status_str"] != "success":
            raise RuntimeError("引擎失败: " + str(rec["status"].get("messages"))[:250])
        images = [im for out in rec.get("outputs", {}).values() for im in out.get("images", [])]
        assert images, "成功但零输出"
        # 优选 2K 超分产物([504] 前缀 MYStudio-2K;[8] 基础图为回退)
        img = next((im for im in images if str(im.get("filename", "")).startswith("MYStudio-2K")), images[-1])
        with ureq.urlopen(ENGINE + "/view?" + urlencode(
                {"filename": img["filename"], "subfolder": img.get("subfolder", ""),
                 "type": img.get("type", "output")}), timeout=120) as r:
            content = r.read()
        out_path.write_bytes(content)
        # MPS 长跑退化保险:每发后卸载模型+回收(实测 free 后首发恒好)
        try:
            _post("/free", {"unload_models": True, "free_memory": True})
        except Exception:
            pass
        return len(content), pid, seed
    raise TimeoutError("单发超时600s")

def main():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location(
        "gate", ROOT / "apps/backend/comfyui/my_nodes/nodes/_gongbi_gate.py")
    gate = importlib.util.module_from_spec(spec); spec.loader.exec_module(gate)
    for name, _, _, _, instr in STAGES:  # 门禁四族预检(衣色/鞋履/配饰/发色等)
        v = gate.prompt_violations(instr, is_subject=True)
        assert not v, f"门禁预检红 {name}: {v}"
    sources = sorted(ROLE_DIR.glob("晏燎_*_正视图_v1.png"))
    log(f"[batch] 源 {len(sources)} 张 × {len(STAGES)} 产物 = {len(sources) * len(STAGES)} 发 (直连{ENGINE})")
    upload_cache, done, fail, skip = {}, 0, 0, 0
    for src in sources:
        long_src = "炼虚" in src.stem  # 512x1024 长条源:跟随路由会得 2048x4006 长条,改吃型画幅
        for name, purpose, type_zh, rgba_mode, instr in STAGES:
            out = src.with_name(src.stem + f"_{name}.png")
            if out.exists():
                skip += 1; continue
            eff_purpose = "道劫美术类型" if (long_src and purpose in ("自由出图", "道劫美术风格转换")) else purpose
            t0 = time.time()
            try:
                if src.name not in upload_cache:
                    upload_cache[src.name] = _upload(src.read_bytes(), f"yanliao-{src.stem}.png")
                size, pid, seed = run_job(out, eff_purpose, type_zh, rgba_mode,
                                          instr, upload_cache[src.name])
                done += 1
                log(f"[ok] {out.name} {size // 1024}KB seed={seed} {time.time() - t0:.0f}s pid={pid[:8]}")
            except Exception as exc:
                fail += 1
                log(f"[FAIL] {out.name}: {str(exc)[:200]}")
    log(f"[batch 终] ok={done} fail={fail} skip={skip}")
    json.dump({"ok": done, "fail": fail, "skip": skip}, open(LOG_DIR / "summary.json", "w"))

if __name__ == "__main__":
    main()
