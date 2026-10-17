#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""h3_upgrade_1014.py — H3 视频 4step LoRA 升级单刀主线(已批方案 2026-10-14)。

v1.1 rank-28 压缩件(393,791,328B)→ lightx2v v1.2_768p_comfyui 全量件(1,956,193,000B)。
铁律:大手术走脚本、留台账、先备份后清理;幂等可重跑(源不在/已迁移=SKIP,断点保留可续传)。

执行顺序(方案【执行顺序强约束】):
  ① curl -L --fail -C - 断点续传下载 v1.2 至 <引擎家>/models/loras,
     校验口径=落盘字节数恰等 1,956,193,000;
  ② 官方模板整文件替代 —— 本役零项(方案 skips#6:官方替代经实拉核验后否决,
     整文件回替=补 ~41GB 量化档新件+弃本地化=倒退),仅打印一条 SKIP 说明;
  ③ 自研件 oldStr→newStr 精确替换(6 件;python 读改写,UTF-8 无 BOM,不动
     steps/shift/sampler/SolAttn/BlockCache/TAEH3/双轨结构——只换文件名串);
  ④ 全部改动件 json.load 验证(逐件即时验证+全量复验);
  ⑤ 旧件 mv 入引擎家根层备份目录并写台账 h3_upgrade_1014.manifest.jsonl。

与通用脚本模板的两处偏差(均以已批方案为准;主流程如需改道见 --backup-dir):
  偏差① 备份目录 = <引擎家>/模型备份.已升级-h3-2026-10-14/(方案原文「与
        workflows.已并入-* 同层、在 models 树外」;2026-10-15 实核引擎家根层
        该封存件已不在场——同层参照仅存方案引文,属性不变=引擎家根层+models
        树外),而非模板写的 models/_backup_h3_upgrade_1014/。
        依据(2026-10-15 实读引擎本体 <引擎家>/ComfyUI/folder_paths.py):
        :416-417 recursive_search 用 os.walk 递归扫描模型目录,排除名单只有
        ".git"(:478)——models 树内任何子目录(含 _backup_*)里的 .safetensors
        都会被重新列入模型清单,违背方案「避免引擎递归扫描重新入列」的清理
        目的。mv 同卷转移不删数据;外置卷 /Volumes/郑冰津/AI/H3/loras/ 尚有
        同件双验副本,备份非唯一副本。
  偏差② --execute 默认止步于④,不含⑤。依据:方案强约束 ⑤ 之前必经
        「③引擎刷新模型列表后固定线试跑一镜,确认 v1.2 可载入观感可用」人工闸
        (「试跑复判是必经闸」)。试跑通过后以 --execute --finalize-backup 收口⑤。

沙箱注意(方案 notes):引擎家中文路径在沙箱下有可见性漂移前科;脚本对引擎家
路径的缺失类失败会附沙箱复核提示。8step v1.0 主件与其 .metadata 桩、dmad、
VAE、文本编码器等其余模型件按方案 skips 零触碰。

审读加固(2026-10-15 二轮,逐条对应审读意见):
  - ③换名改「先验证后落盘 + tmp+os.replace 原子写(保 mode)+ 从盘回读复核,
    失败原子回滚」——写坏 JSON 窗口归零(审读意见 1);
  - ①下载 URL 钉 commit(见 H3_REPO_COMMIT 注释)——消除「续传间上游换内容
    而总长恰不变 → -C - 拼出混合件」的理论洞(审读意见 2);
  - curl rc=33(Range 不被支持)归入可续传 exit 2(审读意见 3);
  - --execute 加单实例锁(引擎家 .h3_upgrade_1014.lock,陈旧锁按 pid 失活
    接管)——防并发双写与台账重复行(审读意见 4);
  - sandbox_note 改 is_relative_to 判前缀、--backup-dir help 标明相对路径按
    CWD 解析(审读意见 6 纯文案)。

审读加固(2026-10-15 三轮,交付前自查):
  - curl 回归任务书原样旗标集 -L --fail -C -(去掉外加的 --retry 3:retry×
    断点续传组合语义未经证实,exit 2 重跑本身就是任务书设计的续传重试路径;
    -sS/--connect-timeout 保留为运维参数,不改语义);
  - 方案 skips 十项(决策面零动清单)以 SKIP item skip:N 行入 stdout,承
    skips#6「本 skip 即题目要求的『说明』路径」——dry-run 与 execute 同步
    打印,看板可完整消费决策记录;
  - 交付前事实锚复核:六件出现次数 rg --count-matches={2,2,2,2,2,1}
    (960P直出件两处命中同在单行——rg -c 行数口径 1 即方案 notes 记法);
    钉 commit URL 实测 HEAD 302→200、content-length=1,956,193,000、
    x-repo-commit 与钉值一致;v1.2 目标件在 models/loras 缺席(将全新下载)。

审读加固(2026-10-15 四轮,主流程首跑实录修复):
  - 首跑 curl rc=92(HTTP/2 stream CANCEL)被旧瞬时集漏判 → 误 exit 1。修:
    92 与 16(h2 帧层)入 CURL_TRANSIENT_RC;瞬时中断改为脚本内重调 curl
    续传(CURL_ATTEMPTS=5,每次独立进程、断点由 -C - 重新 stat 重算——首跑
    断点 15,733,319B 落盘保留已实证),穷尽后 PENDING + exit 2 交还门禁
    重跑。依旧不用 curl 内部 --retry(其「瞬时」定义不含连接层中断,且
    retry×续传组合语义未证)。

用法(务必绝对路径调用,或 CWD=仓库根;2026-10-15 干跑事故实录:门禁以相对路径
调用且 shell CWD 停在 apps/backend/engines/comfyui/workflows/,Python 加载前即
Errno 2。脚本内部仓库根按 __file__ 绝对推导、引擎家为绝对常量,找到脚本后与
CWD 无关,但相对路径寻址脚本本身依赖 CWD):
    python3 /Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/h3_upgrade_1014.py --dry-run
    python3 /Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/h3_upgrade_1014.py --execute
    python3 /Users/zhengbingjin/Project/Github/MYStudio/apps/build/scripts/h3_upgrade_1014.py --execute --finalize-backup

退出码: 0=所请求阶段全部完成; 2=下载未完(断点已保留,重跑即续传); 1=错误/自检失败。
stdout 逐行输出 DONE/SKIP/PENDING/FAIL item ... 供看板消费。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

SCRIPT_NAME = "h3_upgrade_1014.py"
SCRIPT_PATH = Path(__file__).resolve()  # 自荐命令一律绝对路径,避免 CWD 依赖

# ── 常量(已批方案 2026-10-14)─────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[3]  # apps/build/scripts/ → 仓库根

ENGINE_HOME_DEFAULT = Path(
    "/Users/zhengbingjin/Library/Application Support/漫影工作室/comfyui"
)

# 偏差①:见模块 docstring。默认=方案裁定目录;--backup-dir 可覆盖。
BACKUP_DIR_NAME = "模型备份.已升级-h3-2026-10-14"
MANIFEST_NAME = "h3_upgrade_1014.manifest.jsonl"

# 单实例锁(审读加固 4):仅 --execute 取锁;dry-run 零副作用不取。
LOCK_NAME = ".h3_upgrade_1014.lock"

OLD_LORA = (
    "minimax_h3_fl2v_turbo_4step_v1.1_768p_comfyui_resized_avg_rank_28_bf16.safetensors"
)
NEW_LORA = "minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors"

# URL 钉 commit(审读加固 2):方案原文为 resolve/main 浮动版本;钉定 commit
# 消除「两次续传间上游换内容而总长恰不变 → -C - 拼出混合件可通过字节核」的理论洞。
# commit=3ec17a324ced54151364f24f8b5fb6bf7e26414f 取自 2026-10-15 对原文 URL 的
# HEAD 实测响应头 x-repo-commit,钉定 URL 已实测 302→200、content-length 恰等
# 1,956,193,000。若上游改史致该 commit 404,curl 按 rc=22 → exit 1 如实报错,
# 人工重新核验后再钉新 commit。
H3_REPO_COMMIT = "3ec17a324ced54151364f24f8b5fb6bf7e26414f"

DOWNLOADS = [
    {
        "id": "lora-fl2v-turbo-4step-v1.2-768p-comfyui-bf16",
        "url": (
            f"https://huggingface.co/lightx2v/Minimax-h3-Turbo/resolve/{H3_REPO_COMMIT}/"
            "minimax_h3_fl2v_turbo_4step_v1.2_768p_comfyui_bf16.safetensors"
        ),
        "dest_rel": f"models/loras/{NEW_LORA}",
        "size_bytes": 1_956_193_000,
    },
]

# 官方模板整文件替代:本役零项(方案 skips#6 否决)。保留空表以显式标注该
# 步骤在方案序列中的位置,执行时打印一条 SKIP 说明。
TEMPLATE_REPLACEMENTS: list[dict] = []

# 六件换名(方案 workflowEdits 顺序)。plan_count=2026-10-15 本仓「出现次数」实测
# (rg -o|wc -l,与 python str.count 同口径)= {2,2,2,2,2,1}。
# 注意:方案 notes 盘点 {2,2,1,2,2,1} 是 rg -c 的「命中行数」口径——960P直出件为
# 单行压缩 JSON,两处命中同在一行(方案 notes「960P 件单行」即指此),替换作用域
# 必须按出现次数计。自检口径=old+new 出现次数守恒于该值。
EDIT_SPECS = [
    {
        "id": "edit:1",
        "rel": "apps/frontend/lib/assist/image-studio/h3-shot-template.json",
        "plan_count": 2,
    },
    {
        "id": "edit:2",
        "rel": (
            "apps/backend/engines/comfyui/workflows/2_视频/H3视频/"
            "2_固定线/社区-480P生成-SolAttn加速-480P直出.json"
        ),
        "plan_count": 2,
    },
    {
        "id": "edit:3",
        "rel": (
            "apps/backend/engines/comfyui/workflows/2_视频/H3视频/"
            "2_固定线/社区-480P生成-960P精修-SolAttn加速-960P直出.json"
        ),
        "plan_count": 2,
    },
    {
        "id": "edit:4",
        "rel": (
            "apps/backend/engines/comfyui/workflows/2_视频/H3视频/"
            "6_社区模板/社区-480P生成-潜空间放大到960P.json"
        ),
        "plan_count": 2,
    },
    {
        "id": "edit:5",
        "rel": (
            "apps/backend/engines/comfyui/workflows/2_视频/H3视频/"
            "6_社区模板/社区-480P生成-960P精修-SolAttn加速-SeedVR2超分2K.json"
        ),
        "plan_count": 2,
    },
    {
        "id": "edit:6",
        "rel": (
            "apps/backend/engines/comfyui/workflows/2_视频/H3视频/"
            "6_社区模板/社区-TTS-语音生成-480P.json"
        ),
        "plan_count": 1,
    },
]

# curl 返回码分类:瞬时/可续传 → 脚本内重调续传,穷尽后退出码 2;其余非零 → 退出码 1。
# 16=HTTP/2 帧层错 18=传输部分完成 28=超时 33=Range 不被支持(链路剥头;重跑仍从
# 断点尝试,审读加固 3)35=SSL握手 52=空回复 55=发送失败 56=接收失败
# 92=HTTP/2 流未净关(CANCEL)——2026-10-15 主流程首跑实录:HF CDN 大件传输中
# h2 流被 CANCEL,断点 15,733,319B 落盘保留,属传输层瞬时中断而非硬错误。
CURL_TRANSIENT_RC = {16, 18, 28, 33, 35, 52, 55, 56, 92}

# 单件下载的 curl 进程调用尝试上限:每次重调都是独立 curl 进程,断点由 -C - 对
# 落盘文件重新 stat 重算(该续传路径已实证;不采用 curl 内部 --retry——其「瞬时」
# 定义不含连接层中断,且 retry×续传组合语义未证);穷尽后 PENDING + exit 2,
# 由门禁重跑脚本继续收敛。
CURL_ATTEMPTS = 5

SANDBOX_HINT = (
    "引擎家中文路径在沙箱下有可见性漂移前科(方案 notes):"
    "若本脚本运行于沙箱且此处报缺失,请先在非沙箱终端复核该路径确实不存在后再处置"
)


class Ctx:
    """运行期路径上下文(支持 --engine-home / --backup-dir 覆盖)。"""

    def __init__(self, engine_home: Path, backup_dir: Path) -> None:
        self.engine_home = engine_home
        self.backup_dir = backup_dir
        self.manifest_path = backup_dir / MANIFEST_NAME


def cleanup_specs(ctx: Ctx) -> list[tuple[Path, Path, str]]:
    """旧件 mv 清单(方案 cleanups):src, dst, reason。"""
    return [
        (
            ctx.engine_home / "models/loras" / OLD_LORA,
            ctx.backup_dir / OLD_LORA,
            "v1.1 rank-28 压缩件,被 v1.2 全量件确证替代(6 绑定件全部换名)",
        ),
        (
            ctx.engine_home
            / "models/loras/.cache/huggingface/download"
            / (OLD_LORA + ".metadata"),
            ctx.backup_dir / (OLD_LORA + ".metadata"),
            "上件的 HF 下载缓存桩(124B),随主件一并备份;8step 侧缓存桩保留不动"
            "(2026-10-15 实核该桩为 ..._8step_v1.0_..._rank_21_ 变体名,不在本清单)",
        ),
    ]


# 方案 skips 十项(决策面零动清单,2026-10-15 三轮加入 stdout:承 skips#6
# 「本 skip 即题目要求的『说明』路径」——dry-run 与 execute 均打印供看板消费)。
DECISION_SKIPS: list[tuple[str, str]] = [
    (
        "8step v1.0 LoRA(minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors)",
        "本地 1,956,193,000B 与上游 lightx2v 同名件逐字节同尺寸=已是最新;"
        "仓库 11 件绑定全部继续有效,零动零下载",
    ),
    (
        "dmad critic LoRA(dmad_minimax_h3_4step_full_critic_comfyui_bf16.safetensors)",
        "遵既定裁定不动;上游无 _bf16 后缀同名件(上游同名去后缀件=1,956,195,976B,"
        "名与字节均异),不做对齐;库内单镜样片 dmad×2 绑定随此裁定一并冻结",
    ),
    (
        "fl2va 底座(minimax_h3_fl2va_pruned_bf16.safetensors)",
        "与上游 Comfy-Org 同名件 40,225,724,176B 一致无新版;上游 int8_convrot/"
        "fp8_scaled/w6a8 量化档位切换按「量化档位默认不动」不引入"
        "(convrot 另需 pytorch cu130,本机 darwin 不适用)",
    ),
    (
        "VAE 三件(minimax_h3_audio_vae_fp32 / minimax_h3_video_vae_fp16 / vae_approx/taeh3)",
        "audio fp32 605,254,808B / video fp16 5,207,808,496B 与上游同名件逐字节"
        "同尺寸无更新;taeh3 无上游对应件;零动",
    ),
    (
        "文本编码器三件(Qwen3-VL-32B-Ultra-Heretic Q4_K_M.gguf / mmproj-f16 / "
        "qwen3vl_8b_bf16_heretic)",
        "本地为本机 GGUF 重组线(CLIPLoaderGGUF 路线);官方 bf16/int8_convrot/"
        "nvfp4_awq 为异形态大件,引入即改文本编码器形态与显存足迹=行为面变更,保守不动",
    ),
    (
        "官方本地模板两件整文件官方替代(官方本地-T2V-480P.json / 官方本地-I2V-480P.json "
        "← Comfy-Org video_minimax_h3_t2v/i2v.json)",
        "官方替代经实拉核验后否决:官方 t2v/i2v 引用 pruned_int8_convrot×12+"
        "video_vae_int8_convrot×12+nvfp4_awq×12(CLIPLoader)+4step_v1.0 LoRA×4+"
        "风格 embedding×2,均本机缺席且 convrot 本机跑不了;本地件已是官方模板的"
        "本机本地化衍生(GGUF 编码器+video_vae_fp16+pruned_bf16 指纹保留),"
        "整文件回替=补 ~41GB 量化档新件+弃本地化=倒退;ModelTC lightx2v_turbo 同因;"
        "本 skip 即题目要求的「说明」路径",
    ),
    (
        "H3-文生视频-480p.json / H3-首尾帧运镜版.json",
        "前者与官方本地-T2V-480P 同域 T2V 且 GGUF+8step+pruned_bf16 本机绑定全有效,"
        "官方 t2v 已由本地化件承接;后者官方无同款本地图(唯一 FLF=api_minimax_h3_flf2v.json"
        " 云端 API 格式,官方 i2v_continuation 为续接非首尾帧运镜),均保留现状",
    ),
    (
        "ref2v 全线(官方本地-R2V-480P-需解冻结ref2va.json + h3-shot-template-ref2va.json "
        "+ 上游 ref2v/ref2va 系新件)",
        "遵裁定「底座 ref2va 权重已删整线冻结」:R2V 件名自带需解冻标记且绑定件本地"
        "全缺席;ref2va 模板零 LoRA 绑定无需换名;上游 ref2v turbo LoRA 新件不下载",
    ),
    (
        "上游其余新件(Kijai 压缩线/taomate 3step/风格 embeddings×11/fun-controlnet×4/"
        "FastH3 模板/api 云端模板×6/lightx2v v1.1 fp8 融合全模)",
        "无本地现役绑定,宁缺毋滥不引入;v1.1 fp8 融合版(34GB)系整模替换非 LoRA 升级,"
        "超保守面",
    ),
    (
        "KB 文档三件(LoRA库存台账.md / 档案/DMAD-4步LoRA转制与单镜线换档-1003.md / "
        "漫影工作流清单.md)",
        "台账活文档 #22 翻转与 v1.2 补登行涉最后核账日/前账链/docs_freshness_lint 机器门,"
        "按仓库 KB 落账惯例由执行役随提交另落(非纯字符串替换);档案件按"
        "「历史台账不改写」纪律原文保留",
    ),
]


# ── 通用小件 ──────────────────────────────────────────────────────────────

COUNTS: dict[str, int] = {"DONE": 0, "SKIP": 0, "PENDING": 0, "FAIL": 0}


def emit(kind: str, item: str, detail: str = "") -> None:
    COUNTS[kind] = COUNTS.get(kind, 0) + 1
    print(f"{kind} item {item} | {detail}", flush=True)


def note(msg: str) -> None:
    print(msg, flush=True)


def finish(code: int) -> "None":
    print(
        f"SUMMARY done={COUNTS['DONE']} skip={COUNTS['SKIP']} "
        f"pending={COUNTS['PENDING']} fail={COUNTS['FAIL']} exit={code}",
        flush=True,
    )
    sys.exit(code)


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def md5_file(path: Path, chunk: int = 1 << 23) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def atomic_write(path: Path, data: bytes) -> None:
    """同目录 tmp 写入 + fsync + os.replace 原子替换;保留原 mode;异常清 tmp。

    审读加固 1:消除 write_bytes 直覆写的「进程恰在写入中途死 → 留截断 JSON」
    窗口——对读者而言替换要么未发生(原件完好)要么已完整(新件整版)。
    """
    tmp = path.with_name(path.name + ".h3_upgrade_1014.tmp")
    try:
        mode = stat.S_IMODE(os.stat(path).st_mode)
    except FileNotFoundError:
        mode = None
    try:
        with open(tmp, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        if mode is not None:
            os.chmod(tmp, mode)
        os.replace(tmp, path)
    finally:
        if tmp.exists():  # 成功 replace 后 tmp 已不存在;失败则清残件
            try:
                tmp.unlink()
            except OSError:
                pass


def _pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True  # 在跑但属其他用户
    except OSError:
        return False
    return True


def acquire_lock(engine_home: Path) -> Path:
    """单实例锁(审读加固 4):O_EXCL 原子建锁;陈旧锁按 pid 失活判定接管。"""
    if not engine_home.is_dir():
        emit("FAIL", "concurrency-lock",
             f"引擎家缺席,无法落锁 {engine_home} "
             f"{sandbox_note(engine_home, engine_home)}")
        finish(1)
    lock = engine_home / LOCK_NAME
    for _attempt in (1, 2):
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            holder: object = None
            try:
                holder = json.loads(lock.read_text(encoding="utf-8"))
            except Exception:
                pass
            pid = holder.get("pid") if isinstance(holder, dict) else None
            if isinstance(pid, int) and not _pid_alive(pid):
                note(f"[锁] 陈旧锁(holder pid={pid} 已退出),移除后重取:{lock}")
                try:
                    lock.unlink()
                except OSError:
                    pass
                continue
            emit("FAIL", "concurrency-lock",
                 f"另一实例疑似在跑(holder={holder if isinstance(holder, dict) else '不可读'}"
                 f" @ {lock});并发双写与台账重复行风险,拒绝并发"
                 f"(确认无并发后可人工删锁重跑)")
            finish(1)
        else:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump({"pid": os.getpid(), "ts": now_iso(), "actor": SCRIPT_NAME},
                          f, ensure_ascii=False)
            note(f"[锁] 单实例锁已建立: {lock} (pid={os.getpid()})")
            return lock
    emit("FAIL", "concurrency-lock", "两次取锁未成,放弃执行")
    finish(1)


def release_lock(lock: Path) -> None:
    try:
        lock.unlink()
    except OSError:
        pass


def manifest_append(ctx: Ctx, record: dict) -> None:
    """台账逐行追加(时间/动作/路径/md5;append-only,幂等重跑不重复记账)。"""
    ctx.backup_dir.mkdir(parents=True, exist_ok=True)
    with open(ctx.manifest_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
        f.flush()
    note(f"[台账] +1 行 → {ctx.manifest_path}")


def manifest_line_count(path: Path) -> int:
    if not path.is_file():
        return 0
    with open(path, "r", encoding="utf-8") as f:
        return sum(1 for _ in f)


def disk_free_bytes(path: Path) -> int:
    st = os.statvfs(str(path))
    return st.f_bavail * st.f_frsize


def sandbox_note(path: Path, engine_home: Path | None = None) -> str:
    home = engine_home or ENGINE_HOME_DEFAULT
    try:
        under = path.is_relative_to(home)  # 审读加固 6:精确前缀,防同前缀兄弟目录误报
    except (TypeError, ValueError):
        under = False
    if under and not path.exists():
        return f"({SANDBOX_HINT})"
    return ""


def head_url(url: str, timeout: float = 30.0):
    """HEAD 探活;返回 (status, headers, final_url)。URLError 由调用方捕获。"""
    req = urllib.request.Request(
        url, method="HEAD", headers={"User-Agent": "MYStudio-h3-upgrade-1014/1.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.headers, resp.geturl()
    except urllib.error.HTTPError as e:  # 4xx/5xx
        return e.code, (e.headers or {}), url


def banner(ctx: Ctx, mode: str, finalize: bool) -> None:
    print("=" * 78, flush=True)
    print(f"{SCRIPT_NAME} {mode}", flush=True)
    print(f"  仓库根     : {REPO_ROOT}", flush=True)
    print(f"  引擎家     : {ctx.engine_home}", flush=True)
    print(f"  备份目录   : {ctx.backup_dir}  (方案裁定:models 树外,偏差①)", flush=True)
    print(f"  台账       : {ctx.manifest_path}", flush=True)
    print(f"  换名       : {OLD_LORA}", flush=True)
    print(f"           → {NEW_LORA}", flush=True)
    print(f"  下载核定   : {DOWNLOADS[0]['size_bytes']:,} B(方案口径,落盘字节恰等)", flush=True)
    if mode.startswith("--execute"):
        print(
            "  备份收口   : "
            + ("--finalize-backup 已给定(操作者确认试跑闸已通过)" if finalize else
               "未收口——方案强约束③试跑闸后才可 --finalize-backup(偏差②)"),
            flush=True,
        )
    print("=" * 78, flush=True)


# ── 编辑件评估(dry-run 与 execute 共用)──────────────────────────────────


def eval_edit(spec: dict) -> dict:
    p = REPO_ROOT / spec["rel"]
    if not p.is_file():
        return {"state": "missing", "path": p}
    raw = p.read_bytes()
    ev = {
        "state": "ok",
        "path": p,
        "raw": raw,
        "bom": raw.startswith(b"\xef\xbb\xbf"),
        "old": 0,
        "new": 0,
        "plan": spec["plan_count"],
    }
    try:
        text = raw.decode("utf-8")  # 严格 UTF-8
    except UnicodeDecodeError as e:
        return {"state": "not-utf8", "path": p, "err": str(e)}
    ev["old"] = text.count(OLD_LORA)
    ev["new"] = text.count(NEW_LORA)

    if ev["bom"]:
        ev["state"] = "bom"
    elif ev["old"] == 0 and ev["new"] == ev["plan"]:
        ev["state"] = "migrated"  # 已迁移(幂等 SKIP)
    elif ev["old"] >= 1 and ev["old"] + ev["new"] == ev["plan"]:
        ev["state"] = "pending"  # 待替换(含部分替换中间态,续跑收敛)
    elif ev["old"] == 0 and ev["new"] == 0:
        ev["state"] = "zero"  # 新旧双零=文件漂移
    else:
        ev["state"] = "drift"  # 计数不守恒=文件漂移
    return ev


def classify_detail(ev: dict) -> str:
    return f"old×{ev['old']} new×{ev['new']} 方案盘点={ev['plan']}"


# ── dry-run:只打印将做的事 + 自检,零改动 ─────────────────────────────────


def run_dry(ctx: Ctx) -> None:
    banner(ctx, "--dry-run(零改动)", False)
    fails: list[str] = []

    def check(name: str, ok: bool, detail: str) -> None:
        print(f"CHECK {name} | {'PASS' if ok else 'FAIL'} | {detail}", flush=True)
        if not ok:
            fails.append(name)

    note("")
    note("── 将做的事(按方案执行顺序)──")
    for d in DOWNLOADS:
        dest = ctx.engine_home / d["dest_rel"]
        expected = d["size_bytes"]
        cur = dest.stat().st_size if dest.exists() else 0
        if cur == expected:
            note(f"[plan] ① 下载 {d['id']}:目标已完整 {expected:,}B → SKIP(零下载)")
        elif cur > expected:
            note(f"[plan] ① 下载 {d['id']}:本地 {cur:,}B 超核定 → 将报错退出(不自动处置)")
        else:
            way = "全新下载" if cur == 0 else f"断点续传({cur:,}B → {expected:,}B)"
            note(f"[plan] ① 下载 {d['id']}:{way} → {dest}")
    note("[plan] ② 官方模板整文件替代:0 项(方案 skips#6 否决)→ SKIP")
    for spec in EDIT_SPECS:
        ev = eval_edit(spec)
        if ev["state"] == "pending":
            extra = " (含部分替换中间态,续跑收敛)" if ev["new"] else ""
            note(f"[plan] ③ {spec['id']} 精确替换 {ev['path'].name}:{classify_detail(ev)}"
                 f" → 替换 {ev['old']} 处{extra}")
        elif ev["state"] == "migrated":
            note(f"[plan] ③ {spec['id']} {ev['path'].name}:已迁移 → SKIP")
        else:
            note(f"[plan] ③ {spec['id']} {ev['path'].name}:状态 {ev['state']} → 将报错退出")
    note("[plan] ④ 全部改动件 json.load 验证(6 件,逐件即时+全量复验)")
    for i, (src, dst, _reason) in enumerate(cleanup_specs(ctx), 1):
        if src.exists():
            note(f"[plan] ⑤ backup:{i} mv {src} → {dst}(同卷 rename,不删数据)")
        elif dst.exists():
            note(f"[plan] ⑤ backup:{i} 已备份 → SKIP")
        else:
            note(f"[plan] ⑤ backup:{i} 源与备份双缺席 → 将报错退出 {sandbox_note(src)}")
    note(f"[plan] ⑤ 台账追加 {ctx.manifest_path}(时间/动作/路径/md5)")
    note("[plan] ⑤ 前置闸:固定线试跑一镜确认 v1.2 可载入观感可用(--finalize-backup 收口)")

    note("")
    note("── 自检 ──")
    # 1) 工具链
    check("tools:curl", shutil.which("curl") is not None,
          f"curl={'在位' if shutil.which('curl') else '缺席'}")
    # 2) 引擎家与关键路径
    check("engine-home", ctx.engine_home.is_dir(),
          f"{ctx.engine_home} {'在位' if ctx.engine_home.is_dir() else '缺席'} "
          f"{sandbox_note(ctx.engine_home, ctx.engine_home)}")
    loras_dir = ctx.engine_home / "models/loras"
    check("loras-dir", loras_dir.is_dir(),
          f"{loras_dir} {'在位' if loras_dir.is_dir() else '缺席'} "
          f"{sandbox_note(loras_dir, ctx.engine_home)}")
    for i, (src, _dst, _reason) in enumerate(cleanup_specs(ctx), 1):
        check(f"cleanup:{i}:src", src.exists(),
              f"{src} {'在位' if src.exists() else '缺席'} {sandbox_note(src, ctx.engine_home)}")
    # 3) oldStr 存在且计数符合方案盘点(任务书「存在且唯一」的方案面口径)
    for spec in EDIT_SPECS:
        ev = eval_edit(spec)
        ok = ev["state"] in ("pending", "migrated")
        detail = {
            "missing": "目标文件缺席",
            "not-utf8": f"非严格 UTF-8:{ev.get('err')}",
            "bom": "文件带 BOM(方案面=无 BOM)",
            "zero": "新旧双零(文件漂移)",
            "drift": f"计数不守恒 {classify_detail(ev)}",
            "pending": f"{classify_detail(ev)} → 待替换",
            "migrated": f"已迁移 {classify_detail(ev)} → SKIP",
        }[ev["state"]]
        check(f"{spec['id']}:oldStr", ok, f"{ev['path'].name} | {detail}")
        if ev["state"] in ("pending", "migrated"):
            try:
                json.loads(ev["raw"].decode("utf-8"))
                check(f"{spec['id']}:json", True, "当前内容可 json 解析")
            except Exception as e:
                check(f"{spec['id']}:json", False, f"当前内容不可解析:{e}")
    # 4) 磁盘空间(下载需求按目标缺口计;备份为同卷 mv 不新增占用)
    d0 = DOWNLOADS[0]
    dest = ctx.engine_home / d0["dest_rel"]
    cur = dest.stat().st_size if dest.exists() else 0
    need = max(0, d0["size_bytes"] - cur) + (64 << 20)  # 64MiB 裕量
    if loras_dir.is_dir():
        free = disk_free_bytes(loras_dir)
        check("disk-space", free >= need,
              f"盘余 {free:,}B vs 需求 {need:,}B(下载缺口+64MiB 裕量)")
    else:
        check("disk-space", False, "loras 目录缺席,无法测盘")
    # 5) URL 可达 HEAD + 长度比对
    try:
        status, headers, final_url = head_url(d0["url"])
        ok_status = status < 400
        length_hdr = headers.get("Content-Length") if hasattr(headers, "get") else None
        if length_hdr and str(length_hdr).isdigit() and int(length_hdr) > 0:
            ok_len = int(length_hdr) == d0["size_bytes"]
            check("url-head", ok_status and ok_len,
                  f"HEAD 终态={status} content-length={int(length_hdr):,}B "
                  f"(核定 {d0['size_bytes']:,}B) → {final_url.split('/')[2]}")
        else:
            check("url-head", ok_status,
                  f"HEAD 终态={status} 长度头缺席(跳过字节比对;执行段仍有落盘硬校验)")
    except Exception as e:
        check("url-head", False, f"不可达:{e}(沙箱网络受限时请非沙箱复核)")
    # 6) 备份目录现状
    check("backup-dir", not ctx.backup_dir.exists() or ctx.backup_dir.is_dir(),
          f"{'已存在' if ctx.backup_dir.exists() else '不存在(执行⑤时创建)'}"
          f";父层可写={os.access(ctx.engine_home, os.W_OK) if ctx.engine_home.is_dir() else '未知(引擎家缺席)'}")

    note("")
    note("── 方案 skips 决策面零动清单(十项)──")
    stage_decisions()

    note("")
    detail = "" if not fails else " → " + ", ".join(fails)
    note(f"SELF-CHECK SUMMARY {'ALL-PASS' if not fails else 'HAS-FAIL'} fail={len(fails)}{detail}")
    finish(0 if not fails else 1)


# ── execute 各阶段 ────────────────────────────────────────────────────────


def stage_download(ctx: Ctx) -> None:
    """① curl -L --fail -C - 断点续传 + 字节核对;瞬时中断 → exit 2。"""
    for d in DOWNLOADS:
        item = f"download:{d['id']}"
        dest = ctx.engine_home / d["dest_rel"]
        expected = d["size_bytes"]
        if not dest.parent.is_dir():
            emit("FAIL", item,
                 f"loras 目录缺席 {dest.parent} {sandbox_note(dest.parent, ctx.engine_home)}")
            finish(1)
        cur = dest.stat().st_size if dest.exists() else 0
        if cur == expected:
            emit("SKIP", item, f"目标已完整 {expected:,}B(字节口径恰等),零下载")
            continue
        if cur > expected:
            emit("FAIL", item,
                 f"本地 {cur:,}B 超过方案核定 {expected:,}B(疑似上游漂移),不自动处置")
            finish(1)
        need = expected - cur
        free = disk_free_bytes(dest.parent)
        if free < need + (64 << 20):
            emit("FAIL", item, f"盘余 {free:,}B 不足以容纳 {need:,}B(+64MiB 裕量)")
            finish(1)
        note(f"[do] curl -L --fail -C - {'续传' if cur else '下载'} {need:,}B → {dest}")
        # 旗标集=任务书原样 curl -L --fail -C -;-sS/--connect-timeout 为运维参数;
        # 不加 --retry:retry×续传组合语义未经证实。四轮(2026-10-15 主流程首跑
        # 实录 curl rc=92):瞬时中断改为脚本内重调 curl——每次重调是独立进程,
        # 断点由 -C - 对落盘文件重新 stat 重算(已实证);穷尽 CURL_ATTEMPTS 次
        # 后按任务书契约 PENDING + exit 2 交还门禁重跑。
        rc = 1
        for attempt in range(1, CURL_ATTEMPTS + 1):
            rc = subprocess.run(
                [
                    "curl", "-L", "--fail", "-C", "-", "-sS",
                    "--connect-timeout", "20",
                    "-o", str(dest), d["url"],
                ]
            ).returncode
            if rc == 0:
                break
            if rc not in CURL_TRANSIENT_RC:
                break
            have_now = dest.stat().st_size if dest.exists() else 0
            if attempt < CURL_ATTEMPTS:
                note(f"[retry] curl rc={rc}(瞬时中断),尝试 {attempt}/{CURL_ATTEMPTS};"
                     f"断点 {have_now:,}B 已落盘,重调 curl 从断点续传")
                continue
            break
        if rc != 0:
            have_now = dest.stat().st_size if dest.exists() else 0
            if rc in CURL_TRANSIENT_RC:
                emit("PENDING", item,
                     f"curl rc={rc}(传输中断,{CURL_ATTEMPTS} 次尝试未竟),"
                     f"断点 {have_now:,}B 已保留,重跑本脚本即续传")
                finish(2)
            emit("FAIL", item,
                 f"curl rc={rc}(22=HTTP≥400 等非瞬时错误),不作自动处置")
            finish(1)
        final = dest.stat().st_size
        if final != expected:
            emit("FAIL", item,
                 f"curl 报成功但落盘 {final:,}B ≠ 核定 {expected:,}B,停(不删件),人工核上游")
            finish(1)
        digest = md5_file(dest)
        manifest_append(ctx, {
            "ts": now_iso(), "action": "download", "actor": SCRIPT_NAME,
            "path": str(dest), "bytes": final, "md5": digest, "url": d["url"],
        })
        emit("DONE", item, f"下载完成 {final:,}B=核定值 md5={digest}")


def stage_templates() -> None:
    """② 官方模板整文件替代:本役零项(方案 skips#6)。"""
    emit("SKIP", "templates",
         "官方模板整文件替代 0 项(方案 skips#6:Comfy-Org/ModelTC 官方模板经实拉核验后否决,"
         "整文件回替=补 ~41GB 量化档新件+弃本地化=倒退)")


def stage_edits(ctx: Ctx) -> None:
    """③ 六件 oldStr→newStr 精确替换(读改写,UTF-8 无 BOM)+ 逐件即时 json 验证。"""
    for spec in EDIT_SPECS:
        item = spec["id"]
        ev = eval_edit(spec)
        if ev["state"] == "migrated":
            emit("SKIP", item, f"已迁移 {classify_detail(ev)} → {ev['path'].name}")
            continue
        if ev["state"] != "pending":
            detail = {
                "missing": "目标文件缺席",
                "not-utf8": f"非严格 UTF-8:{ev.get('err')}",
                "bom": "文件带 BOM(方案面=无 BOM)",
                "zero": "新旧双零(文件漂移)",
                "drift": f"计数不守恒 {classify_detail(ev)}",
            }[ev["state"]]
            emit("FAIL", item, f"{ev['path'].name} | {detail}")
            finish(1)
        text = ev["raw"].decode("utf-8")
        new_text = text.replace(OLD_LORA, NEW_LORA)
        # 落盘前自证:替换后计数守恒且旧串清零
        if new_text.count(NEW_LORA) != ev["plan"] or OLD_LORA in new_text:
            emit("FAIL", item, f"替换自证未过({classify_detail(ev)})")
            finish(1)
        # 先验证后落盘(审读加固 1):json 解析置于任何磁盘写之前
        try:
            json.loads(new_text)
        except Exception as e:
            emit("FAIL", item, f"替换产物预验证 json 解析失败({e}),未落盘,原件未动")
            finish(1)
        new_bytes = new_text.encode("utf-8")  # 无 BOM
        md5_before = hashlib.md5(ev["raw"]).hexdigest()
        atomic_write(ev["path"], new_bytes)  # 原子替换(tmp+os.replace,保 mode)
        # 从盘重读复核(字节一致 + 再解析)
        try:
            back = ev["path"].read_bytes()
            if back != new_bytes:
                raise ValueError("回读字节与写入不一致")
            json.loads(back.decode("utf-8"))
        except Exception as e:
            atomic_write(ev["path"], ev["raw"])  # 原子回滚为原件
            emit("FAIL", item, f"落盘复核失败({e}),已原子回滚原件")
            finish(1)
        md5_after = hashlib.md5(new_bytes).hexdigest()
        manifest_append(ctx, {
            "ts": now_iso(), "action": "edit", "actor": SCRIPT_NAME,
            "path": str(ev["path"]), "md5": md5_after,
            "md5_before": md5_before, "replacements": ev["old"],
            "old": OLD_LORA, "new": NEW_LORA,
        })
        partial = "(含部分替换中间态收敛)" if ev["new"] else ""
        emit("DONE", item,
             f"替换 {ev['old']} 处{partial} md5 {md5_before[:8]}→{md5_after[:8]} | {ev['path'].name}")


def stage_validate() -> None:
    """④ 全部改动件 json.load 复验(从盘重读,防写入层意外)。"""
    bad: list[str] = []
    for spec in EDIT_SPECS:
        p = REPO_ROOT / spec["rel"]
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            bad.append(f"{p.name}:{e}")
    if bad:
        emit("FAIL", "validate:json", f"复验未过 → {'; '.join(bad)}")
        finish(1)
    emit("DONE", "validate:json", f"{len(EDIT_SPECS)}/{len(EDIT_SPECS)} 改动件 json.load 复验通过")


def stage_decisions() -> None:
    """方案 skips 十项决策面零动清单 → SKIP item skip:N 行(承 skips#6
    「本 skip 即题目要求的『说明』路径」);dry-run 与 execute 均打印。"""
    for i, (what, reason) in enumerate(DECISION_SKIPS, 1):
        emit("SKIP", f"skip:{i}", f"{what} — {reason}")


def stage_backup(ctx: Ctx, finalize: bool) -> None:
    """⑤ 旧件 mv 入备份目录 + 台账;未收口时只打 PENDING 与试跑闸提示。"""
    specs = cleanup_specs(ctx)
    if not finalize:
        for i, (src, dst, _reason) in enumerate(specs, 1):
            if not src.exists() and dst.exists():
                emit("SKIP", f"backup:{i}", f"已备份 → {dst}(本次未要求收口,现状即终态)")
            elif src.exists():
                emit("PENDING", f"backup:{i}", f"待试跑闸后 mv {src} → {dst}")
            else:
                emit("PENDING", f"backup:{i}",
                     f"源与备份双缺席 {src} {sandbox_note(src, ctx.engine_home)}(收口时将报错)")
        note(">>> 方案【执行顺序强约束】③试跑闸未过:旧件仍在原位,未入备份、未写备份台账。")
        note(">>> 待「引擎刷新模型列表后固定线试跑一镜,确认 v1.2 可载入观感可用」通过后,执行:")
        note(f">>>   python3 {SCRIPT_PATH} --execute --finalize-backup")
        return
    ctx.backup_dir.mkdir(parents=True, exist_ok=True)
    for i, (src, dst, reason) in enumerate(specs, 1):
        item = f"backup:{i}"
        s_exists, d_exists = src.exists(), dst.exists()
        if not s_exists and d_exists:
            emit("SKIP", item, f"已备份 → {dst}")
            continue
        if not s_exists and not d_exists:
            emit("FAIL", item,
                 f"源与备份双缺席 {src} {sandbox_note(src, ctx.engine_home)}"
                 f"(半收口态如实失败:重跑幂等,已完成项将 SKIP;若桩被引擎自清,"
                 f"人工核后单独处置)")
            finish(1)
        if s_exists and d_exists:
            emit("FAIL", item, f"源与备份双在场(疑似重复/漂移):{src} & {dst}")
            finish(1)
        if os.stat(src).st_dev != os.stat(ctx.backup_dir).st_dev:
            emit("FAIL", item, "跨卷(方案假定同卷 mv);不作跨卷复制,人工处置")
            finish(1)
        size = src.stat().st_size
        os.rename(src, dst)  # 同卷 rename,等价 mv,不删数据
        digest = md5_file(dst)
        manifest_append(ctx, {
            "ts": now_iso(), "action": "mv-backup", "actor": SCRIPT_NAME,
            "path": str(src), "dest": str(dst), "bytes": size,
            "md5": digest, "reason": reason,
        })
        emit("DONE", item, f"mv 完成 {size:,}B md5={digest} → {dst}")
    emit("DONE", "manifest",
         f"{ctx.manifest_path} 共 {manifest_line_count(ctx.manifest_path)} 行(时间/动作/路径/md5)")


def run_execute(ctx: Ctx, finalize: bool) -> None:
    banner(ctx, "--execute" + (" --finalize-backup" if finalize else ""), finalize)
    lock = acquire_lock(ctx.engine_home)  # 审读加固 4:单实例锁
    try:
        stage_download(ctx)      # ①(瞬时中断 → exit 2)
        stage_templates()        # ②(零项 SKIP)
        stage_edits(ctx)         # ③
        stage_validate()         # ④
        stage_backup(ctx, finalize)  # ⑤(未收口=PENDING+试跑闸提示)
        stage_decisions()        # 方案 skips 十项 → SKIP item skip:N 行
    finally:
        release_lock(lock)  # finish() 内 sys.exit 抛 SystemExit 亦经此释放
    finish(0)


# ── 入口 ──────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> None:
    ap = argparse.ArgumentParser(
        prog=SCRIPT_NAME,
        description="H3 视频 4step LoRA 升级(v1.1 rank-28 → lightx2v v1.2 全量件)幂等脚本;"
                    "详见模块 docstring 中的方案摘要与两处模板偏差说明。",
    )
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--dry-run", action="store_true", help="只打印将做的事并自检,零改动")
    g.add_argument("--execute", action="store_true",
                   help="执行①下载②模板(零项)③换名④JSON验证;不含⑤备份(方案试跑闸)")
    ap.add_argument("--finalize-backup", action="store_true",
                   help="连同⑤旧件入备份+台账一并执行;仅当方案③试跑闸(固定线试跑一镜"
                        "确认 v1.2 可载入观感可用)通过后使用")
    ap.add_argument("--engine-home", default=str(ENGINE_HOME_DEFAULT),
                   help="引擎家路径(默认=方案核定路径)")
    ap.add_argument("--backup-dir", default=None,
                   help="备份目录(默认=方案裁定 <引擎家>/%s;偏差①说明见 docstring;"
                        "相对路径按当前工作目录解析)" % BACKUP_DIR_NAME)
    args = ap.parse_args(argv)

    if args.finalize_backup and not args.execute:
        ap.error("--finalize-backup 仅可与 --execute 同用")

    engine_home = Path(args.engine_home)
    backup_dir = Path(args.backup_dir) if args.backup_dir else engine_home / BACKUP_DIR_NAME
    ctx = Ctx(engine_home, backup_dir)

    if args.dry_run:
        run_dry(ctx)
    else:
        run_execute(ctx, args.finalize_backup)


if __name__ == "__main__":
    main(sys.argv[1:])
