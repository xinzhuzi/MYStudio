#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ch001 参考节点对齐(R2)——一次性运维脚本(契约:.trellis/tasks/11-25-ch001-closeout-regen-thumb-video/design.md §3.5)。

用途(做四件事):
  1. 取图:从引擎输入目录取回背面单格(GET /view,build_opener(ProxyHandler({})) 绕本机代理,
     引擎恒只读)。校验:PNG 文件头、尺寸 465×1145、sha256 与常量一致(1125 只记前 16 位
     82f38fd0510f3b77;全量哈希在 --dry 时打印,回填 EXPECTED_SHA256 后则按全量校验)。
  2. 入资产库(照抄 App 的 addAssetImage,apps/frontend/electron/storage/studio-assets-storage.ts:330-375):
     文件落 files/role/独孤剑尘/<名>.png(已存在则中止,不覆盖);缩略图落同构 thumbs/ 路径
     (sips -z 200 200,同文件 :321 的做法);assets.db「独孤剑尘」行(id d715e3de-7c22-4a3d-
     ad6b-3af65b2fd9c9)的 images[] 末位追加一条(不带 kind,读路按命名派生)并更新 updatedAt。
     末位追加理由:App 自动挑参考取图库里第一个带 _人物图_/_正视图_ 的图
     (storyboard-asset-references.ts:219-239),背面单格名不带这两个标记,追加不改变自动挑选结果
     (脚本按同一正则复核追加名不带标记才放行)。
  3. 改节点:S09、S12、S13、S14、S15 各自当前图工作流(分镜行 imageWorkflowId 指的那份)里,
     source.assetType=="character" 且标题「独孤剑尘」的参考节点,imageUrl 改为
     asset-file://role/<按段百分号编码路径>(与现有海报 URL 同一种编码);只改这一个字段。
  4. 核对(按角色):逐镜读回;每个角色参考节点指的图 = 定稿内嵌请求(PNG tEXt/zTXt/iTXt 的
     prompt JSON,逐节点 inputs.image*)按文件名认出的该角色用图;两边按角色比对。预期 19/19,
     S11–S15 晏燎 5 处是已知例外(节点=晏燎_练气期_正视图_v1.png,定稿用只差一圈透明边的垫底版),
     单列不算失败。另打印「App 会送的槽位组合 vs 定稿实发组合」对照表(左=当前代码槽位规则
     storyboard-canonical-context.ts extractCanonicalSlotSources + storyboard-canonical-prompt.ts
     mapCanonicalReferenceSlots 的复刻;右=定稿 LoadImage 节点按 id 升序,即证据档 1.5 的节点
     10/11/12 口径)——只报告,不判对错。S13 的左列顺序与证据档 1.5 的行可能有出入(该行按
     1125 当时的图算),逐槽同/异结论与「相同 3 镜」总数不受影响。

用法:
  python3 -I -B ch001_refnode_align_1125.py --dry   # 干跑:只核对与打印,不写任何东西
  python3 -I -B ch001_refnode_align_1125.py --go    # 真跑:带备份、原子写、读回断言

防呆(任何一条不过就一项不写,退出码 2):
  - App 正在运行(ps -axo comm= 出现 漫影工作室.app/Contents/MacOS/漫影工作室)→ 中止;
  - 引擎取图校验不过(PNG 头/尺寸/哈希)→ 中止;引擎恒只读,禁上传禁删;
  - 资产库目标文件/缩略图已存在、images[] 已含同名条目、追加名带单姿标记 → 中止;
  - 待改节点清单 != S09/S12/S13/S14/S15(每镜恰 1 个独孤参考节点)→ 中止;
  - 晏燎已知例外 != 5 处或不落在 S11–S15 → 中止;
  - 写库前备份 assets.db(assets.db.bak-refnode1125-HHMMSS),写分片前备份该分片(后缀
    .bak-refnode1125-HHMMSS;5 个工作流现都在 image-workflows-001 一个分片里,按实际分片数备份);
  - 写前复核目标文件没被别的会话改过(大小与修改时间不变);
  - 分片用临时文件+原子替换;读回断言 images[] 恰好多一条、5 个节点 imageUrl 逐字等于预期;
  - 改前改后各算一次 19 镜来源指纹(storyboardSourceFingerprint 的 JS 复刻,studio-store-
    continuity-helpers.ts:126-146),必须完全相同(参考节点不在指纹里);stale 仍为假;
  - 成功后写日志 JSON:workflow-images/chapter-001/_v3-wip/_notes/refnode-align-1125.json
    (改了什么、备份在哪、哈希是多少;干跑不写日志)。

不做:晏燎垫底版不入库、晏燎节点不动(用户 1125 裁决,证据档 1.4);主图不动;
  不 git commit。退出码:0=成功;2=防呆不过(打印原因);1=意外异常。
"""
from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import os
import re
import shutil
import sqlite3
import struct
import subprocess
import sys
import urllib.parse
import urllib.request
import zlib
from datetime import datetime, timezone

# ── 常量(契约值,勿随手改) ────────────────────────────────────────────────
ENGINE_BASE = "http://192.168.0.101:17000"
MA_ROOT = "/Users/zhengbingjin/Project/IP/MA"
ASSETS_DIR = os.path.join(MA_ROOT, "store", "assets")
ASSETS_DB = os.path.join(ASSETS_DIR, "assets.db")
CHAPTER_STORE = os.path.join(MA_ROOT, "store", "studio-workflow", "chapters", "chapter-001")
NOTES_DIR = os.path.join(MA_ROOT, "workflow-images", "chapter-001", "_v3-wip", "_notes")
LOG_PATH = os.path.join(NOTES_DIR, "refnode-align-1125.json")
PROJECT_ID = "49dce4c1-64b1-42de-85c2-9f266698aec4"

ASSET_ID = "d715e3de-7c22-4a3d-ad6b-3af65b2fd9c9"
ROLE_NAME = "独孤剑尘"
IMG_NAME = "独孤剑尘_人物多视图_背面_2026年11月23日.png"
IMG_STEM = "独孤剑尘_人物多视图_背面_2026年11月23日"
NEW_ENTRY = {"name": IMG_STEM, "filePath": f"role/{ROLE_NAME}/{IMG_NAME}"}
NEW_URL = "asset-file://role/" + urllib.parse.quote(ROLE_NAME, safe="") + "/" + urllib.parse.quote(IMG_NAME, safe="")

EXPECTED_DIMS = (465, 1145)
EXPECTED_SHA16 = "82f38fd0510f3b77"
# 全量哈希:1125 第一次 --dry 从引擎取回实算(82f38fd0510f3b77c2101de0a7d9adc5
# 8a715d3d44d3869a278d58a8d9fbc0da,465×1145、424607 字节),照 implement.md
# Task 7 Step 2 的协议回填;此后取图按全量校验。
EXPECTED_SHA256 = "82f38fd0510f3b77c2101de0a7d9adc58a715d3d44d3869a278d58a8d9fbc0da"

TARGET_SHOTS = [9, 12, 13, 14, 15]      # 改指背面单格的 5 镜(契约清单)
EXCEPTION_SHOTS = [11, 12, 13, 14, 15]  # 晏燎已知例外(只报告,不判失败)
ALL_SHOTS = list(range(1, 20))
YANLIAO_NODE_BASENAME = "晏燎_练气期_正视图_v1.png"
YANLIAO_FINAL_BASENAME = "晏燎_练气期_正视图_垫底.png"
# App 自动挑单姿参考的标记(storyboard-asset-references.ts:230 poseMarker)
POSE_MARKER_RE = re.compile(r"_(?:人物图|正视图)_")
SHARD_BAK_TAG = "refnode1125"
APP_PROC_MARK = "漫影工作室.app/Contents/MacOS/漫影工作室"


class GuardFail(Exception):
    """防呆不过:打印原因,退出码 2,一项都不写。"""


def utc_iso_millis() -> str:
    # 等价 JS new Date().toISOString():2026-11-25T13:06:40.123Z
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%dT%H:%M:%S") + ".%03dZ" % (now.microsecond // 1000)


# ── JS 复刻:stableHash(studio-store-continuity-helpers.ts:235) ────────────
def _canon(value):
    if isinstance(value, dict):
        return {k: _canon(value[k]) for k in sorted(value.keys())}
    if isinstance(value, list):
        return [_canon(x) for x in value]
    return value


def js_stable_hash(value) -> str:
    return json.dumps(_canon(value), ensure_ascii=False, separators=(",", ":"))


def storyboard_source_fingerprint(item: dict) -> str:
    """复刻 studio-store-continuity-helpers.ts:126-146 storyboardSourceFingerprint。
    JS JSON.stringify 会丢 undefined 值键:这里用「键在行里才收」表达同一语义
    (JSON 里 null 与 undefined 不同,行里显式 null 照收)。"""
    out: dict = {}
    for key in ("episodeId", "index", "trackKey", "duration", "prompt",
                "videoDesc", "shouldGenerateImage", "shotSemantics",
                "cinematic", "lines", "speakerId"):
        if key in item:
            out[key] = item[key]
    out["assetIds"] = item.get("assetIds") or []            # JS item.assetIds ?? []
    out["orderedReferenceManifest"] = item.get("orderedReferenceManifest") or []
    src_ev = item.get("sourceEvidence")
    if isinstance(src_ev, dict) and src_ev.get("scene"):
        out["sourceScene"] = src_ev["scene"]
    cs = item.get("continuityState")
    if cs is not None:                                       # JS truthy:{} 也算(行里不会是 {})
        out["continuityState"] = {k: v for k, v in cs.items() if k != "inputFingerprint"}
    return js_stable_hash(out)


# ── PNG 读块(定稿内嵌请求与缩略图尺寸都靠它,零第三方依赖) ──────────────────
def png_dims(data: bytes):
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise GuardFail("不是 PNG(PNG 文件头不符):%r" % data[:8])
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise GuardFail("PNG 缺 IHDR 块")
    w = struct.unpack(">I", data[16:20])[0]
    h = struct.unpack(">I", data[20:24])[0]
    return w, h


def png_texts(path: str) -> dict:
    texts = {}
    with open(path, "rb") as fh:
        data = fh.read()
    pos = 8
    while pos + 8 <= len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        typ = data[pos + 4:pos + 8].decode("ascii", "replace")
        payload = data[pos + 8:pos + 8 + ln]
        if typ == "tEXt":
            k, _, v = payload.partition(b"\x00")
            texts[k.decode("latin-1")] = v.decode("latin-1")
        elif typ == "zTXt":
            k, _, rest = payload.partition(b"\x00")
            texts[k.decode("latin-1")] = zlib.decompress(rest[1:]).decode("latin-1")
        elif typ == "iTXt":
            k, _, rest = payload.partition(b"\x00")
            comp_flag = rest[0]
            rest2 = rest[2:]
            _lang, _, rest3 = rest2.partition(b"\x00")
            _trans, _, textdata = rest3.partition(b"\x00")
            if comp_flag == 1:
                textdata = zlib.decompress(textdata)
            texts[k.decode("latin-1")] = textdata.decode("utf-8", "replace")
        elif typ == "IEND":
            break
        pos += 12 + ln
    return texts


def url_basename(url: str) -> str:
    return urllib.parse.unquote((url or "").split("/")[-1])


def media_ref_local_path(shot: dict) -> str:
    path = (shot.get("mediaRef") or {}).get("path") or ""
    if not path.startswith(f"project-file://{PROJECT_ID}/"):
        raise GuardFail("mediaRef.path 不是本项目 project-file:// 路径:%s" % path[:120])
    rel = urllib.parse.unquote(path.replace(f"project-file://{PROJECT_ID}/", "", 1))
    return os.path.join(MA_ROOT, rel)


# ── 引擎取图(恒只读;恒 build_opener(ProxyHandler({})) 绕本机代理) ──────────
def fetch_back_cell():
    qs = urllib.parse.quote(IMG_NAME, safe="")
    url = f"{ENGINE_BASE}/view?filename={qs}&subfolder=&type=input"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(url, timeout=60) as resp:
        data = resp.read()
    w, h = png_dims(data)
    sha = hashlib.sha256(data).hexdigest()
    if (w, h) != EXPECTED_DIMS:
        raise GuardFail("取图尺寸 %dx%d != 预期 %dx%d" % (w, h, *EXPECTED_DIMS))
    if EXPECTED_SHA256:
        if sha != EXPECTED_SHA256:
            raise GuardFail("取图 sha256 %s != 常量全量哈希" % sha)
        hash_note = "常量全量哈希校验通过"
    else:
        if not sha.startswith(EXPECTED_SHA16):
            raise GuardFail("取图 sha256 前 16 位 %s != %s" % (sha[:16], EXPECTED_SHA16))
        hash_note = "常量只记前 16 位(%s),已按前 16 位校验;全量哈希回填 EXPECTED_SHA256 后按全量校验" % EXPECTED_SHA16
    print("取图校验:%d×%d,sha256=%s" % (w, h, sha))
    print("  (%s)" % hash_note)
    return data, sha


# ── 项目数据装载(全部只读) ────────────────────────────────────────────────
def glob_store(pattern):
    return [os.path.join(CHAPTER_STORE, name)
            for name in sorted(os.listdir(CHAPTER_STORE))
            if fnmatch.fnmatch(name, pattern) and ".bak" not in name]


def load_json(path):
    with open(path, "r", encoding="utf-8") as fh:
        return json.load(fh)


def load_storyboard_rows() -> dict:
    rows = {}
    for path in sorted(glob_store("storyboards-*.json")):
        for row in load_json(path)["state"]["storyboards"]:
            rows[row["id"]] = row
    if len(rows) != len(ALL_SHOTS):
        raise GuardFail("分镜行数 %d != 预期 19" % len(rows))
    return rows


def load_workflow_index() -> dict:
    idx = {}
    for path in sorted(glob_store("image-workflows-*.json")):
        for wf in load_json(path)["state"]["imageWorkflows"]:
            idx[wf["id"]] = (path, wf)
    return idx


def upstream_reference_nodes(wf: dict, target_node_id):
    """extractCanonicalSlotSources 同口径:连向目标成图节点的上游节点集合。"""
    upstream = {e["source"] for e in wf.get("edges", []) if e.get("target") == target_node_id}
    refs = [n for n in wf.get("nodes", [])
            if n.get("type") == "reference"
            and isinstance(n.get("source"), dict)
            and n["source"].get("kind") == "asset"
            and n.get("imageUrl")
            and n["id"] in upstream]
    return refs, upstream


def final_request_images(shot: dict):
    """读定稿 PNG 内嵌请求:prompt JSON 里全部 LoadImage 节点的 inputs.image(字符串),
    按节点 id 数值升序(即证据档 1.5 的节点 10/11/12 槽序口径)。"""
    path = media_ref_local_path(shot)
    if not os.path.isfile(path):
        raise GuardFail("定稿不在盘:%s" % path)
    prompt = png_texts(path).get("prompt")
    if not prompt:
        raise GuardFail("定稿 PNG 无 prompt 文本块:%s" % path)
    graph = json.loads(prompt)

    def node_key(kv):
        nid = kv[0]
        return int(nid) if str(nid).isdigit() else 10 ** 9

    finals = []
    for _nid, node in sorted(graph.items(), key=node_key):
        if node.get("class_type") == "LoadImage":
            img = node.get("inputs", {}).get("image")
            if isinstance(img, str):
                finals.append(img)
    return finals, path


def app_slot_plan(wf: dict, target_node_id):
    """复刻 mapCanonicalReferenceSlots 的槽位规则(证据档 1.5 左列算法):
    image_1=首位角色否则场景;image_2=场景优先否则次角色;image_3=上一帧否则次角色否则场景;
    道具永不入图。标题按 normalizeFullwidthPunctuationForTitle 归一(表内只展示)。"""
    refs, upstream = upstream_reference_nodes(wf, target_node_id)

    def bucket(asset_type):
        picked = [n for n in refs if n["source"].get("assetType") == asset_type]
        picked.sort(key=lambda n: n.get("continuityOrder") if n.get("continuityOrder") is not None else 2 ** 53)
        return picked

    def norm_title(node):
        t = node.get("title") or ""
        return (t.replace(",", "，").replace(";", "；").replace(":", "：")
                 .replace("(", "（").replace(")", "）").replace(".", "。"))

    characters, scenes, props = bucket("character"), bucket("scene"), bucket("prop")
    prev = [n for n in wf.get("nodes", [])
            if n["id"] in upstream and n.get("type") == "generated" and n.get("resultUrl")]
    prev_url = prev[0].get("resultUrl") if prev else None
    slots, dropped = [], []
    if characters:
        n = characters.pop(0)
        slots.append(("character", norm_title(n), url_basename(n.get("imageUrl"))))
    elif scenes:
        n = scenes.pop(0)
        slots.append(("scene", norm_title(n), url_basename(n.get("imageUrl"))))
    if not slots:
        dropped = [("prop", norm_title(n)) for n in props]
        return slots, dropped
    if scenes:
        n = scenes.pop(0)
        slots.append(("scene", norm_title(n), url_basename(n.get("imageUrl"))))
    elif characters:
        n = characters.pop(0)
        slots.append(("character", norm_title(n), url_basename(n.get("imageUrl"))))
    if prev_url:
        slots.append(("previous-frame", "上一帧画面", url_basename(prev_url)))
    elif characters:
        n = characters.pop(0)
        slots.append(("character", norm_title(n), url_basename(n.get("imageUrl"))))
    elif scenes:
        n = scenes.pop(0)
        slots.append(("scene", norm_title(n), url_basename(n.get("imageUrl"))))
    dropped = ([("prop", norm_title(n)) for n in props]
               + [("character", norm_title(n)) for n in characters]
               + [("scene", norm_title(n)) for n in scenes])
    return slots, dropped


# ── 分析:待改清单 / 逐镜素材 ────────────────────────────────────────────────
def analyze(rows, wf_index):
    """逐镜:当前工作流、角色参考节点、定稿实发图、待改计划。
    to_fix = 独孤参考节点没指背面单格而定稿用了背面单格的镜。"""
    plans, per_shot, to_fix = {}, {}, []
    for i in ALL_SHOTS:
        sid = f"sb-chapter-001-{i:03d}"
        shot = rows[sid]
        wf_id = shot.get("imageWorkflowId")
        if not wf_id or wf_id not in wf_index:
            raise GuardFail("S%02d 的 imageWorkflowId 无所指工作流:%r" % (i, wf_id))
        shard_path, wf = wf_index[wf_id]
        finals, final_path = final_request_images(shot)
        refs, _up = upstream_reference_nodes(wf, shot.get("imageWorkflowNodeId"))
        chars = [n for n in refs if n["source"].get("assetType") == "character"]
        chars.sort(key=lambda n: n.get("continuityOrder") if n.get("continuityOrder") is not None else 2 ** 53)
        dugu_nodes = [n for n in chars if n.get("title") == ROLE_NAME]
        fix = {}
        if IMG_NAME in set(finals):
            for n in dugu_nodes:
                if url_basename(n.get("imageUrl")) != IMG_NAME:
                    fix[n["id"]] = NEW_URL
        if fix:
            if len(dugu_nodes) != 1:
                raise GuardFail("S%02d 独孤参考节点数 %d != 1,不敢改" % (i, len(dugu_nodes)))
            to_fix.append(i)
        plans[i] = {"wf_id": wf_id, "shard": shard_path, "fix": fix,
                    "dugu_node_id": dugu_nodes[0]["id"] if dugu_nodes else None,
                    "old_basename": url_basename(dugu_nodes[0].get("imageUrl")) if dugu_nodes else None,
                    "finals": finals, "final_path": final_path}
        per_shot[i] = {"chars": chars, "all_refs": refs}
    return plans, per_shot, to_fix


def char_check_for_shot(i, plan, per_shot_i, fix_applied):
    """按角色核对(单镜)。pass 判据:定稿实发每张图都有(对齐后)参考节点背书
    (角色/场景/道具任一);每个角色参考节点要么指对、要么是晏燎已知例外。
    节点有而定稿未用的参考(App 槽位规则多送,如 S03/S04/S17 的次角色)不算
    失败——那是对照表报告域。"""
    chars = per_shot_i["chars"]
    finals = plan["finals"]
    final_set = set(finals)
    fixed_map = plan["fix"] if fix_applied else {}
    problems, exceptions = [], []
    matched = 0
    eff_basenames = {url_basename(n.get("imageUrl")) for n in per_shot_i["all_refs"]}
    yanliao_raw, dugu_eff = None, None
    for n in chars:
        raw = url_basename(n.get("imageUrl"))
        eff = url_basename(fixed_map.get(n["id"], n.get("imageUrl")))
        eff_basenames.add(eff)
        title = n.get("title") or ""
        if title == "晏燎":
            yanliao_raw = raw
        if title == ROLE_NAME:
            dugu_eff = eff
        if eff in final_set:
            matched += 1
        elif (title == "晏燎" and raw == YANLIAO_NODE_BASENAME
              and YANLIAO_FINAL_BASENAME in final_set):
            exceptions.append((i, title, raw, YANLIAO_FINAL_BASENAME))
        else:
            finals_for_title = [f for f in finals if f.startswith(title)]
            if finals_for_title:
                problems.append("S%02d 节点「%s」指 %s,定稿该角色实发 %s"
                                % (i, title, eff, finals_for_title[0]))
            # else:定稿根本没用这个角色 → 容忍(对照表报告域)
    for f in finals:
        if f in eff_basenames:
            continue
        if f == YANLIAO_FINAL_BASENAME and yanliao_raw == YANLIAO_NODE_BASENAME:
            continue  # 已在节点侧记为例外
        if f == IMG_NAME and dugu_eff == IMG_NAME:
            continue  # 实盘读回态:已改指,兜底放行
        problems.append("S%02d 定稿实发图无节点背书:%s" % (i, f))
    return matched, exceptions, problems


def run_char_check(rows, plans, per_shot, fix_applied):
    ok_shots, fail_shots, exception_rows = [], [], []
    for i in ALL_SHOTS:
        matched, exceptions, problems = char_check_for_shot(
            i, plans[i], per_shot[i], fix_applied=fix_applied)
        if problems:
            fail_shots.append((i, problems))
        else:
            ok_shots.append(i)
        exception_rows.extend(exceptions)
    return ok_shots, fail_shots, exception_rows


# ── 防呆与主流程 ──────────────────────────────────────────────────────────
def guard_app_not_running():
    r = subprocess.run(["ps", "-axo", "comm="], capture_output=True, text=True, timeout=30)
    if APP_PROC_MARK in (r.stdout or ""):
        raise GuardFail("漫影工作室正在运行,先关 App 再跑本脚本")


def load_asset_row():
    if not os.path.isfile(ASSETS_DB):
        raise GuardFail("assets.db 不存在:%s" % ASSETS_DB)
    con = sqlite3.connect(f"file:{ASSETS_DB}?mode=ro", uri=True)
    try:
        row = con.execute(
            "SELECT id,name,type,filePath,images,updatedAt FROM assets WHERE id=?", (ASSET_ID,)
        ).fetchone()
    finally:
        con.close()
    if not row:
        raise GuardFail("资产行不存在:id=%s" % ASSET_ID)
    return {"id": row[0], "name": row[1], "type": row[2], "filePath": row[3],
            "images": json.loads(row[4] or "[]"), "updatedAt": row[5]}


def guard_asset_state(asset_row):
    if POSE_MARKER_RE.search(IMG_STEM) or POSE_MARKER_RE.search(NEW_ENTRY["filePath"]):
        raise GuardFail("追加名带了单姿标记(_人物图_/_正视图_),会改变自动挑选结果")
    for entry in asset_row["images"]:
        if entry.get("filePath") == NEW_ENTRY["filePath"] or entry.get("name") == IMG_STEM:
            raise GuardFail("images[] 已含背面单格条目(可能已跑过 --go):%r" % entry)
    dest_file = os.path.join(ASSETS_DIR, "files", NEW_ENTRY["filePath"])
    dest_thumb = os.path.join(ASSETS_DIR, "thumbs", NEW_ENTRY["filePath"])
    for p in (dest_file, dest_thumb):
        if os.path.exists(p):
            raise GuardFail("目标已存在,不覆盖:%s" % p)
    if shutil.which("sips") is None:
        raise GuardFail("找不到 sips(macOS 自带),无法生成缩略图")
    return dest_file, dest_thumb


def stat_sig(path: str):
    st = os.stat(path)
    return (st.st_size, st.st_mtime_ns)


def atomic_write_bytes(path: str, data: bytes):
    tmp = path + ".tmp-refnode1125-%d" % os.getpid()
    with open(tmp, "wb") as fh:
        fh.write(data)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


def main() -> int:
    parser = argparse.ArgumentParser(description="ch001 参考节点对齐(R2;契约 design.md §3.5)")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry", action="store_true", help="只核对与打印,不写任何东西")
    mode.add_argument("--go", action="store_true", help="真跑:备份+原子写+读回断言")
    args = parser.parse_args()
    go = bool(args.go)

    try:
        guard_app_not_running()
        print("防呆:App 未运行 ✓")

        img_bytes, img_sha = fetch_back_cell()

        asset_row = load_asset_row()
        dest_file, dest_thumb = guard_asset_state(asset_row)
        print("资产库:将追加 1 条到独孤剑尘(现有 %d 条 → %d 条)"
              % (len(asset_row["images"]), len(asset_row["images"]) + 1))

        rows = load_storyboard_rows()
        wf_index = load_workflow_index()
        plans, per_shot, to_fix = analyze(rows, wf_index)
        if to_fix != TARGET_SHOTS:
            raise GuardFail("待改镜清单 %s != 契约 %s" % (to_fix, TARGET_SHOTS))
        print("将改 %d 个节点:%s" % (len(to_fix), " ".join("S%02d" % i for i in to_fix)))
        for i in to_fix:
            print("  S%02d 独孤参考节点 %s:现指 %s → 改指 %s"
                  % (i, plans[i]["dugu_node_id"], plans[i]["old_basename"], IMG_NAME))

        # 指纹(改前)与 stale
        fp_pre = {i: storyboard_source_fingerprint(rows[f"sb-chapter-001-{i:03d}"]) for i in ALL_SHOTS}
        stale_bad = [i for i in ALL_SHOTS if rows[f"sb-chapter-001-{i:03d}"].get("stale")]
        if stale_bad:
            raise GuardFail("这些镜 stale=真:%s" % stale_bad)

        # 分片快照(写前复核基线)
        shard_stats = {}
        for i in to_fix:
            shard_stats.setdefault(plans[i]["shard"], stat_sig(plans[i]["shard"]))

        # 按角色核对(计划态:5 节点按计划新指参与;--go 写后同函数跑实盘态)
        ok_shots, fail_shots, exception_rows = run_char_check(rows, plans, per_shot, fix_applied=True)
        if fail_shots:
            for _i, problems in fail_shots:
                for p in problems:
                    print("  ✗ %s" % p)
            raise GuardFail("按角色核对 %d 镜不过(见上),一项都不写" % len(fail_shots))
        exc_shots = sorted({r[0] for r in exception_rows})
        if len(exception_rows) != len(EXCEPTION_SHOTS) or exc_shots != EXCEPTION_SHOTS:
            raise GuardFail("晏燎已知例外 %d 处(%s)!= 契约 5 处 S11–S15"
                            % (len(exception_rows), exc_shots))
        print("按角色核对:%d/%d 通过(晏燎已知例外 %d 处:%s)"
              % (len(ok_shots), len(ALL_SHOTS), len(exception_rows),
                 " ".join("S%02d" % i for i in exc_shots)))

        # 槽位组合对照(只报告,不判对错)
        same_shots, diff_shots = [], []
        for i in ALL_SHOTS:
            shot = rows[f"sb-chapter-001-{i:03d}"]
            wf = wf_index[shot["imageWorkflowId"]][1]
            slots, _dropped = app_slot_plan(wf, shot.get("imageWorkflowNodeId"))
            app_list = [s[2] for s in slots]
            fin_list = plans[i]["finals"]
            same = app_list == fin_list
            (same_shots if same else diff_shots).append(i)
            print("  S%02d [%s] 会送:%s | 实发:%s"
                  % (i, "同" if same else "异",
                     "、".join(app_list) if app_list else "(零槽)",
                     "、".join(fin_list) if fin_list else "(零图)"))
        print("槽位组合对照(只报告):逐槽相同 %d 镜 %s,不同 %d 镜"
              % (len(same_shots), " ".join("S%02d" % i for i in same_shots), len(diff_shots)))

        if not go:
            fp_post = {i: storyboard_source_fingerprint(rows[f"sb-chapter-001-{i:03d}"]) for i in ALL_SHOTS}
            if fp_pre != fp_post:
                raise GuardFail("干跑期内分镜源已变化(指纹前后不一致)")
            print("指纹:19 镜改前/改后一致;stale 全假")
            print("干跑结束,未改动任何东西")
            return 0

        # ── 真跑(--go):写前复核 → 图+缩略图 → 库 → 分片 → 实盘核对 → 指纹 → 日志 ──
        db_sig = stat_sig(ASSETS_DB)
        for p, sig in shard_stats.items():
            if stat_sig(p) != sig:
                raise GuardFail("分片在核对期间被别的会话改过:%s" % p)
        if stat_sig(ASSETS_DB) != db_sig:
            raise GuardFail("assets.db 在核对期间被别的会话改过")
        for p in (dest_file, dest_thumb):
            if os.path.exists(p):
                raise GuardFail("目标文件在核对期间出现,不覆盖:%s" % p)
        started = datetime.now().strftime("%H%M%S")

        # 1) 图文件 + 缩略图
        os.makedirs(os.path.dirname(dest_file), exist_ok=True)
        os.makedirs(os.path.dirname(dest_thumb), exist_ok=True)
        atomic_write_bytes(dest_file, img_bytes)
        sips = subprocess.run(["sips", "-z", "200", "200", dest_file, "--out", dest_thumb],
                              capture_output=True, text=True, timeout=120)
        if sips.returncode != 0 or not os.path.isfile(dest_thumb):
            raise GuardFail("sips 缩略图失败:rc=%s %s" % (sips.returncode, sips.stderr[-300:]))
        with open(dest_thumb, "rb") as fh:
            tw, th = png_dims(fh.read(64))
        if (tw, th) != (200, 200):
            raise GuardFail("缩略图尺寸 %dx%d != 200×200" % (tw, th))
        print("资产库:图与缩略图已落盘(200×200)")

        # 2) assets.db images[] 末位追加(先备份,事务,读回断言)
        db_bak = ASSETS_DB + ".bak-%s-%s" % (SHARD_BAK_TAG, started)
        shutil.copy2(ASSETS_DB, db_bak)
        con = sqlite3.connect(ASSETS_DB)
        try:
            con.execute("BEGIN IMMEDIATE")
            cur = con.execute("SELECT images FROM assets WHERE id=?", (ASSET_ID,)).fetchone()
            images = json.loads(cur[0] or "[]")
            if any(e.get("filePath") == NEW_ENTRY["filePath"] for e in images):
                raise GuardFail("写库前 images[] 又出现了背面单格条目,中止")
            images.append(dict(NEW_ENTRY))
            con.execute("UPDATE assets SET images=?, updatedAt=? WHERE id=?",
                        (json.dumps(images, ensure_ascii=False, separators=(",", ":")),
                         utc_iso_millis(), ASSET_ID))
            con.commit()
        except Exception:
            con.rollback()
            raise
        finally:
            con.close()
        row2 = load_asset_row()
        if len(row2["images"]) != len(asset_row["images"]) + 1:
            raise GuardFail("读回断言失败:images[] 条数 %d != %d"
                            % (len(row2["images"]), len(asset_row["images"]) + 1))
        if row2["images"][-1] != NEW_ENTRY:
            raise GuardFail("读回断言失败:末条 %r != 预期 %r" % (row2["images"][-1], NEW_ENTRY))
        print("资产库:images[] %d → %d 条,末条=%s(读回断言通过)"
              % (len(asset_row["images"]), len(row2["images"]), IMG_STEM))

        # 3) 分片:5 个节点改指(先备份,临时文件+原子替换,读回断言)
        by_shard = {}
        for i in to_fix:
            by_shard.setdefault(plans[i]["shard"], []).append(i)
        shard_baks, changed_total = {}, 0
        for shard, shots in sorted(by_shard.items()):
            bak = shard + ".bak-%s-%s" % (SHARD_BAK_TAG, started)
            shutil.copy2(shard, bak)
            shard_baks[shard] = bak
            doc = load_json(shard)
            changed = 0
            for i in shots:
                wf_id = plans[i]["wf_id"]
                node_id = plans[i]["dugu_node_id"]
                for wf in doc["state"]["imageWorkflows"]:
                    if wf["id"] == wf_id:
                        for n in wf["nodes"]:
                            if n["id"] == node_id:
                                if n.get("type") != "reference" or url_basename(n.get("imageUrl")) == IMG_NAME:
                                    raise GuardFail("S%02d 目标节点状态与计划不符,中止" % i)
                                n["imageUrl"] = NEW_URL
                                changed += 1
            if changed != len(shots):
                raise GuardFail("分片 %s 计划改 %d 个节点,实改 %d"
                                % (os.path.basename(shard), len(shots), changed))
            if stat_sig(shard) != shard_stats[shard]:
                raise GuardFail("分片在写前被改:%s" % shard)
            atomic_write_bytes(shard, json.dumps(doc, ensure_ascii=False).encode("utf-8"))
            rd = load_json(shard)
            if rd != doc:
                raise GuardFail("读回断言失败:分片 %s 读回 != 计划态" % os.path.basename(shard))
            for i in shots:
                wf_id = plans[i]["wf_id"]
                node_id = plans[i]["dugu_node_id"]
                wf2 = next(w for w in rd["state"]["imageWorkflows"] if w["id"] == wf_id)
                n2 = next(n for n in wf2["nodes"] if n["id"] == node_id)
                if n2.get("imageUrl") != NEW_URL:
                    raise GuardFail("读回断言失败:S%02d imageUrl=%r" % (i, n2.get("imageUrl")))
            changed_total += changed
        print("节点:改 %d 个(分片 %d 份,备份 %s)"
              % (changed_total, len(by_shard),
                 ", ".join(os.path.basename(v) for v in shard_baks.values())))

        # 4) 实盘读回按角色核对(19/19)
        rows2 = load_storyboard_rows()
        wf_index2 = load_workflow_index()
        plans2, per_shot2, to_fix2 = analyze(rows2, wf_index2)
        if to_fix2:
            raise GuardFail("实盘读回仍有待改镜:%s" % to_fix2)
        ok2, fail2, exc2 = run_char_check(rows2, plans2, per_shot2, fix_applied=True)
        if fail2:
            for _i, problems in fail2:
                for p in problems:
                    print("  ✗ %s" % p)
            raise GuardFail("实盘按角色核对 %d 镜不过" % len(fail2))
        if len(exc2) != len(EXCEPTION_SHOTS) or sorted({r[0] for r in exc2}) != EXCEPTION_SHOTS:
            raise GuardFail("实盘晏燎已知例外数/镜号与契约不符:%s" % exc2)
        print("按角色核对(实盘):%d/%d 通过(晏燎已知例外 %d 处)"
              % (len(ok2), len(ALL_SHOTS), len(exc2)))

        # 5) 指纹改后复核
        fp_post = {i: storyboard_source_fingerprint(rows2[f"sb-chapter-001-{i:03d}"]) for i in ALL_SHOTS}
        if fp_pre != fp_post:
            diff = [i for i in ALL_SHOTS if fp_pre[i] != fp_post[i]]
            raise GuardFail("指纹前后不一致:%s(分镜源被本脚本外的东西动了)" % diff)
        stale_bad2 = [i for i in ALL_SHOTS if rows2[f"sb-chapter-001-{i:03d}"].get("stale")]
        if stale_bad2:
            raise GuardFail("写后 stale=真:%s" % stale_bad2)
        print("指纹:19 镜改前/改后一致;stale 全假")

        # 6) 日志 JSON(原子写;改了什么、备份在哪、哈希是多少)
        log = {
            "task": "11-25-ch001-closeout-regen-thumb-video Task 7(R2)",
            "ranAt": utc_iso_millis(),
            "mode": "go",
            "asset": {"assetId": ASSET_ID, "role": ROLE_NAME,
                      "imagesBefore": len(asset_row["images"]), "imagesAfter": len(row2["images"]),
                      "appended": NEW_ENTRY, "file": dest_file, "thumb": dest_thumb,
                      "sourceSha256": img_sha},
            "nodes": [{"shot": "S%02d" % i, "workflowId": plans[i]["wf_id"],
                       "nodeId": plans[i]["dugu_node_id"],
                       "oldBasename": plans[i]["old_basename"],
                       "newImageUrl": NEW_URL} for i in to_fix],
            "backups": {"db": db_bak,
                        "shards": {os.path.basename(k): v for k, v in shard_baks.items()}},
            "checks": {
                "charCheck": "%d/%d 通过(晏燎已知例外 %d 处)" % (len(ok2), len(ALL_SHOTS), len(exc2)),
                "fingerprint": "19 镜改前/改后一致;stale 全假",
                "slotTable": "逐槽相同 %d 镜 %s,不同 %d 镜(只报告)"
                             % (len(same_shots), " ".join("S%02d" % i for i in same_shots), len(diff_shots)),
            },
        }
        os.makedirs(NOTES_DIR, exist_ok=True)
        atomic_write_bytes(LOG_PATH, json.dumps(log, ensure_ascii=False, indent=2).encode("utf-8"))
        print("日志已写:%s" % LOG_PATH)
        print("完成:资产库 %d → %d 条;节点改 %d 个;按角色核对 %d/%d 通过(晏燎已知例外 %d 处);"
              "备份 %s 与 %d 个分片备份;指纹前后一致;日志已写"
              % (len(asset_row["images"]), len(row2["images"]), changed_total, len(ok2),
                 len(ALL_SHOTS), len(exc2), os.path.basename(db_bak), len(shard_baks)))
        return 0
    except GuardFail as exc:
        print("防呆不过:%s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
