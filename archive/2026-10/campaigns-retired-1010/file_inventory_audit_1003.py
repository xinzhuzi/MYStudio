#!/usr/bin/env python3
"""1003 文件盘点采集器(只读)——Trellis 10-03-file-inventory-cleanup 阶段A.1。

只读采集全仓文件事实,产出:
  .trellis/tasks/10-03-file-inventory-cleanup/research/inventory.json   (全量条目,reason 留空由分区员填)
  .trellis/tasks/10-03-file-inventory-cleanup/research/zone-summary.json (分区摘要+再生区体积)

输入:git ls-files + git status(未跟踪/忽略)+ git 外区遍历(docs 本地忽略区/.trellis/out/.zcode 等)。
每件:大小/mtime/git 状态/SHA-256(>10MB 跳过)/一次性特征(日期命名/头注释役名/exit 哨兵)/末次提交。
两段式引用核查:候选集(zone-1/2/2b/3 全量+zone-4 模式命中件)→ rg -l --fixed-strings -f 批查
(搜索域 apps/docs/.trellis/.github/.agents/.claude/.codex,排除 node_modules/.git/out/.gitnexus/.vite)。
zone-4:名字模式(*bak*/*copy*/*old*/*.tmp/*.orig/*~)+ SHA-256 完全重复,只记命中件。
zone-5:再生目录 du 体积+件数。

本脚本除上述两个 research JSON 外零写入(临时模式文件走系统 /tmp);禁止提交,禁止碰引擎家。
用法:python3 apps/build/scripts/file_inventory_audit_1003.py
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve()
while ROOT != ROOT.parent and not (ROOT / ".git").exists():
    ROOT = ROOT.parent
if not (ROOT / ".git").exists():
    raise SystemExit("未找到仓库根(.git),中止")
os.chdir(ROOT)

TASK_DIR = ".trellis/tasks/10-03-file-inventory-cleanup"
OUT_INV = Path(f"{TASK_DIR}/research/inventory.json")
OUT_SUM = Path(f"{TASK_DIR}/research/zone-summary.json")
# 本脚本的产出自身不作为盘点条目(自引用无意义),在 meta 注明
EXCLUDE_PATHS = {str(OUT_INV), str(OUT_SUM)}

# 在途四役(硬边界:一律绕开)
INFLIGHT_TASKS = [
    "10-01-consistency-lora-eval",
    "10-01-qi21-usetest-batch",
    "10-02-qi21-subgraph-singleport",
    "10-03-action-skill-absorb",
]
# 硬边界点名件:5 个已改动 + 12 个未跟踪(2026-10-03 任务令原文名单)
HARD_INFLIGHT = [
    ".agents/skills/h3-prompt-writing/SKILL.md",
    ".agents/skills/h3-prompt-writing/agents/openai.yaml",
    ".agents/skills/h3-prompt-writing/references/direct-zh.md",
    "apps/backend/engines/comfyui/tests/test_qwen21_workflow_contract.py",
    "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json",
    ".agents/skills/h3-prompt-writing/references/action-en.txt",
    "apps/build/scripts/qi21_505_fix_engine_up_1003.py",
    "apps/build/scripts/qi21_505_fix_loadfire_1003.mjs",
    "apps/build/scripts/qi21_panel_poll_stall_repro_1003.mjs",
    "apps/build/scripts/qi21_singleport_compose_probe_1002.py",
    "apps/build/scripts/qi21_singleport_engine_up_1002.py",
    "apps/build/scripts/qi21_singleport_fire_1002.mjs",
    "apps/build/scripts/qi21_singleport_fire_backfill_1002.mjs",
    "apps/build/scripts/qi21_singleport_loadgraph_1002.mjs",
    "apps/build/scripts/qwen21_sancai_retry_diag_1002.mjs",
    "docs/comfyui-kb/参考_提示词工程/动作电影Skill-2.0.md",
    "docs/comfyui-kb/参考_提示词工程/社区skill归档说明-1003.md",
]

HASH_LIMIT = 10 * 1024 * 1024      # >10MB 跳过 SHA-256
SCAN_LIMIT = 2 * 1024 * 1024       # 内容特征扫描上限 2MB
HITS_CAP = 10                      # 每个被引用名最多存前 10 个命中文件路径(超线控体积,trunc 记余量)
HEAD_BYTES = 4096

TEXT_EXTS = {
    ".py", ".mjs", ".js", ".ts", ".tsx", ".jsx", ".sh", ".bash", ".zsh", ".fish",
    ".md", ".markdown", ".json", ".jsonl", ".yaml", ".yml", ".toml", ".txt",
    ".html", ".css", ".scss", ".xml", ".sql", ".cfg", ".ini", ".env", ".gitignore",
    ".gitattributes", ".editorconfig", ".lock", ".plist", ".gradle", ".properties",
}

RE_DATE_8 = re.compile(r"_(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])(?![0-9])")   # _YYYYMMDD
RE_DATE_4 = re.compile(r"_(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])(?![0-9])")                 # _MMDD
RE_TASKID = re.compile(r"\b\d{2}-\d{2}-[a-z0-9][a-z0-9\-]{2,}\b")                        # 头注释役名
RE_MMDD = re.compile(r"(?<!\d)(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])(?!\d)")                 # 头注释 4 位日期
RE_EXIT_SENTINEL = re.compile(
    rb"(?:sys\.exit|os\._exit|process\.exit|SystemExit)\s*\(\s*2\s*\)|\bEXIT\s*=\s*2\b"
)
RE_NAME_PAT = {  # zone-4 名字模式(词界防 bold→old 误报)
    "bak": re.compile(r"(?<![a-z])bak(?![a-z])"),
    "copy": re.compile(r"(?<![a-z])copy(?![a-z])"),
    "old": re.compile(r"(?<![a-z])old(?![a-z])"),
}
REGEN_NAMES = {"node_modules", ".pytest_cache", "__pycache__", ".ruff_cache", ".vite", ".gitnexus"}

anomalies: list[str] = []
t0 = time.time()


def log(msg: str) -> None:
    print(f"[{time.time() - t0:7.1f}s] {msg}", flush=True)


def run(cmd: list[str], timeout: int = 600) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, timeout=timeout)


def git(args: list[str], timeout: int = 600) -> str:
    r = run(["git", "-c", "core.quotepath=off"] + args, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(f"git {args} 失败: {r.stderr.decode('utf-8', 'replace')[:300]}")
    return r.stdout.decode("utf-8", "replace")


# ---------------------------------------------------------------- 阶段1 git 事实
log("阶段1:git 基础事实")
GIT_HEAD = git(["rev-parse", "HEAD"]).strip()
BRANCH = git(["rev-parse", "--abbrev-ref", "HEAD"]).strip()
tracked_list = [p for p in git(["ls-files", "-z"]).split("\0") if p]
tracked = set(tracked_list)
log(f"  跟踪 {len(tracked)} 件,HEAD={GIT_HEAD[:9]} 分支={BRANCH}")

status_map: dict[str, str] = {}  # path -> 状态(可见未跟踪 ?? / 修改 M 等)
for line in git(["status", "--porcelain=v1", "-uall", "-z"]).split("\0"):
    if not line:
        continue
    xy, path = line[:2], line[3:]
    if "->" in path:
        path = path.split(" -> ")[-1]
    status_map[path] = xy.strip()
visible_untracked = sorted(p for p, s in status_map.items() if s == "??")
modified = sorted(p for p, s in status_map.items() if s != "??")
log(f"  可见未跟踪 {len(visible_untracked)} 件,已改动 {len(modified)} 件")

# 忽略区条目(dirs 压缩形态;文件逐件)
ignored_files: list[str] = []
ignored_dirs: list[str] = []
for line in git(["status", "--porcelain=v1", "--ignored", "-z"]).split("\0"):
    if not line:
        continue
    path = line[3:]
    if line[:2] != "!!":
        continue
    if path.endswith("/") or (ROOT / path).is_dir():
        ignored_dirs.append(path.rstrip("/"))
    else:
        ignored_files.append(path)
log(f"  忽略条目:目录 {len(ignored_dirs)} / 文件 {len(ignored_files)}")

# 末次提交(全史一遍解析,首见即最新)
log("阶段2:git log 末次提交映射(1550 提交)")
last_commit: dict[str, list[str]] = {}
raw = git(["log", "--name-only", "--format=%x00%h%x02%ad", "--date=short"], timeout=300)
for seg in raw.split("\0"):
    if not seg.strip():
        continue
    lines = seg.strip("\n").split("\n")
    head = lines[0]
    if "\x02" not in head:
        continue
    h, d = head.split("\x02", 1)
    for f in lines[1:]:
        f = f.strip()
        if f and f not in last_commit:
            last_commit[f] = [h, d]
log(f"  取得末次提交 {len(last_commit)} 件")

# ---------------------------------------------------------------- 阶段3 条目枚举(分区)
log("阶段3:条目枚举与分区")
entries: dict[str, dict] = {}


def zone_of(path: str, is_tracked: bool, untracked_visible: bool) -> str:
    if path.startswith("apps/build/scripts/"):
        rest = path[len("apps/build/scripts/"):]
        if "/" not in rest:
            return "zone-1"                      # scripts 顶层(跟踪+未跟踪都算,对齐 293 件口径)
        if rest.startswith("campaigns/"):
            return "zone-4"                      # 已归档区,模式扫描即可
        return "zone-4"                          # .zcode 等子目录内的跟踪件归 zone-4
    if path.startswith("docs/"):
        if is_tracked:
            return "zone-2"
        return "zone-2b" if not untracked_visible else "zone-3"  # 可见未跟踪 docs 件归 zone-3(未跟踪桶)
    for pre in (".claude/", ".agents/", ".codex/", ".github/", ".husky/"):
        if path.startswith(pre):
            return "zone-3"
    if not is_tracked:
        return "zone-3"
    return "zone-4"


def add_entry(path: str, zone: str, **kw) -> None:
    if path in EXCLUDE_PATHS or path in entries:
        return
    e = {"path": path, "zone": zone, "reason": ""}
    for k, v in kw.items():
        if v not in (None, 0, False, ""):
            e[k] = v
    entries[path] = e


for p in tracked_list:
    add_entry(p, zone_of(p, True, False), st=status_map.get(p))
for p in visible_untracked:
    add_entry(p, zone_of(p, False, True), st="??")

# docs 磁盘遍历 → 本地忽略区(zone-2b)
docs_untracked_on_disk = []
for dirpath, dirnames, filenames in os.walk("docs"):
    dirnames[:] = sorted(d for d in dirnames if d not in REGEN_NAMES)
    for fn in sorted(filenames):
        fp = f"{dirpath}/{fn}"
        if fp in tracked or fp in entries:
            continue
        docs_untracked_on_disk.append(fp)
ignored_confirm = set()
if docs_untracked_on_disk:
    stdin = "\0".join(docs_untracked_on_disk) + "\0"
    r = subprocess.run(["git", "-c", "core.quotepath=off", "check-ignore", "--stdin", "-z"],
                       input=stdin.encode(), capture_output=True, timeout=120)
    if r.returncode in (0, 1):
        ignored_confirm = {p for p in r.stdout.decode("utf-8", "replace").split("\0") if p}
    else:
        anomalies.append(f"check-ignore 返回码 {r.returncode},docs 本地区忽略判定可能不全")
for fp in docs_untracked_on_disk:
    if fp in ignored_confirm:
        add_entry(fp, "zone-2b", ignored=1)
    else:
        add_entry(fp, "zone-3", ignored=0, st="??")  # 理论上已被 visible_untracked 覆盖

# .trellis / out / .zcode 遍历 → zone-3(git 外)
def walk_external(top: str) -> list[str]:
    out_paths = []
    for dirpath, dirnames, filenames in os.walk(top):
        dirnames[:] = sorted(d for d in dirnames if d not in REGEN_NAMES and d != ".git")
        for fn in sorted(filenames):
            out_paths.append(f"{dirpath}/{fn}")
    return out_paths


def trellis_task_tag(path: str) -> str | None:
    if not path.startswith(".trellis/tasks/"):
        return None
    parts = path.split("/")
    if len(parts) >= 4:
        if parts[2] == "archive":
            return "archive/" + parts[3]
        return parts[2]
    return None


for fp in walk_external(".trellis"):
    add_entry(fp, "zone-3", ignored=1, tt=trellis_task_tag(fp))
for fp in walk_external("out"):
    add_entry(fp, "zone-3", ignored=1)

zcode_dirs = []
r = run(["find", ".", "-name", ".git", "-prune", "-o",
         "(", "-type", "d", "(", "-name", "node_modules", "-o", "-name", ".pytest_cache",
         "-o", "-name", ".ruff_cache", "-o", "-name", ".vite", "-o", "-name", ".gitnexus",
         "-o", "-name", "__pycache__", ")", "-prune", ")",
         "-o", "-type", "d", "-name", ".zcode", "-print"])
zcode_dirs = [p[2:] for p in r.stdout.decode().splitlines() if p.startswith("./")]
for zd in zcode_dirs:
    for fp in walk_external(zd):
        add_entry(fp, "zone-3", ignored=1)
log(f"  .zcode 目录 {len(zcode_dirs)} 处:{zcode_dirs}")

# 根层忽略散文件 → zone-3 逐件(.DS_Store 汇总不逐件)
ds_stores = []
for p in ignored_files:
    if p.endswith(".DS_Store"):
        ds_stores.append(p)
        continue
    if p.startswith(("docs/", ".trellis/", "out/")) or "/.zcode/" in p or p in entries:
        continue
    if p.startswith(".agents/skills/gitnexus/") or p.startswith(".agents/skills/generated/"):
        continue  # 再生区,du 汇总
    add_entry(p, "zone-3", ignored=1)
log(f"  .DS_Store {len(ds_stores)} 件入汇总;条目总数 {len(entries)}")

# ---------------------------------------------------------------- 阶段4 逐件事实
log("阶段4:逐件事实(大小/mtime/哈希/一次性特征)")
hash_index: dict[str, list[str]] = {}
n_hash = n_skip = 0
skip_bytes = 0
missing = []
for i, (path, e) in enumerate(sorted(entries.items())):
    if i % 2000 == 0:
        log(f"  … {i}/{len(entries)}")
    full = ROOT / path
    try:
        st_ = os.lstat(full)
    except OSError as ex:
        e["bytes"] = None
        e["missing"] = 1
        missing.append(path)
        anomalies.append(f"lstat 失败 {path}: {ex}")
        continue
    e["bytes"] = st_.st_size
    e["mtime"] = int(st_.st_mtime)
    if os.path.islink(path):
        e["sha_skip"] = "symlink"
        continue
    if not os.path.exists(full):
        e["missing"] = 1
        missing.append(path)
        continue
    # 名字日期特征(纯文件名,零 IO)
    stem = re.sub(r"\.[^.]{1,12}$", "", os.path.basename(path))
    feats: dict = {}
    m8 = RE_DATE_8.search(stem) or RE_DATE_4.search(stem)
    if m8:
        feats["d"] = m8.group(0)[1:]
    # zone-4 名字模式
    if e["zone"] == "zone-4":
        low = os.path.basename(path).lower()
        pats = [k for k, rex in RE_NAME_PAT.items() if rex.search(low)]
        for suf in (".tmp", ".orig", "~"):
            if low.endswith(suf):
                pats.append(suf.lstrip("."))
        if pats:
            feats["pat"] = pats
    # 内容特征
    if st_.st_size <= SCAN_LIMIT and (
        os.path.splitext(path)[1].lower() in TEXT_EXTS or "." not in os.path.basename(path)
    ):
        try:
            data = full.read_bytes()
        except OSError as ex:
            anomalies.append(f"读失败 {path}: {ex}")
            data = None
        if data is not None:
            if RE_EXIT_SENTINEL.search(data):
                feats["x"] = 1
            head = data[:HEAD_BYTES].decode("utf-8", "replace")
            hints = RE_TASKID.findall(head)
            hints += [t for t in RE_MMDD.findall(head) if t not in hints]
            if hints:
                feats["h"] = list(dict.fromkeys(hints))[:6]
    if feats:
        e["f"] = feats
    elif st_.st_size <= HASH_LIMIT:
        pass  # 大文本不扫内容,只哈希(下面统一)
    # SHA-256(≤10MB)
    if st_.st_size > HASH_LIMIT:
        e["sha_skip"] = "size>10MB"
        n_skip += 1
        skip_bytes += st_.st_size
        continue
    try:
        data = full.read_bytes()
    except OSError as ex:
        anomalies.append(f"读失败(哈希){path}: {ex}")
        continue
    sha = hashlib.sha256(data).hexdigest()
    e["sha256"] = sha
    n_hash += 1
    hash_index.setdefault(sha, []).append(path)
log(f"  哈希 {n_hash} 件,跳过 {n_skip} 件({skip_bytes / 1e6:.1f}MB);缺失 {len(missing)} 件")

# 完全重复组(全仓哈希碰撞组,≥2 件)
dup_groups: dict[str, list[str]] = {}
for sha, paths in hash_index.items():
    if len(paths) >= 2:
        key = sha[:8]
        dup_groups[key] = sorted(paths)
        for p in paths:
            entries[p].setdefault("f", {})
            entries[p]["f"]["dup"] = key
log(f"  SHA-256 完全重复组 {len(dup_groups)} 组,成员 {sum(len(v) for v in dup_groups.values())} 件")
# 清空 f 子字典里的空壳
for path, e in entries.items():
    if not e.get("f"):
        e.pop("f", None)

# 末次提交回填(跟踪件)
n_lc = 0
for path, e in entries.items():
    lc = last_commit.get(path)
    if lc:
        e["lc"] = lc
        n_lc += 1
log(f"  末次提交回填 {n_lc} 件")

# ---------------------------------------------------------------- 阶段5 在途标记
log("阶段5:在途四役标记(绕开)")
inflight_text_parts = []
inflight_paths = set(HARD_INFLIGHT)
root_prefix = str(ROOT) + "/"
for task in INFLIGHT_TASKS:
    tdir = Path(".trellis/tasks") / task  # 相对路径,与条目键一致
    if not tdir.is_dir():
        continue
    for dirpath, _, filenames in os.walk(tdir):
        for fn in filenames:
            fp = f"{dirpath}/{fn}"
            inflight_paths.add(fp)
            try:
                if (ROOT / fp).stat().st_size <= SCAN_LIMIT:
                    inflight_text_parts.append((ROOT / fp).read_bytes())
            except OSError:
                pass
inflight_text = b"\n".join(inflight_text_parts)
# 在途任务档点名的 apps/build/scripts/ 路径(绝对引用剥根前缀)
for m in re.finditer(rb"apps/build/scripts/[\w\-./]+", inflight_text):
    ref = m.group(0).decode("utf-8", "replace").rstrip(".")
    inflight_paths.add(ref)
for m in re.finditer(rb"/Users/[\w\-./]+", inflight_text):
    ref = m.group(0).decode("utf-8", "replace").rstrip(".")
    if ref.startswith(root_prefix):
        inflight_paths.add(ref[len(root_prefix):])
# scripts 顶层件:basename 出现在在途任务档文本中亦视在途被引用(宁枉勿纵,绕开保护)
z1_names = {os.path.basename(p) for p, e in entries.items() if e["zone"] == "zone-1"}
name_hits = {n for n in z1_names if n.encode() in inflight_text}
for path, e in entries.items():
    if e["zone"] == "zone-1" and os.path.basename(path) in name_hits:
        inflight_paths.add(path)
n_ifl = 0
for path in inflight_paths:
    e = entries.get(path)
    if e is not None:
        e["ifl"] = 1
        n_ifl += 1
extra_refs = sorted(p for p in inflight_paths if p not in entries)
log(f"  在途标记 {n_ifl} 件;在途档引用但仓库不存在的路径 {len(extra_refs)} 处")

# ---------------------------------------------------------------- 阶段6 两段式引用核查
log("阶段6:引用核查(rg 批量)")
candidates = [p for p, e in entries.items()
              if e["zone"] in ("zone-1", "zone-2", "zone-2b", "zone-3")
              or (e["zone"] == "zone-4" and (e.get("f", {}).get("pat") or e.get("f", {}).get("dup")))]
patterns = sorted({os.path.basename(p) for p in candidates if os.path.basename(p)})
log(f"  候选 {len(candidates)} 件,唯一引用名 {len(patterns)} 个")

SEARCH_DIRS = [d for d in ["apps", "docs", ".trellis", ".github", ".agents", ".claude", ".codex"]
               if (ROOT / d).exists()]
# 排除自污染:本役两产物 JSON + 盘点脚本自身(其内嵌在途件名单会造成假引用)
SELF_EXCLUDES = ["-g", "!.trellis/tasks/10-03-file-inventory-cleanup/research/inventory.json",
                 "-g", "!.trellis/tasks/10-03-file-inventory-cleanup/research/zone-summary.json",
                 "-g", "!apps/build/scripts/file_inventory_audit_1003.py"]
RG_BASE = ["rg", "-l", "--fixed-strings", "--hidden", "--no-ignore",
           "-g", "!**/node_modules/**", "-g", "!**/.git/**", "-g", "!**/out/**",
           "-g", "!**/.gitnexus/**", "-g", "!**/.vite/**"] + SELF_EXCLUDES

refmap: dict[str, dict] = {}
if patterns:
    fd, tmp = tempfile.mkstemp(prefix="inv_pats_", suffix=".txt", dir="/tmp")
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(patterns) + "\n")
    try:
        r = run(RG_BASE + ["-f", tmp, "--null"] + SEARCH_DIRS, timeout=600)
        if r.returncode not in (0, 1):
            anomalies.append(f"rg pass1 返回码 {r.returncode}: {r.stderr.decode('utf-8', 'replace')[:200]}")
        hit_files = [p for p in r.stdout.decode("utf-8", "replace").split("\0") if p]
        log(f"  pass1:命中文件 {len(hit_files)} 个")
        # pass2:-o 流式映射 file→pattern(二进制件 rg 默认抑制,单补)
        r2 = run(["rg", "-o", "-N", "--with-filename", "--fixed-strings", "--hidden",
                  "--no-ignore", "-g", "!**/node_modules/**", "-g", "!**/.git/**",
                  "-g", "!**/out/**", "-g", "!**/.gitnexus/**", "-g", "!**/.vite/**"] +
                 SELF_EXCLUDES + ["-f", tmp] + SEARCH_DIRS, timeout=600)
        pair = set()
        for line in r2.stdout.decode("utf-8", "replace").splitlines():
            if ":" in line:
                fp, hit = line.split(":", 1)
                pair.add((fp, hit))
        log(f"  pass2:映射对 {len(pair)} 个")
        mapped_files = {fp for fp, _ in pair}
        # 二进制命中未映射件(--text 单补,>300MB 放弃)
        for fp in hit_files:
            if fp in mapped_files:
                continue
            try:
                sz = (ROOT / fp).stat().st_size
            except OSError:
                continue
            if sz > 300 * 1024 * 1024:
                anomalies.append(f"二进制超大未映射命中 {fp} ({sz / 1e6:.0f}MB)")
                continue
            r3 = run(["rg", "-o", "-N", "-a", "--with-filename", "--fixed-strings",
                      "-f", tmp, fp], timeout=300)
            for line in r3.stdout.decode("utf-8", "replace").splitlines():
                if ":" in line:
                    f2, hit = line.split(":", 1)
                    pair.add((f2, hit))
        by_pat: dict[str, list[str]] = {}
        for fp, hit in pair:
            by_pat.setdefault(hit, []).append(fp)
        for pat in patterns:
            hits = sorted(set(by_pat.get(pat, [])))
            if not hits:
                continue
            entry = {"n": len(hits), "hits": hits[:HITS_CAP]}
            if len(hits) > HITS_CAP:
                entry["trunc"] = len(hits) - HITS_CAP
            pre = tuple(f".trellis/tasks/{t}/" for t in INFLIGHT_TASKS)
            if any(h.startswith(pre) for h in hits):
                entry["if"] = 1
            refmap[pat] = entry
        log(f"  refmap {len(refmap)} 名有命中")
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass

# ---------------------------------------------------------------- 阶段7 zone-5 再生区体积
log("阶段7:zone-5 再生区体积盘点")
r = run(["find", ".", "(", "-name", ".git", ")", "-prune", "-o",
         "(", "-type", "d", "(", "-name", "node_modules", "-o", "-name", ".pytest_cache",
         "-o", "-name", ".ruff_cache", "-o", "-name", ".vite", "-o", "-name", ".gitnexus",
         "-o", "-name", "__pycache__", ")", ")", "-prune", "-print"])
regen_dirs = sorted({p[2:] for p in r.stdout.decode().splitlines() if p.startswith("./")})
regen_dirs += [d for d in [".agents/skills/gitnexus", ".agents/skills/generated"] if (ROOT / d).is_dir()]
regen_dirs = sorted(set(regen_dirs))


def du_kb(path: str) -> int:
    r = run(["du", "-sk", path], timeout=300)
    try:
        return int(r.stdout.split()[0])
    except (IndexError, ValueError):
        return -1


def count_files(path: str) -> int:
    n = 0
    for _, _, files in os.walk(path):
        n += len(files)
    return n


zone5 = []
for d in regen_dirs:
    zone5.append({"path": d, "du_kb": du_kb(d), "files": count_files(d), "kind": "regen"})
log(f"  再生目录 {len(zone5)} 行")

# 其余忽略顶层目录汇总(未被上面覆盖、非逐件区)
covered_prefixes = ("docs/", ".trellis/", "out/", ".agents/skills/gitnexus/", ".agents/skills/generated/")
zcode_prefixes = tuple(zd + "/" for zd in zcode_dirs)
regen_set = set(regen_dirs)
other_rows = []
for d in ignored_dirs:
    if d in regen_set or d.startswith(covered_prefixes) or d.startswith(zcode_prefixes):
        continue
    if any(d.startswith(r + "/") for r in regen_set):
        continue
    other_rows.append({"path": d, "du_kb": du_kb(d), "files": count_files(d), "kind": "ignored-top"})
if ds_stores:
    ds_bytes = 0
    ds_present = []
    for p in ds_stores:
        try:
            ds_bytes += os.lstat(p).st_size
            ds_present.append(p)
        except OSError:
            pass
    other_rows.append({"path": "(.DS_Store 散件汇总)", "du_kb": ds_bytes // 1024,
                       "files": len(ds_stores), "kind": "ds-store", "paths": sorted(ds_present)})
log(f"  其余忽略目录 {len(other_rows)} 行")

# ---------------------------------------------------------------- 阶段8 输出
log("阶段8:汇总与写出")
# 并行会话漂移检测(首跑实测:技能收口会话运行中提交 db70fe6,致快照混合)
head_now = git(["rev-parse", "HEAD"]).strip()
tracked_now = [p for p in git(["ls-files", "-z"]).split("\0") if p]
if head_now != GIT_HEAD or len(tracked_now) != len(tracked_list):
    anomalies.append(
        f"运行期间仓库漂移:HEAD {GIT_HEAD[:9]}→{head_now[:9]},跟踪 {len(tracked_list)}→{len(tracked_now)}"
        "(并行会话在提交,本结果为混合快照,树稳定后应重跑)")
if "apps/build/scripts/file_inventory_audit_1003.py" in entries:
    entries["apps/build/scripts/file_inventory_audit_1003.py"]["tt"] = "10-03-file-inventory-cleanup"
files_out = [entries[p] for p in sorted(entries)]
zone_stats: dict[str, dict] = {}
for e in files_out:
    z = zone_stats.setdefault(e["zone"], {"count": 0, "bytes": 0, "untracked": 0, "ignored": 0,
                                          "date_named": 0, "ifl": 0})
    z["count"] += 1
    z["bytes"] += e.get("bytes") or 0
    if e.get("st") == "??":
        z["untracked"] += 1
    if e.get("ignored"):
        z["ignored"] += 1
    if e.get("f", {}).get("d"):
        z["date_named"] += 1
    if e.get("ifl"):
        z["ifl"] += 1

counts = {
    "total": len(files_out),
    "tracked": sum(1 for p in tracked_list if p in entries),
    "untracked_visible": sum(1 for e in files_out if e.get("st") == "??"),
    "git_external": sum(1 for e in files_out if e.get("ignored")),
    "by_zone": {z: s["count"] for z, s in sorted(zone_stats.items())},
}
planning_delta = [
    "跟踪件实况 6286 vs PRD 记 6326(-40,以 git ls-files 实测为准)",
    f"可见未跟踪实况 {len(visible_untracked)} vs PRD 记 12:新增 22 件 .agents 技能文件"
    "(react-vite-best-practices/remotion-best-practices 系/tdd 系,规划期后出现,不在硬边界在途名单,留分区员裁)",
    "apps/build/scripts 顶层实况 357 件(含 9 件未跟踪)vs PRD 记 293",
    "docs 本地忽略区实况 129 件 vs PRD 记 131(差 2=可见未跟踪的 docs 件,归 zone-3)",
    ".trellis 实况 6724 件/2.7GB(archive 研究产物占大头,含大 heapsnapshot,>10MB 跳哈希)",
    "git 外散件实况:AGENTS.md/CLAUDE.md/.claude/settings.local.json 为忽略未跟踪件(规划期未点名)",
    "scripts 顶层 4 件 *.log(1 件 build_mac_tail_0919+3 件 workspace-*)为忽略未跟踪件(非跟踪,PRD『跟踪 *.log=0 件』口径成立),落 zone-3",
    "docs 本地区 128 件(另 docs/comfyui-kb/tools/__pycache__ 落 zone-5 再生区,不计 docs 件数)",
    "采集时点并行技能收口会话已提交 db70fe6(remotion 族 195 件整升入跟踪),22 件原『未跟踪技能件』现已跟踪",
]

meta = {
    "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    "root": str(ROOT),
    "git_head": GIT_HEAD,
    "branch": BRANCH,
    "task": "10-03-file-inventory-cleanup 阶段A.1",
    "schema": {
        "path": "仓库相对路径", "zone": "zone-1 scripts顶层/zone-2 docs跟踪/zone-2b docs本地忽略/zone-3 未跟踪+git外+配置点文件/zone-4 其余跟踪(源代码区)",
        "bytes": "字节;null=缺失", "mtime": "epoch 秒", "tracked": "1=git 跟踪(缺省即跟踪)",
        "ignored": "1=git 忽略区件", "st": "git status(??/M/A/D/R)",
        "sha256": "内容哈希(>10MB 置 sha_skip)", "lc": "[短哈希,日期] 末次提交(跟踪件)",
        "tt": "所属 trellis 任务目录名", "ifl": "1=在途四役关联(绕开档)",
        "f": "一次性特征:d=文件名日期/h=头注释役名或日期/x=exit 短路哨兵/pat=zone-4 名字模式/dup=SHA-256 重复组前 8 位",
        "refmap": "引用核查表:键=文件名,值 n=全仓命中文件数/hits=前 20 路径/if=在途任务档命中;搜索含自引",
        "reason": "判定理由(留空,分区员填)",
    },
    "exclusions": ["research/inventory.json 与 zone-summary.json 自身不入条目",
                   ".agents/skills/gitnexus 与 generated:再生区仅 du 汇总",
                   ".DS_Store:汇总行不逐件;node_modules 等再生目录同 zone-5"],
    "rg_cmd": "rg -l/-o --fixed-strings --hidden --no-ignore -f <patterns> " + " ".join(SEARCH_DIRS)
              + " -g '!**/node_modules/**' '!**/.git/**' '!**/out/**' '!**/.gitnexus/**' '!**/.vite/**'",
    "planning_delta": planning_delta,
    "counts": counts,
    "candidates_ref_checked": len(candidates),
    "hard_inflight_missing": [p for p in HARD_INFLIGHT if p not in entries],
    "inflight_doc_refs_absent": extra_refs[:30],
    "runtime_note": None,
}

OUT_INV.parent.mkdir(parents=True, exist_ok=True)
inv = {"meta": meta, "files": files_out, "refmap": refmap, "dup_groups": dup_groups}
inv_text = json.dumps(inv, ensure_ascii=False, separators=(",", ":"))
OUT_INV.write_text(inv_text, encoding="utf-8")

summary = {
    "generated_at": meta["generated_at"],
    "git_head": GIT_HEAD,
    "counts": counts,
    "zones": zone_stats,
    "refcheck": {
        "candidates": len(candidates),
        "patterns": len(patterns),
        "refmap_named_with_hits": len(refmap),
        "hits_cap": HITS_CAP,
    },
    "dup": {"groups": len(dup_groups), "members": sum(len(v) for v in dup_groups.values())},
    "inflight": {"marked": n_ifl, "tasks": INFLIGHT_TASKS,
                 "doc_refd_scripts_absent": extra_refs[:30],
                 "mechanism": "ifl=硬边界17件点名+四役目录下全部文件+zone-1 件 basename 子串出现于在途档文本(宁枉勿纵;"
                              "通用名如 README.md 会过保,实测三件通用名均在档有真实提及;分区员可据 refmap 复核减保)"},
    "zone5_regen": zone5,
    "other_ignored_rollup": other_rows,
    "hash": {"hashed": n_hash, "skipped_over_10mb": n_skip, "skip_bytes": skip_bytes,
             "missing_tracked": missing},
    "planning_delta": planning_delta,
    "anomalies": anomalies,
    "inventory_json_bytes": len(inv_text.encode("utf-8")),
}
OUT_SUM.write_text(json.dumps(summary, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

log(f"完成:条目 {counts['total']},inventory.json {len(inv_text.encode('utf-8')) / 1e6:.2f}MB")
if missing:
    log(f"警告:磁盘缺失跟踪件 {len(missing)} 件")
for a in anomalies[:20]:
    log(f"异常:{a}")
