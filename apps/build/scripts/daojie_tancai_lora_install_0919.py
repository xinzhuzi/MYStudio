#!/usr/bin/env python3
"""道劫淡彩双件装机 0919(用户令:两件都下载,装入 K2-文生图-道劫.json 后自行调参)。

- [82] 画风·淡彩线描插画 ×1.0(civitai model 2811579 / version 3170693;触发词
  watercolor ink illustration style;09-19 五锚对拍首选,与道劫「细稳墨线+淡彩」最同构)
- [83] 画风·墨洗淡彩SumiWash ×1.0(civitai model 2891338 / version 3268891;无触发词;
  墨线+淡染米白宣纸底,设定板用需主体句锚静姿)
两件默认旁路(mode=4)权重 1.0——用户后续自行调整;旁路态=出图行为零变化。

链路:插在 [77]→[12] 之间(77→82→83→12)。
美化:LoRA 链 13 件按链序自左向右等距重排(y=80 统一行),分组②扩界+标题 11件→13件。
下载:走本机 7897 代理 + 用户 09-17 交付的 civitai token(仅下载用);
幂等:目标文件已存在且>150MB 跳过下载;[82] 已存在跳过图改造。
回写:ensure_ascii=False/indent=2/无尾换行,与文件现行格式字节级兼容。
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
ENGINE_LORA_DIR = Path.home() / "Library/Application Support/漫影工作室/comfyui/models/loras/Krea2-画风"
TOKEN = "811dd254c95caf136ab7d97a7497fb7f"  # 用户 09-17 交付,仅下载用(勿入 git 提交面)
PROXY = "http://127.0.0.1:7897"

NEW_LORAS = [
    {"nid": 82, "rel": "Krea2-画风/Krea2-淡彩线描插画_v1.safetensors",
     "ver": "3170693", "title": "[82] 画风·淡彩线描插画 ×1.0(默认旁路)"},
    {"nid": 83, "rel": "Krea2-画风/Krea2-墨洗淡彩SumiWash_v1.safetensors",
     "ver": "3268891", "title": "[83] 画风·墨洗淡彩SumiWash ×1.0(默认旁路)"},
    {"nid": 84, "rel": "Krea2-画风/Krea2-水彩湿画wash_v1.safetensors",
     "ver": "3176673", "title": "[84] 画风·水彩湿画wash ×1.0(默认旁路)"},
]
NEW_IDS = [s["nid"] for s in NEW_LORAS]          # [82, 83, 84]
MIN_BYTES = 150 * 1024 * 1024
READ_TIMEOUT = 120          # 单次 socket 读超时(秒):经代理读 CDN 失速按此熔断再重试
MAX_ATTEMPTS = 8
# civitai 前置 Cloudflare 按 UA 拦截:默认 Python-urllib UA → 403(error code: 1010
# 浏览器签名封禁);带浏览器 UA → 307→CDN 200(09-19 实测双版本均通)
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")


def _finalize(part: Path, dest: Path) -> None:
    size = part.stat().st_size
    with open(part, "rb") as f:
        head = f.read(8)
    header_len = struct.unpack("<Q", head)[0]
    if size < MIN_BYTES or not (0 < header_len < 10 * 1024 * 1024):
        part.unlink(missing_ok=True)
        raise RuntimeError(f"{dest.name} 校验失败: size={size} header={header_len}")
    os.replace(part, dest)
    print(f"INSTALLED {dest.name} {size} bytes")


def download(version_id: str, dest: Path) -> None:
    """civitai 下载(09-19 根修:首次装机在 copyfileobj 处 TimeoutError 即整笔报废
    ——经 7897 代理读 civitai CDN 长流会中途失速,首块 1MB 后即卡死 120s。
    实测该端点 307→R2 CDN 且 Range 续传返 206,故改为 .part 断点 + Range 续传 +
    指数退避重试;UA 修复保留,progress 每 64MB 报一次)。"""
    url = f"https://civitai.com/api/download/models/{version_id}?token={TOKEN}"
    proxies = {"http": PROXY, "https": PROXY} if PROXY else {}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler(proxies))
    part = dest.with_suffix(".part")
    last_err: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        offset = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": UA}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        try:
            req = urllib.request.Request(url, headers=headers)
            with opener.open(req, timeout=READ_TIMEOUT) as resp, \
                    open(part, "r+b" if offset else "wb") as f:
                if offset:
                    f.seek(0, os.SEEK_END)
                    if getattr(resp, "status", None) != 206:  # 续传被拒→整文件重下
                        offset = 0
                        f.seek(0)
                        f.truncate()
                total = offset + int(resp.headers.get("Content-Length") or 0)
                done = offset
                while True:
                    buf = resp.read(1024 * 1024)
                    if not buf:
                        break
                    f.write(buf)
                    done += len(buf)
                    if total and done // (64 << 20) != (done - len(buf)) // (64 << 20):
                        print(f"  {dest.name} 进度 {done}/{total} bytes", flush=True)
                if total and done < total:
                    raise RuntimeError(f"{dest.name} 传输中断: {done}/{total}")
            _finalize(part, dest)
            return
        except urllib.error.HTTPError as e:
            if e.code == 416 and part.exists():
                # 请求区间不可满足 = .part 已不小于全量(上次实际已拷完),直接落位
                _finalize(part, dest)
                return
            last_err = e
        except (TimeoutError, socket.timeout, ConnectionError, OSError,
                http.client.HTTPException, urllib.error.URLError,
                RuntimeError) as e:
            last_err = e
        kept = part.stat().st_size if part.exists() else 0
        print(f"RETRY {dest.name} 第 {attempt}/{MAX_ATTEMPTS} 次中断 "
              f"({type(last_err).__name__}: {last_err});.part 已落 {kept} bytes,"
              f"断点续传重试", flush=True)
        time.sleep(min(3 * 2 ** (attempt - 1), 30))
    raise RuntimeError(f"{dest.name} 重试 {MAX_ATTEMPTS} 次仍失败: {last_err!r}")


def model_chain(d: dict) -> list[int]:
    nodes = {n["id"]: n for n in d["nodes"]}
    links = d["links"]
    chain, cur = [21], 21
    while True:
        nxt = None
        for l in links:
            if l[1] == cur and nodes.get(l[3], {}).get("type") in (
                    "LoraLoaderModelOnly", "KSampler"):
                nxt = l[3]
                break
        if nxt is None or nxt == 12:
            chain.append(12)
            return chain
        if nxt in chain:
            raise RuntimeError(f"模型链成环: {chain + [nxt]}")
        chain.append(nxt)
        cur = nxt


def mutate_graph(d: dict) -> None:
    nodes = {n["id"]: n for n in d["nodes"]}
    if all(i in nodes for i in NEW_IDS):
        print("GRAPH 已含全部新节点,跳过图改造(幂等)")
        return
    # 断点续装:摘除可能存在的半成品新节点与其 link,再整链重建 77→82→83→84→12
    d["nodes"] = [n for n in d["nodes"] if n["id"] not in NEW_IDS]
    d["links"] = [l for l in d["links"]
                  if l[1] not in NEW_IDS and l[3] not in NEW_IDS]
    nodes = {n["id"]: n for n in d["nodes"]}
    src = 77
    # 桥接 link:存量 77→12 存在则复用(保 link id,改 origin 为末件→[12]);
    # 断点重装态下该桥已被摘除(其 origin 曾改到新节点),改为补建末件→[12]
    # 新链并回写 [12] 的 model 输入引用,否则 next() 直接 StopIteration。
    bridge = next((l for l in d["links"] if l[1] == src and l[3] == 12), None)
    # 09-19 根修:新 link id 从现有最大 link id(含 last_link_id)之后分配。
    # 旧版硬编码 60/61/62,而图内已有 link 60(19→69,last_link_id=60),
    # 撞号即触发 validate「link id 重复」。
    base = max([l[0] for l in d["links"]] + [int(d.get("last_link_id", 0))]) + 1
    if bridge is not None:
        bridge[1] = NEW_IDS[-1]                    # 末件→[12],link id 不变
        tail_lid = bridge[0]
    else:
        tail_lid = base + len(NEW_LORAS)
    import copy
    for k, spec in enumerate(NEW_LORAS):
        lid_in = base + k
        new = copy.deepcopy(nodes[77])
        new["id"] = spec["nid"]
        new["title"] = spec["title"]
        new["mode"] = 4
        new["widgets_values"] = [spec["rel"], 1]
        new["inputs"] = [{"name": "model", "type": "MODEL", "link": lid_in}]
        out_link = base + k + 1 if k + 1 < len(NEW_IDS) else tail_lid
        d["links"].append([lid_in, src, 0, spec["nid"], 0, "MODEL"])
        new["outputs"] = [{"name": "MODEL", "type": "MODEL", "slot_index": 0,
                           "links": [out_link]}]
        new["properties"] = {"Node name for S&R": "LoraLoaderModelOnly"}
        d["nodes"].append(new)
        nodes[spec["nid"]] = new
        nodes[src]["outputs"][0]["links"] = [lid_in]
        src = spec["nid"]
    if bridge is None:                             # 补建末件→[12] 并回写输入引用
        d["links"].append([tail_lid, NEW_IDS[-1], 0, 12, 0, "MODEL"])
        for inp in nodes[12].get("inputs", []):
            if inp.get("type") == "MODEL":
                inp["link"] = tail_lid
    d["last_node_id"] = max(NEW_IDS)
    d["last_link_id"] = max(l[0] for l in d["links"])


def beautify(d: dict) -> None:
    chain = model_chain(d)          # 21, 13×LoRA, 12
    lora_chain = chain[1:-1]
    nodes = {n["id"]: n for n in d["nodes"]}
    for i, nid in enumerate(lora_chain):     # 美化:链序等距横排一行
        n = nodes[nid]
        n["pos"] = [1300 + i * 490, 80]
        n["size"] = [460, 130]
        n["order"] = 10 + i
    for g in d.get("groups", []):
        if g.get("title", "").startswith("②"):
            g["title"] = (f"② LoRA 链({len(lora_chain)} 件,链序自左向右;"
                          "淡彩三件 82/83/84 默认旁路;画风件一次一枚)")
            g["bounding"] = [1220, 40, 490 * len(lora_chain) + 100, 190]
    print(f"BEAUTIFY 链序横排 {len(lora_chain)} 件,分组②已扩界")


def validate(d: dict) -> None:
    ids = {n["id"] for n in d["nodes"]}
    assert len(d["nodes"]) == len(ids), "节点 id 重复"
    link_ids = [l[0] for l in d["links"]]
    dups = sorted({i for i in link_ids if link_ids.count(i) > 1})
    assert not dups, f"link id 重复: {dups}"
    for l in d["links"]:
        assert l[1] in ids and l[3] in ids, f"悬空 link {l}"
    chain = model_chain(d)
    assert chain[0] == 21 and chain[-1] == 12 and all(i in chain for i in NEW_IDS), chain
    print(f"VALIDATE 节点={len(d['nodes'])} links={len(d['links'])} 链={chain}")


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    ENGINE_LORA_DIR.mkdir(parents=True, exist_ok=True)
    if arg.startswith("--only="):                 # 按件模式:只下载指定一件即退
        nid = int(arg.split("=")[1])
        todo = [s for s in NEW_LORAS if s["nid"] == nid]
        assert todo, f"未知 --only 目标 {nid}"
        for spec in todo:
            dest = ENGINE_LORA_DIR / Path(spec["rel"]).name
            if dest.exists() and dest.stat().st_size > MIN_BYTES:
                print(f"SKIP {dest.name} 已存在 {dest.stat().st_size} bytes")
            else:
                download(spec["ver"], dest)
        return 0
    for spec in NEW_LORAS:                        # 默认/--graph:先验三件齐备
        dest = ENGINE_LORA_DIR / Path(spec["rel"]).name
        if not (dest.exists() and dest.stat().st_size > MIN_BYTES):
            if arg == "--graph":
                raise RuntimeError(f"模型缺件: {dest.name}")
            download(spec["ver"], dest)
    raw = WF.read_text(encoding="utf-8")
    d = json.loads(raw)
    mutate_graph(d)
    beautify(d)
    validate(d)
    out = json.dumps(d, ensure_ascii=False, indent=2)
    WF.write_text(out, encoding="utf-8")
    check = json.loads(WF.read_text(encoding="utf-8"))
    validate(check)
    print("OK 全部落位(引擎家模型 + 道劫图 [82]/[83]/[84] + 画布美化)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
