#!/usr/bin/env python3
"""gem_graft_fire_i2i_1118.py — i2i 件 Gem② 嫁接实弹(1118)

参考图 = t2i 实弹裸图(同主体,提示词匹配);三槽全绑同一张,规避空名崩坑。
产物落 apps/output/gem-graft-1118/
"""
import json
import os
import struct
import time
import urllib.request
import uuid

ENGINE = "http://192.168.0.101:17000"
TWIN = "apps/backend/comfyui/workflows/1_图片/QwenImage2.1/2_图生图/qwen21-道劫-i2i-api.json"
REF_LOCAL = "apps/output/gem-graft-1118/t2i_8_QI21道劫文生图__00020_.png"
REF_REMOTE = "gem_graft_ref_portrait.png"
OUT_DIR = "apps/output/gem-graft-1118"
POLL_MAX_S = 540

for k in list(os.environ):
    if "proxy" in k.lower():
        os.environ.pop(k)
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def http_json(path, data=None):
    req = urllib.request.Request(
        ENGINE + path,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"},
    )
    with opener.open(req, timeout=60) as r:
        return json.loads(r.read().decode())


def upload_ref():
    body = open(REF_LOCAL, "rb").read()
    bnd = uuid.uuid4().hex
    parts = (
        f"--{bnd}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{REF_REMOTE}\"\r\n"
        "Content-Type: image/png\r\n\r\n"
    ).encode() + body + f"\r\n--{bnd}--\r\n".encode()
    req = urllib.request.Request(
        ENGINE + "/upload/image?overwrite=true", data=parts,
        headers={"Content-Type": f"multipart/form-data; boundary={bnd}"},
    )
    with opener.open(req, timeout=180) as r:
        print("[upload]", r.read().decode()[:200], flush=True)


def png_dims(path):
    with open(path, "rb") as f:
        head = f.read(26)
    return struct.unpack(">II", head[16:24]) if head[:8] == b"\x89PNG\r\n\x1a\n" else None


def main():
    upload_ref()
    graph = json.load(open(TWIN))["graph"]
    for nid in ("10", "11", "12"):
        assert graph[nid]["class_type"] == "LoadImage", f"节点{nid}非LoadImage"
        graph[nid]["inputs"]["image"] = REF_REMOTE
    # 镜像产线覆写(qwen21.py:351-352 型层注入路):6:4011+6:4022 组装用途=道劫美术类型
    # → 画幅路由走九型画幅(人物海报 1536×2048)。上一发裸用件内默认「自由出图」走了参考图 1MP 路。
    for nid in ("6:4011", "6:4022"):
        graph[nid]["inputs"]["组装用途"] = "道劫美术类型"
    t0 = time.time()
    resp = http_json("/prompt", {"prompt": graph, "client_id": "gem-graft-test-1118"})
    pid = resp["prompt_id"]
    print(f"[fire] prompt_id={pid} accepted={resp.get('number')}", flush=True)
    while time.time() - t0 < POLL_MAX_S:
        h = http_json("/history/" + pid)
        if pid in h and (h[pid].get("status", {}).get("completed") or h[pid].get("outputs")):
            rec = h[pid]
            break
        time.sleep(5)
    else:
        print(f"[poll] 未完,续查: python3 {__file__} 只需重跑; pid={pid}", flush=True)
        raise SystemExit(7)
    st = rec.get("status", {})
    print(f"[done] success={st.get('status_str')} 耗时={time.time()-t0:.0f}s")
    if st.get("status_str") != "success":
        print(json.dumps(st, ensure_ascii=False)[:2000])
        raise SystemExit(8)
    os.makedirs(OUT_DIR, exist_ok=True)
    for nid, out in rec.get("outputs", {}).items():
        for img in out.get("images", []):
            fn, sub, typ = img["filename"], img.get("subfolder", ""), img["type"]
            url = f"{ENGINE}/view?filename={urllib.request.quote(fn)}&subfolder={urllib.request.quote(sub)}&type={typ}"
            dest = os.path.join(OUT_DIR, f"i2i_{nid}_{fn}")
            with opener.open(url, timeout=120) as r, open(dest, "wb") as f:
                f.write(r.read())
            ct = "RGBA" if open(dest, "rb").read(26)[25] == 6 else "RGB"
            print(f"[out] {dest} dims={png_dims(dest)} {ct} bytes={os.path.getsize(dest)}")


if __name__ == "__main__":
    main()
