"""晏燎 v5 双参考图生图跑批(10-22 用户令:基准脸+同期正视图,先试练气期)。
接线:<image1>=晏燎_人脸基准_中性_v1.png(节点10,bindings槽0) + <image2>=同期正视图
(节点11手填上传名,不剪11/17链;171.image_2 补接["17",0]=双编码器吃双图)。
健壮性:断言前置(fail-closed)/断点续跑/每发后/free/2K优选/日志双落/单发600s。
用法: python3 apps/build/scripts/yanliao_v5_dualref_batch_1022.py [期名1 期名2 …](缺省=练气)
产物= apps/output/晏燎/trial_基准/晏燎_{期}期_{产物}_v5.png
"""
import json, sys, time, uuid
import urllib.request as ureq
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "apps/backend"))
from engines.image_engine.comfyui_bridge import instantiate_template, load_template  # noqa: E402

ENGINE = "http://127.0.0.1:17001"
ROLE = Path("/Users/zhengbingjin/Project/IP/MA/store/assets/files/role/晏燎")
SRC = ROOT / "apps/output/晏燎"
OUT = SRC / "trial_基准"

def _upload(png: bytes, name: str) -> str:
    bd = uuid.uuid4().hex
    body = (b"--" + bd.encode()
            + f'\r\nContent-Disposition: form-data; name="image"; filename="{name}"'
              "\r\nContent-Type: image/png\r\n\r\n".encode() + png
            + b"\r\n--" + bd.encode() + b"--\r\n")
    req = ureq.Request(ENGINE + "/upload/image", data=body,
                       headers={"Content-Type": f"multipart/form-data; boundary={bd}"})
    with ureq.urlopen(req, timeout=120) as r:
        return json.load(r)["name"]

def _post(path: str, payload: dict, timeout: int = 30) -> dict:
    req = ureq.Request(ENGINE + path, data=json.dumps(payload).encode(),
                       headers={"Content-Type": "application/json"})
    with ureq.urlopen(req, timeout=timeout) as r:
        return json.load(r)

def _log(msg: str) -> None:
    print(msg, flush=True)
    with open(SRC / "v5_batch.log", "a", encoding="utf-8") as f:
        f.write(msg + "\n")

def run_item(it: dict, refs: dict) -> None:
    """双参考接线 + 覆写 + 提交轮询取图;任何一步违例即抛(fail-closed)。"""
    for key in ("参考图1", "参考图2"):
        if it[key] not in refs:
            refs[it[key]] = _upload((ROLE / it[key]).read_bytes(), f"yl-v5-{it[key]}")
    # 传双参考名:len==2 绕过产品侧单参考剪链补丁(bindings 仅槽0,吃参考图1)
    graph = instantiate_template(load_template("qwen21_道劫_i2i_api"),
                                 it["提示词终稿"], None, 8,
                                 uuid.uuid4().int % (2**31 - 1), "1:1",
                                 [refs[it["参考图1"]], refs[it["参考图2"]]])
    assert "11" in graph and "17" in graph, "双参考链被剪(11/17 缺席)"
    # 双参考:<image2>=节点11手填正视图;11/17 链保留;171 补接 image_2
    assert graph["10"]["inputs"]["image"] == refs[it["参考图1"]], "节点10绑定漂移"
    graph["11"]["inputs"]["image"] = refs[it["参考图2"]]
    assert graph["4015"]["inputs"]["images.image_2"] == ["17", 0], "4015双参考链漂移"
    graph["171"]["inputs"]["images.image_2"] = ["17", 0]
    for k, v in it["节点覆写"].items():
        nid, key = k.split(".")
        assert nid in graph and key in graph[nid]["inputs"], f"桥缺 {nid}.{key}"
        graph[nid]["inputs"][key] = v
    # 10-22 用户令:①原生40步(双参考/脸锚定正源)+cfg1;②负面钉空零参与。
    # 桥快照只携带 Turbo 臂(展平剪枝),原生档 KSampler 由本脚本按画布在册
    # 定谳参数注入(40步/cfg1/euler/simple/model=风格LoRA[7034]/正负=[4015])
    graph["7:7010"] = {
        "class_type": "KSampler",
        "inputs": {"seed": ["7:7014", 0], "steps": 40, "cfg": 1.0,
                   "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0,
                   "model": ["7:7034", 0], "positive": ["4015", 0],
                   "negative": ["4015", 1], "latent_image": ["20", 0]},
        "_meta": {"title": "[7010] 原生出图·KSampler(脚本注入)"},
    }
    graph["7:7015"]["inputs"]["latent_direct"] = ["7:7010", 0]
    graph["7:7015"]["inputs"]["mode"] = "1 · 原生出图"
    for te in ("4015", "171"):
        if te in graph and "negative_prompt" in graph[te]["inputs"]:
            graph[te]["inputs"]["negative_prompt"] = ""
    if it["期"] == "炼虚" and it["产物"] != "人物多视图":  # 512x1024 长条源特判:方画幅
        graph["6:4022"]["inputs"]["组装用途"] = "新建资产"
        graph["6:4018"]["inputs"]["手动宽"] = 1024
        graph["6:4018"]["inputs"]["手动高"] = 1024
    pid = _post("/prompt", {"prompt": graph, "client_id": "yl-v5"})["prompt_id"]
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        time.sleep(3)
        with ureq.urlopen(ENGINE + "/history/" + pid, timeout=10) as r:
            rec = json.load(r).get(pid)
        if not rec:
            continue
        if rec["status"]["status_str"] != "success":
            raise RuntimeError("引擎失败: " + str(rec["status"].get("messages"))[:200])
        images = [im for o in rec.get("outputs", {}).values() for im in o.get("images", [])]
        assert images, "成功但零输出"
        im = next((i for i in images if i["filename"].startswith("MYStudio-2K")), images[-1])
        with ureq.urlopen(ENGINE + "/view?" + urlencode(
                {"filename": im["filename"], "subfolder": im.get("subfolder", ""),
                 "type": im.get("type", "output")}), timeout=180) as r:
            content = r.read()
        if len(content) < 100_000:
            raise RuntimeError(f"疑似空片 {len(content)//1024}KB,拒收")
        (OUT / f"晏燎_{it['期']}期_{it['产物']}_v5.png").write_bytes(content)
        return len(content)
    raise TimeoutError("单发超时600s")

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    wanted = sys.argv[1:] or ["练气"]
    items = [x for x in json.loads((SRC / "prompts.json").read_text(encoding="utf-8"))["条目"]
             if x["期"] in wanted]
    assert items, f"prompts.json 无目标期: {wanted}"
    _log(f"[v5] 目标 {sorted(set(wanted))} 共 {len(items)} 发(双参考:基准脸+同期正视图)")
    refs, done, fail, skip = {}, 0, 0, 0
    for it in items:
        out = OUT / f"晏燎_{it['期']}期_{it['产物']}_v5.png"
        if out.exists():
            skip += 1
            continue
        t0 = time.time()
        try:
            size = run_item(it, refs)
            done += 1
            _log(f"[ok] {out.name} {size//1024}KB {time.time()-t0:.0f}s")
        except Exception as exc:
            fail += 1
            _log(f"[FAIL] {out.name}: {str(exc)[:180]}")
        try:
            _post("/free", {"unload_models": True, "free_memory": True})
        except Exception:
            pass
    _log(f"[v5 终] ok={done} fail={fail} skip={skip}")

if __name__ == "__main__":
    main()
