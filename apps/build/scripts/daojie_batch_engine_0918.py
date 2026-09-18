#!/usr/bin/env python3
"""道劫七主体批量·引擎直排版(09-18)。

背景:CDP 驱动装机应用画布的路线与用户实时会话三次撞车(用户正当使用,
不硬闯),改走 App 托管引擎(17001)API 直排——同一工作流真源文件、队列
礼让(用户任务优先)、零触碰画布。旁路 mode 感知:链上 mode=4 的 LoRA
穿透跳过,忠实还原文件当前激活集(47/67/68/70/73)。

产物:output/daojie_batch_0917/01-07(与 CDP 版同名,幂等断点续跑)。

09-18 加固(实弹教训:02 号轮询 /history 时用户关应用带死引擎,
ConnectionRefusedError 崩掉整轮):①http 调用统一走可重试封装(连接类
异常退避重试,耗尽抛 EngineDisconnected);②引擎断线自愈——curl 探活轮询
引擎(先 17001 后 17000,至多 15 分钟),回来后当前主体同种子重交(引擎
重启 history 即清空,老 prompt_id 作废),每主体重交上限 3 次;幂等(产物
在盘即跳过)与队列礼让保持不变。
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from daojie_handsfix_run_0917 import BASE, CLIENT, http_json, ui_to_api  # noqa: E402

REPO = Path("/Users/zhengbingjin/Project/Github/MYStudio")
WF = REPO / "apps/backend/engines/comfyui/workflows/1_图片/K2图像/1_文生图/K2-文生图-道劫.json"
OUT_DIR = REPO / "output/daojie_batch_0917"

SUBJECTS = [
    ("01-人物-女剑修-按剑", 20260901, "一位青年女剑修，筑基后期，气质剑意凌厉，肤色温润透亮，五官英朗；墨黑长发束成高马尾垂至腰际，发丝逐层分明；身着素色劲装道袍，月白纯色，腰带束腰，素布质感，衣纹线条流畅；立于画面左三分之一处，面朝右方，右手按于腰间剑柄，目光垂视剑鞘方向，神色沉静；背景淡墨远山，大面积留白。"),
    ("02-人物-中年男修-拢袖", 20260902, "一位中年男修士，元婴初期，气质温润如玉，肤色温润透亮，五官温润；墨黑长发绾成道髻，发丝逐层分明；身着淡青道袍长衫，素布质感，衣纹线条流畅；立于画面右侧三分之一处，面朝左方，双手拢于袖中收在身前，目视前方，神色沉静；背景纯色浅净，大面积留白。"),
    ("03-人物-女修-拂尘法印", 20260903, "一位青年女修士，金丹初期，气质清冷出尘，肤色温润透亮，五官清隽；墨黑长发绾成双丫道髻，发丝逐层分明；身着素色道袍长裙，米白纯色，云锦薄染质感，衣纹线条流畅；位于画面中右，左手持一柄白色拂尘自然垂落，右手手指于胸前掐法印，目光平视前方，神色专注；背景淡墨云雾，大面积留白。"),
    ("04-场景-山水", 20260904, "层叠远山以细墨线勾勒轮廓，淡墨晕染云雾，墨色浓淡干湿层次分明；山石以赭石与石绿低饱和点染，近景一株古松横斜，旧金点缀枝干转折；溪涧以留白作水面，云气大面积流转；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。"),
    ("05-场景-道观山门", 20260905, "一座道观山门位于画面中景，重檐以细墨线勾勒层次，檐角旧金点缀；山门前淡墨晕染云雾缭绕，石阶蜿蜒而下，两侧苍松淡墨勾勒；远处山影只以淡墨一抹带过；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。"),
    ("06-道具-古铜飞剑", 20260906, "一柄古铜飞剑悬于画面正中，剑身以细而稳的墨线勾勒，剑格纹样旧金点缀，剑身罩一层赭石薄染；剑尖旁淡墨云气缭绕流转；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。"),
    ("07-道具-丹炉", 20260907, "一只青灰丹炉置于石台之上，炉身以细而稳的墨线勾勒，炉耳旧金点缀，炉口三缕细烟以淡墨晕染升起；炉身暗面隐约有朱砂符纹浮动；温润米白的浅净平涂底，均匀柔光，无投影；仙道古韵的水墨国风画作。"),
]


# ── 09-18 断线自愈加固 ──────────────────────────────────────────────────────
# 引擎地址:先 App 托管口 17001,后备用口 17000;断线自愈后可能切换,故用
# 可变 _state 持有当前生效地址(原 BASE 为导入常量,不可变)。
ENGINE_BASES = ["http://127.0.0.1:17001", "http://127.0.0.1:17000"]
_state = {"base": BASE}
ENGINE_BACK_S = 900  # 引擎回归等待上限(15 分钟)
MAX_RESUBMIT = 3  # 每主体重交上限(不含首交)
# 连接类异常:urllib 把拒绝/重置包成 URLError 抛,也接住直抛形态
CONN_EXC = (urllib.error.URLError, ConnectionError, TimeoutError, socket.timeout)


class EngineDisconnected(Exception):
    """连接类异常重试耗尽——引擎疑似下线,交由断线自愈流程处理。"""


def curl_alive(base: str) -> bool:
    """curl 探活:拿到任意 HTTP 状态码(非 000)即视为引擎端口在服务。"""
    try:
        r = subprocess.run(
            ["curl", "-sS", "-m", "5", "-o", os.devnull, "-w", "%{http_code}", f"{base}/queue"],
            capture_output=True, text=True, timeout=10,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False  # curl 不在/自身超时,按不可达处理
    return r.returncode == 0 and r.stdout.strip() not in ("", "000")


def wait_engine_back(limit_s: int = ENGINE_BACK_S) -> str | None:
    """断线自愈:curl 轮询探活(先 17001 后 17000),引擎回来返回其地址,超时 None。"""
    t0 = time.time()
    last_log = 0.0
    while time.time() - t0 < limit_s:
        for base in ENGINE_BASES:
            if curl_alive(base):
                print(f"[heal] 引擎已回:{base}(等待 {time.time() - t0:.0f}s)", flush=True)
                return base
        if time.time() - last_log >= 60:  # 每分钟报一次等待进度
            print(f"[heal] 引擎下线中,探活 17001/17000 已等 {time.time() - t0:.0f}s", flush=True)
            last_log = time.time()
        time.sleep(10)
    return None


def http_json_retry(url: str, payload=None, tries: int = 3):
    """可重试 HTTP-JSON:连接类异常退避重试(2s/4s),耗尽抛 EngineDisconnected;
    HTTPError 已被 http_json 转成 RuntimeError(引擎在线的业务错误),不重试直接上抛。"""
    last: Exception | None = None
    for i in range(tries):
        try:
            return http_json(url, payload)
        except RuntimeError:
            raise  # 引擎活着,业务错误重试无意义
        except CONN_EXC as e:
            last = e
            if i < tries - 1:
                time.sleep(2 * (i + 1))
    raise EngineDisconnected(f"{url}: {last}") from last


def http_get_retry(url: str, tries: int = 3) -> bytes:
    """可重试 HTTP-GET(取 /view 成图字节),连接类异常退避重试,耗尽抛 EngineDisconnected。"""
    last: Exception | None = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url), timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code} {url}") from e
        except CONN_EXC as e:
            last = e
            if i < tries - 1:
                time.sleep(2 * (i + 1))
    raise EngineDisconnected(f"{url}: {last}") from last


def build_api(subject: str, seed: int) -> dict:
    wf = json.loads(WF.read_text(encoding="utf-8"))
    modes = {n["id"]: n.get("mode", 0) for n in wf["nodes"]}
    for n in wf["nodes"]:
        if n["id"] == 50:
            n["widgets_values"] = [subject]
            n["widgets_values_named"]["value"] = subject
        if n["id"] == 20:
            n["widgets_values"] = [seed, "", "", "okay"]
            n["widgets_values_named"]["seed"] = seed
        if n["id"] == 12:
            n["widgets_values"] = [seed, "fixed", 4, 1.0, "euler", "simple", 1]
            n["widgets_values_named"].update({"seed": seed, "control_after_generate": "fixed"})
    api = ui_to_api(wf, http_json_retry(f"{_state['base']}/object_info"))

    # mode 感知旁路解析(09-18 修复:旧版只改写 12.model 指向,上游旁路件
    # 连线原样保留→identity/Mystic 等毒件照跑,10 件同叠=废片)。正确做法:
    # 自 12.model 全链回溯收集 mode=0 的 LoRA 件,重建干净链,并把未保留的
    # LoRA 节点从提交图整体删除(不可达且不加载权重,提交图即执行图)。
    def chain_from(ref):
        nid = int(ref[0])
        node = api[str(nid)]
        if node["class_type"] != "LoraLoaderModelOnly":
            return [nid]  # 到底模(UNETLoader)
        if modes.get(nid, 0) == 4:
            return chain_from(node["inputs"]["model"])  # 旁路:穿透取上游
        return [nid] + chain_from(node["inputs"]["model"])

    kept = chain_from(api["12"]["inputs"]["model"])  # 近端→远端,尾为底模
    kept.reverse()                                    # [21, ...激活LoRA...]
    prev = str(kept[0])
    for nid in kept[1:]:
        api[str(nid)]["inputs"]["model"] = [prev, 0]
        prev = str(nid)
    api["12"]["inputs"]["model"] = [prev, 0]
    keep_set = {str(x) for x in kept}
    dropped = [k for k, v in api.items()
               if v["class_type"] == "LoraLoaderModelOnly" and k not in keep_set]
    for k in dropped:
        del api[k]
    print("[batch] model 链:" + "→".join(str(x) for x in kept)
          + f"(mode 感知旁路,剔除 {len(dropped)} 件)")
    return api


def wait_idle(limit_s: int = 900) -> None:
    t0 = time.time()
    while time.time() - t0 < limit_s:
        q = http_json_retry(f"{_state['base']}/queue")
        if not q.get("queue_running") and not q.get("queue_pending"):
            return
        time.sleep(5)
    print("[batch] 队列礼让超时,带队提交(用户任务可能仍在跑)")


def gen_one(name: str, seed: int, subject: str) -> bool:
    """单主体一次完整提交(装图→礼让→提交→轮询→取图)。成图返回 True;
    引擎错误/超时返回 False(引擎在线,不重交);连接类异常重试耗尽抛
    EngineDisconnected,由调用方断线自愈后同种子重交。"""
    api = build_api(subject, seed)
    wait_idle()
    pid = http_json_retry(f"{_state['base']}/prompt", {"prompt": api, "client_id": CLIENT})["prompt_id"]
    print(f"[{name}] 提交 seed={seed}", flush=True)
    t0 = time.time()
    image = None
    while time.time() - t0 < 900:
        time.sleep(6)
        h = http_json_retry(f"{_state['base']}/history/{pid}")
        if pid not in h:
            continue
        e = h[pid]
        if e.get("status", {}).get("status_str") == "error":
            print(f"[{name}] 引擎错误:", json.dumps(e["status"], ensure_ascii=False)[:400], flush=True)
            return False
        for out in (e.get("outputs") or {}).values():
            for im in out.get("images", []) or []:
                if im.get("type") == "output":
                    image = im
                    break
        if image:
            break
    if not image:
        # 900s 超时无 output 型成图即失败(原版此处 any(images) 为真的分支会拿
        # None 下标崩溃,顺带收平为统一计败)
        print(f"[{name}] 超时/失败", flush=True)
        return False
    q = urllib.parse.urlencode({"filename": image["filename"], "subfolder": image.get("subfolder", ""), "type": "output"})
    data = http_get_retry(f"{_state['base']}/view?{q}")
    dest = OUT_DIR / f"{name}.png"
    dest.write_bytes(data)
    print(f"[{name}] ✅ {image['filename']} → {dest} ({(time.time()-t0):.0f}s, {len(data)//1024}KB)", flush=True)
    return True


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    todo = [(f, s, p) for f, s, p in SUBJECTS if not (OUT_DIR / f"{f}.png").exists()]
    if not todo:
        print("[batch] 7/7 已在盘,幂等退出")
        return 0
    print(f"[batch] 待出图 {len(todo)}/7(引擎直排,mode 感知激活集)")
    fail = 0
    for name, seed, subject in todo:
        resubmits = 0  # 断线自愈后重走提交流程的次数(不含首交),上限 MAX_RESUBMIT
        while True:
            try:
                if gen_one(name, seed, subject):
                    break  # 成图,进入下一主体
                fail += 1  # 引擎错误/超时(引擎在线),按原版计 1 次失败
                break
            except EngineDisconnected as e:
                print(f"[{name}] 引擎断线:{e}", flush=True)
                if resubmits >= MAX_RESUBMIT:
                    print(f"[{name}] 重交已达上限 {MAX_RESUBMIT} 次,放弃", flush=True)
                    fail += 1
                    break
                base = wait_engine_back()
                if base is None:
                    print(f"[{name}] 引擎 {ENGINE_BACK_S // 60} 分钟未回,放弃", flush=True)
                    fail += 1
                    break
                _state["base"] = base
                resubmits += 1
                # 引擎重启即清空 history,老 prompt_id 作废——同种子重交
                print(f"[{name}] 引擎已回,同种子重交 seed={seed}(重交 {resubmits}/{MAX_RESUBMIT})", flush=True)
    print(f"[batch] 完成,失败 {fail};产物目录 {OUT_DIR}")
    return 0 if fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
