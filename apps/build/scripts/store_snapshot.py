#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""store_snapshot —— 漫影 store 只读快照 + 一键回滚 CLI(10-20 ch1 整目录丢失事件续办)。

任务:10-19-script-asset-extract-all-chapters。方案真源(含围攻 21 条修订与已知取舍):
.trellis/tasks/10-19-script-asset-extract-all-chapters/research/snapshot-plan-1020.md
事件档:同目录 incident-ch1-dir-loss-1020.md(ch1 两轮被存储层孤儿清理吃掉,恢复全靠手工 T0 备份)。

只读铁律(方案 §3):生产 IP/MA 永不以写模式打开;唯一写位 = 快照家(--home,
默认 ~/.my-studio-store-snapshots,IP/MA 外、仓库外、同卷 APFS);快照 = cp -Rc
clonefile 只读克隆;restore 是显式例外且须过方案 §3.4 全门(退出态+md5 双端校验)。

子命令:
  create   拍一代快照(全局锁;热拍允许标 hot;收敛校验 ≤3 轮整代重来;尾接 prune)
  list     列出各代:<id> created_at hot|cold verify files label + total/keep/disk_free
  verify   校验一代:files_index 全量 size 对账 + 正/反向闭包 + D15 台账 + meta md5;
           --deep = 现算全量 md5 写回 meta
  restore  一键回滚(=rollback 别名);门序 1/1b/2/3/4/4b/5/6 见方案 §3.4
  prune    按代名字典序保留最新 --keep 代;默认 dry-run,--apply 需 --confirm
  status   last_ok 头行 + 异常代清单 + journal 尾 20 行 + df

测试注入(门 1b 白名单,方案 v3 围攻#12):MYSTUDIO_SNAPSHOT_APP_STATE(running|quit)
与 MYSTUDIO_SNAPSHOT_DF_FREE_GI(浮点 Gi)仅当 --project-root 实解位于 /tmp 或
/private/var/folders(pytest tmp)时生效,其余一律真实 pgrep/statvfs。
MYSTUDIO_SNAPSHOT_AUTOLOCK_PATH 重定向 autopack 借用锁路径(测试隔离用)。

退出码:0=成功/跳过(create 遇活锁 skip 输出 skipped(lock=pid));
1=verify FAIL/参数错;2=平台或 store 缺失;4=create --require-cold 遇 App 在驾;
5=create 收敛 3 轮败(结构 FAIL);6=restore 门1 App 在驾;7=restore 门2 目标代自证败;
8=restore 门3 救援代失败;9=restore 门4 确认语不匹配;10=restore 门6 终检败;
11=create 失败自停(连续 3 败);12=create 磁盘水位 <50Gi;13=space_anomaly 连续 2 次 halt;
16=restore 门5 双锁获取失败。

Python 地板 = /usr/bin/python3 3.9.6(launchd plist 用它 exec;锚0 py_compile)。
"""
from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time

TOOL_VER = "1"
DEFAULT_PROJECT_ROOT = "~/Project/IP/MA"
DEFAULT_HOME = "~/.my-studio-store-snapshots"
AUTOLOCK_DEFAULT = "~/.my-studio-autopack/lock"

BIG_DOMAINS = ("assets", "studio-workflow", "extraction")
SW_DOMAIN = "studio-workflow"
EX_DOMAIN = "extraction"
MANIFEST_REL = os.path.join(SW_DOMAIN, "manifest.json")
LEDGER_REL = os.path.join(EX_DOMAIN, "extraction-run.json")
ASSETS_DB_REL = os.path.join("assets", "assets.db")
ASSETS_JOURNAL_REL = os.path.join("assets", "assets.db-journal")

GEN_RE = re.compile(r"^snap-\d{8}-\d{6}$")
TMPFILE_RE = re.compile(r".*\.\d+\.tmp$")
RESCUE_LABEL_PREFIX = "pre-restore-"

MIN_FREE_GI = 50.0
SPACE_ANOMALY_GI = 2.0
MAX_ROUNDS = 3
MAX_CONSEC_FAILURES = 3
DEFAULT_KEEP = 84
RESCUE_EXEMPT_COUNT = 2
LOCK_WAIT_SEC = 300.0
PROBE_INTERVAL_SEC = 60.0

APP_PGREP_PATTERN = "漫影工作室.app/Contents/MacOS"
INJECT_PREFIXES = ("/tmp/", "/private/tmp/", "/private/var/folders/")
# 白名单(存在性不 md5,方案 §3.3):README.md、_store-layout-v1.json、*.bak-reap-*、.DS_Store
WHITELIST_EXACT = {"README.md", "_store-layout-v1.json", ".DS_Store"}
WHITELIST_CONTAINS = (".bak-reap-",)

CROSS_DOMAIN_WARNING = (
    "跨域警告: characters/scenes/props/media 与 assets/extraction 同批更新且内嵌 "
    "asset-file:// 引用,单域回滚可能视图-库错代静默断链"
    "(studio-assets-storage.ts:153);跨域事故建议 assets+flat 同回或 store-all"
)

EXIT_OK = 0
EXIT_FAIL = 1
EXIT_ENV = 2
EXIT_REQUIRE_COLD = 4
EXIT_CONVERGENCE = 5
EXIT_APP_RUNNING = 6
EXIT_GEN_BAD = 7
EXIT_RESCUE_BAD = 8
EXIT_CONFIRM = 9
EXIT_FINALCHECK = 10
EXIT_HALTED = 11
EXIT_DF_GATE = 12
EXIT_SPACE_HALTED = 13
EXIT_LOCK = 16


# ---------------------------------------------------------------- 基础工具

def expand(p):
    return os.path.abspath(os.path.expanduser(p))


def now_iso():
    return datetime.datetime.now().isoformat(timespec="seconds")


def out(msg=""):
    print(msg, flush=True)


def journal(home, event, **kv):
    try:
        os.makedirs(home, exist_ok=True)
        parts = " ".join("%s=%s" % (k, v) for k, v in kv.items())
        with open(os.path.join(home, "journal.log"), "a", encoding="utf-8") as f:
            f.write("%s | %s | %s\n" % (now_iso(), event, parts))
    except OSError:
        pass


def load_state(home):
    try:
        with open(os.path.join(home, "state.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_state(home, st):
    os.makedirs(home, exist_ok=True)
    tmp = os.path.join(home, "state.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(st, f, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(home, "state.json"))


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def injection_active(project_root):
    """门 1b 白名单:注入仅当 --project-root 实解在 /tmp 或 /private/var/folders。"""
    if not os.environ.get("MYSTUDIO_SNAPSHOT_APP_STATE") and not os.environ.get(
            "MYSTUDIO_SNAPSHOT_DF_FREE_GI"):
        return False
    real = os.path.realpath(project_root)
    return any(real == p.rstrip("/") or real.startswith(p) for p in INJECT_PREFIXES)


def detect_app(project_root):
    """返回 (running, pid, injected)。注入白名单外一律真实 pgrep 精确主进程。"""
    if injection_active(project_root):
        v = (os.environ.get("MYSTUDIO_SNAPSHOT_APP_STATE") or "").strip().lower()
        if v == "running":
            return True, None, True
        if v == "quit":
            return False, None, True
    p = subprocess.run(["pgrep", "-f", APP_PGREP_PATTERN],
                       capture_output=True, text=True)
    if p.returncode == 0:
        first = (p.stdout or "").strip().splitlines()
        pid = int(first[0]) if first and first[0].isdigit() else None
        return True, pid, False
    return False, None, False


def df_avail_bytes(project_root, path):
    if injection_active(project_root):
        v = os.environ.get("MYSTUDIO_SNAPSHOT_DF_FREE_GI")
        if v:
            try:
                return int(float(v) * (1 << 30))
            except ValueError:
                pass
    p = path
    while not os.path.exists(p):
        nxt = os.path.dirname(p)
        if nxt == p:
            p = "/"
            break
        p = nxt
    st = os.statvfs(p)
    return st.f_bavail * st.f_frsize


def notify(msg):
    if os.environ.get("MYSTUDIO_SNAPSHOT_APP_STATE") or os.environ.get(
            "MYSTUDIO_SNAPSHOT_NO_NOTIFY"):
        return  # 测试注入态不出通知弹窗
    try:
        safe = msg.replace('"', "'")
        subprocess.run(
            ["osascript", "-e",
             'display notification "%s" with title "store_snapshot"' % safe],
            timeout=10, capture_output=True)
    except Exception:
        pass


# ---------------------------------------------------------------- 锁

def lock_holder(home):
    """活锁返回 pid;死锁清除返回 None。"""
    lf = os.path.join(home, "lock")
    if not os.path.exists(lf):
        return None
    try:
        pid = int(open(lf, encoding="utf-8").read().strip() or 0)
    except (OSError, ValueError):
        pid = 0
    if pid > 0 and pid_alive(pid):
        return pid
    try:
        os.remove(lf)  # 陈年死锁,清掉续行
    except OSError:
        pass
    return None


def acquire_home_lock(home):
    os.makedirs(home, exist_ok=True)
    holder = lock_holder(home)
    if holder is not None:
        return False, holder
    with open(os.path.join(home, "lock"), "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    return True, None


def release_home_lock(home):
    try:
        os.remove(os.path.join(home, "lock"))
    except OSError:
        pass


def autolock_path():
    return expand(os.environ.get("MYSTUDIO_SNAPSHOT_AUTOLOCK_PATH") or AUTOLOCK_DEFAULT)


def acquire_autopack_lock():
    """borrow autopack 锁:写 pid,autopack build_running() 读活 pid 即跳(封其调度链)。"""
    lp = autolock_path()
    if os.path.exists(lp):
        try:
            pid = int(open(lp, encoding="utf-8").read().strip() or 0)
        except (OSError, ValueError):
            pid = 0
        if pid > 0 and pid_alive(pid):
            return False, pid
    os.makedirs(os.path.dirname(lp), exist_ok=True)
    with open(lp, "w", encoding="utf-8") as f:
        f.write(str(os.getpid()))
    return True, None


def release_autopack_lock():
    lp = autolock_path()
    try:
        pid = int(open(lp, encoding="utf-8").read().strip() or 0)
    except (OSError, ValueError):
        pid = 0
    if pid == os.getpid():
        try:
            os.remove(lp)
        except OSError:
            pass


# ---------------------------------------------------------------- 文件工具

def md5_file(path, bufsize=1 << 20):
    h = hashlib.md5()
    with open(path, "rb") as f:
        while True:
            b = f.read(bufsize)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def walk_files(root):
    """yield 相对 posix 路径(全量,含白名单名)。"""
    for r, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if d != ".DS_Store"]
        rel = os.path.relpath(r, root)
        prefix = "" if rel == "." else rel.replace(os.sep, "/") + "/"
        for n in sorted(files):
            yield prefix + n


def count_files(root):
    n = 0
    for _ in walk_files(root):
        n += 1
    return n


def tree_bytes(root):
    total = 0
    for r, _, files in os.walk(root, followlinks=False):
        for n in files:
            try:
                total += os.lstat(os.path.join(r, n)).st_size
            except OSError:
                pass
    return total


def clean_snapshot(gen_store):
    r"""步7:删 `.*\.\d+\.tmp` 与所有层 .DS_Store(只作用于快照副本,不碰源)。"""
    removed = 0
    for r, dirs, files in os.walk(gen_store, topdown=False, followlinks=False):
        for n in files:
            if n == ".DS_Store" or TMPFILE_RE.fullmatch(n):
                try:
                    os.remove(os.path.join(r, n))
                    removed += 1
                except OSError:
                    pass
    return removed


def safe_mv(src, dst, home):
    """唯一经路 mv:目标存在→清残留+journal 记 clobbered;同卷 rename。"""
    if os.path.exists(dst):
        if os.path.isdir(dst) and not os.path.islink(dst):
            shutil.rmtree(dst)
        else:
            os.remove(dst)
        journal(home, "safe_mv", clobbered=dst)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    try:
        os.rename(src, dst)
    except OSError:
        shutil.move(src, dst)


def safe_cp_dir(src, dst, home):
    """clonefile 拷贝(cp -Rc);目标存在→清残留+journal 记 clobbered。返回 rc==0。"""
    if os.path.exists(dst):
        if os.path.isdir(dst) and not os.path.islink(dst):
            shutil.rmtree(dst)
        else:
            os.remove(dst)
        journal(home, "safe_cp", clobbered=dst)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    p = subprocess.run(["cp", "-Rc", src, dst], capture_output=True, text=True)
    if p.returncode != 0:
        journal(home, "safe_cp", rc=p.returncode, err=(p.stderr or "")[:200])
    return p.returncode == 0


# ---------------------------------------------------------------- 代与 meta

def gen_ts():
    return datetime.datetime.now().strftime("%Y%m%d-%H%M%S")


def list_generations(home):
    if not os.path.isdir(home):
        return []
    return sorted(d for d in os.listdir(home)
                  if GEN_RE.fullmatch(d) and os.path.isdir(os.path.join(home, d)))


def meta_path(gen_dir):
    return os.path.join(gen_dir, "snapshot-meta.json")


def load_meta(gen_dir):
    try:
        with open(meta_path(gen_dir), encoding="utf-8") as f:
            m = json.load(f)
        if not isinstance(m, dict):
            return None
        return m
    except Exception:
        return None


def save_meta_atomic(gen_dir, meta):
    tmp = meta_path(gen_dir) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    os.replace(tmp, meta_path(gen_dir))


def is_whitelisted(rel):
    base = rel.rsplit("/", 1)[-1]
    if base in WHITELIST_EXACT:
        return True
    return any(s in base for s in WHITELIST_CONTAINS)


# ---------------------------------------------------------------- 收敛校验(方案 §3.1.8)

def load_manifest(store_dir):
    try:
        with open(os.path.join(store_dir, MANIFEST_REL), encoding="utf-8") as f:
            m = json.load(f)
        if not isinstance(m, dict) or not isinstance(m.get("shards"), list):
            return None
        return m
    except Exception:
        return None


def check_forward_closure(store_dir):
    """a 正向闭包:manifest shards[] 每项在快照内。"""
    m = load_manifest(store_dir)
    if m is None:
        return False, ["manifest 不可解析(正向闭包无法进行)"]
    sw = os.path.join(store_dir, SW_DOMAIN)
    missing = [s for s in m["shards"]
               if not os.path.exists(os.path.join(sw, s))]
    if missing:
        return False, ["正向闭包 FAIL: 缺分片 %s" % ", ".join(missing[:5])]
    return True, []


def check_reverse_closure(store_dir):
    """a-2 反向闭包(D16):chapters/<id>/ 每个目录被 shards 以 chapters/<id>/ 前缀引用。"""
    m = load_manifest(store_dir)
    if m is None:
        return False, ["manifest 不可解析(反向闭包无法进行)"]
    referenced = set()
    for s in m["shards"]:
        if s.startswith("chapters/"):
            referenced.add(s.split("/")[1])
    ch_root = os.path.join(store_dir, SW_DOMAIN, "chapters")
    orphans = []
    if os.path.isdir(ch_root):
        for d in os.listdir(ch_root):
            if os.path.isdir(os.path.join(ch_root, d)) and d not in referenced:
                orphans.append(d)
    if orphans:
        return False, ["反向闭包 FAIL: 孤儿章目录(未被 manifest 引用,等待被孤儿清理回收的形态): %s"
                       % ", ".join(sorted(orphans)[:10])]
    return True, []


def check_ledger(store_dir):
    """b 台账-章一致(D15,dict 语义);结构异常→跳过该校验+标记,不崩不 halt。"""
    lp = os.path.join(store_dir, LEDGER_REL)
    if not os.path.exists(lp):
        return True, [], False
    try:
        with open(lp, encoding="utf-8") as f:
            d = json.load(f)
    except Exception:
        return True, [], True  # 解析不动 → 结构未知,跳过
    chapters = d.get("chapters") if isinstance(d, dict) else None
    if not isinstance(chapters, dict):
        return True, [], True  # 非预期形态(如数组)→ ledger_schema_unknown
    missing = []
    for cid, info in chapters.items():
        if isinstance(info, dict) and info.get("state") == "success":
            if not os.path.isdir(os.path.join(store_dir, SW_DOMAIN, "chapters", cid)):
                missing.append(cid)
    if missing:
        return False, ["台账-章一致 FAIL: state=success 而章目录缺: %s" % ", ".join(missing[:10])], False
    return True, [], False


def check_assets_db(store_dir):
    """c assets.db ro quick_check = ok(无 assets 域则过)。"""
    db = os.path.join(store_dir, ASSETS_DB_REL)
    if not os.path.exists(db):
        return True, []
    try:
        conn = sqlite3.connect("file:%s?mode=ro" % db, uri=True)
        try:
            rows = conn.execute("PRAGMA quick_check;").fetchall()
        finally:
            conn.close()
        ok = bool(rows) and rows[0][0] == "ok"
        if not ok:
            return False, ["assets.db quick_check != ok: %s" % (rows[:1],)]
        return True, []
    except Exception as e:
        return False, ["assets.db quick_check 异常: %s" % e]


def journal_present(store_dir):
    return os.path.exists(os.path.join(store_dir, ASSETS_JOURNAL_REL))


# ---------------------------------------------------------------- meta 构建(方案 §3.1.9)

def build_domains_meta(store_dir):
    """domains: assets{count,bytes,db_md5,sample_md5[5]} / studio-workflow{count,bytes,files_md5 全量}
    / flat{files_md5 全量} / extraction{files_md5} / media{count,bytes} / image-studio{count,bytes}。"""
    domains = {}

    def walk_entry(name):
        base = os.path.join(store_dir, name)
        if not os.path.exists(base):
            return None
        return base

    # assets
    abase = walk_entry("assets")
    if abase:
        rels = list(walk_files(abase))
        sample = rels[:: max(1, len(rels) // 5)][:5] if rels else []
        domains["assets"] = {
            "count": len(rels),
            "bytes": tree_bytes(abase),
            "db_md5": md5_file(os.path.join(abase, "assets.db"))
            if os.path.exists(os.path.join(abase, "assets.db")) else None,
            "sample_md5": {r: md5_file(os.path.join(abase, r)) for r in sample},
        }
    else:
        domains["assets"] = {"count": 0, "bytes": 0, "db_md5": None, "sample_md5": {}}

    # studio-workflow / extraction:files_md5 全量
    for dom in (SW_DOMAIN, EX_DOMAIN):
        base = walk_entry(dom)
        if base:
            rels = list(walk_files(base))
            domains[dom] = {
                "count": len(rels),
                "bytes": tree_bytes(base),
                "files_md5": {r: md5_file(os.path.join(base, r))
                              for r in rels if not is_whitelisted(r)},
            }
        else:
            domains[dom] = {"count": 0, "bytes": 0, "files_md5": {}}

    # media / image-studio:仅 count+bytes(v3 拆双键)
    for dom in ("media", "image-studio"):
        base = walk_entry(dom)
        domains[dom] = ({"count": count_files(base), "bytes": tree_bytes(base)}
                        if base else {"count": 0, "bytes": 0})

    # flat:其余顶层条目(不含 media/image-studio,它们有专键)
    flat_md5 = {}
    try:
        tops = os.listdir(store_dir)
    except OSError:
        tops = []
    for e in sorted(tops):
        if e in BIG_DOMAINS or e in ("media", "image-studio"):
            continue
        base = os.path.join(store_dir, e)
        if os.path.isdir(base) and not os.path.islink(base):
            for r in walk_files(base):
                if not is_whitelisted(r):
                    flat_md5[e + "/" + r] = md5_file(os.path.join(base, r))
        elif os.path.isfile(base):
            if not is_whitelisted(e):
                flat_md5[e] = md5_file(base)
    domains["flat"] = {"count": len(flat_md5), "bytes": 0, "files_md5": flat_md5}
    return domains


def build_files_index(store_dir):
    idx = {}
    for r in walk_files(store_dir):
        try:
            idx[r] = os.lstat(os.path.join(store_dir, r)).st_size
        except OSError:
            pass
    return idx


# ---------------------------------------------------------------- create(方案 §3.1)

def do_create(root, home, label, require_cold=False, dry_run=False,
              rescue_tolerant=False):
    """返回 (exit_code, gen_id)。唯一写位=快照家。
    rescue_tolerant(门3 救援代专用):收敛败不删代不 halt——照常写 meta(标
    convergence_failed+fail_reasons),过门凭据=meta 落盘可读(方案围攻#8)。"""
    store = os.path.join(root, "store")
    if not os.path.isdir(store):
        out("store 不存在: %s" % store)
        return EXIT_ENV, None

    if dry_run:
        running, pid, inj = detect_app(root)
        holder = lock_holder(home)
        st = load_state(home)
        free_gi = df_avail_bytes(root, home) / (1 << 30)
        out("[dry-run] app_state=%s pid=%s injected=%s" %
            ("running" if running else "quit", pid, inj))
        out("[dry-run] disk_free=%.1fGi (闸=%.0fGi)" % (free_gi, MIN_FREE_GI))
        out("[dry-run] lock=%s" % ("held(pid=%s)" % holder if holder else "free"))
        out("[dry-run] failure_halted=%s space_anomaly_halted=%s gens=%d keep=%d" %
            (bool(st.get("failure_halted")), bool(st.get("space_anomaly_halted")),
             len(list_generations(home)), DEFAULT_KEEP))
        out("[dry-run] 判定=%s" %
            ("df 闸会拒(exit 12)" if free_gi < MIN_FREE_GI else "会克隆"))
        return EXIT_OK, None

    ok, holder = acquire_home_lock(home)
    if not ok:
        out("skipped(lock=%s)" % holder)
        return EXIT_OK, None
    try:
        st = load_state(home)
        if st.get("failure_halted"):
            notify("store_snapshot 已失败自停(连续3败),需 --reset-failures")
            out("已失败自停: 连续 %d 败;python3 %s --reset-failures 复位"
                % (st.get("consecutive_failures", 0), os.path.abspath(__file__)))
            return EXIT_HALTED, None
        if st.get("space_anomaly_halted"):
            out("space_anomaly 连续 2 次 halt:清盘后 --reset-failures 自愈")
            return EXIT_SPACE_HALTED, None

        avail_before = df_avail_bytes(root, home)
        if avail_before < MIN_FREE_GI * (1 << 30):
            record_failure(home, "df-gate")
            notify("store_snapshot 磁盘水位不足 %.0fGi,已拒拍" % MIN_FREE_GI)
            out("磁盘水位闸: free=%.1fGi < %.0fGi → 拒拍" %
                (avail_before / (1 << 30), MIN_FREE_GI))
            return EXIT_DF_GATE, None

        running, pid, inj = detect_app(root)
        if running and require_cold:
            out("App 在驾(pid=%s)而 --require-cold → 拒拍" % pid)
            return EXIT_REQUIRE_COLD, None
        app_state = "hot" if running else "cold"

        gen_id = "snap-" + gen_ts()
        # 同秒撞名防护(救援代紧跟目标代时曾实测互吞):等秒跳过后再用新名
        _guard = 0
        while os.path.exists(os.path.join(home, gen_id)) and _guard < 100:
            time.sleep(0.05)
            _guard += 1
            gen_id = "snap-" + gen_ts()
        gen_dir = os.path.join(home, gen_id)
        # created_at 与代名严格同源(prune 一致性校验依赖);完成时刻另记 completed_at
        _ts = gen_id[5:]
        created_at = "%s-%s-%sT%s:%s:%s" % (_ts[0:4], _ts[4:6], _ts[6:8],
                                            _ts[9:11], _ts[11:13], _ts[13:15])
        rounds_used = 0
        db_journal_flag = False
        ledger_schema_unknown = False
        cleaned = 0
        baseline = 0
        converged = False
        fail_reasons = []
        for rnd in range(1, MAX_ROUNDS + 1):
            rounds_used = rnd
            if os.path.exists(gen_dir):
                shutil.rmtree(gen_dir)
            os.makedirs(gen_dir)
            if not safe_cp_dir(store, os.path.join(gen_dir, "store"), home):
                fail_reasons = ["cp -Rc rc!=0"]
                journal(home, "create-round", gen=gen_id, round=rnd, fail="cp")
                continue
            gen_store = os.path.join(gen_dir, "store")
            cleaned = clean_snapshot(gen_store)
            baseline = count_files(gen_store)
            problems = []
            ok_f, r1 = check_forward_closure(gen_store)
            problems += r1
            ok_r, r2 = check_reverse_closure(gen_store)
            problems += r2
            ok_l, r3, schema_unknown = check_ledger(gen_store)
            problems += r3
            ledger_schema_unknown = ledger_schema_unknown or schema_unknown
            ok_c, r4 = check_assets_db(gen_store)
            problems += r4
            # d 文件数对账:校验走完再数,与清洗后基线比对(副本不可变,漂移即异常)
            if count_files(gen_store) != baseline:
                problems.append("文件数对账 FAIL: 清洗后=%d 校验后=%d"
                                % (baseline, count_files(gen_store)))
            jp = journal_present(gen_store)
            if problems:
                fail_reasons = problems
                journal(home, "create-round", gen=gen_id, round=rnd,
                        fail="; ".join(problems)[:300])
                continue
            if jp and rnd < MAX_ROUNDS:
                # D14②:快照含 assets.db-journal → 先重拷一轮(高频写中希望走完 commit)
                db_journal_flag = True
                journal(home, "create-round", gen=gen_id, round=rnd, note="db-journal 重拷")
                continue
            db_journal_flag = jp
            converged = True
            break

        if not converged:
            if rescue_tolerant:
                # 救援代语义=忠实保全回滚前字节:保留末轮克隆+照常写 meta(标败因),
                # 不计失败自停(被回滚的现场常正是坏态,非调度失败)
                files_index = build_files_index(gen_store)
                meta = {
                    "id": gen_id,
                    "created_at": created_at,
                    "completed_at": now_iso(),
                    "app_state": app_state,
                    "app_pid": pid, "label": label or "", "tool_ver": TOOL_VER,
                    "rounds": rounds_used, "cleaned": cleaned,
                    "files": len(files_index),
                    "domains": build_domains_meta(gen_store),
                    "files_index": files_index,
                    "verify_status": "FAIL",
                    "convergence_failed": True,
                    "fail_reasons": fail_reasons,
                }
                save_meta_atomic(gen_dir, meta)
                journal(home, "create-rescue-tolerant", gen=gen_id,
                        fail="; ".join(fail_reasons)[:300])
                out("救援代收代(现场收敛败,meta 已落盘可读):")
                for r in fail_reasons:
                    out("  - %s" % r)
                return EXIT_CONVERGENCE, gen_id
            record_failure(home, "convergence")
            notify("store_snapshot 收敛 3 轮败: %s" % "; ".join(fail_reasons)[:120])
            if os.path.exists(gen_dir):
                shutil.rmtree(gen_dir)
            out("收敛 3 轮败(整代重来制):")
            for r in fail_reasons:
                out("  - %s" % r)
            return EXIT_CONVERGENCE, None

        files_index = build_files_index(gen_store)
        meta = {
            "id": gen_id,
            "created_at": created_at,
            "completed_at": now_iso(),
            "app_state": app_state,
            "app_pid": pid,
            "label": label or "",
            "tool_ver": TOOL_VER,
            "rounds": rounds_used,
            "cleaned": cleaned,
            "files": len(files_index),
            "domains": build_domains_meta(gen_store),
            "files_index": files_index,
            "verify_status": "PASS" if converged else "FAIL",
        }
        if db_journal_flag:
            meta["db_journal_present"] = True
        if ledger_schema_unknown:
            meta["ledger_schema_unknown"] = True

        avail_after = df_avail_bytes(root, home)
        grew_gi = (avail_before - avail_after) / (1 << 30)
        if grew_gi > SPACE_ANOMALY_GI:
            meta["space_anomaly"] = True
            streak = int(st.get("space_anomaly_streak", 0)) + 1
            st["space_anomaly_streak"] = streak
            notify("store_snapshot 本代实增 %.1fGi>2Gi(space_anomaly %d 连)" % (grew_gi, streak))
            if streak >= 2:
                st["space_anomaly_halted"] = True
                notify("store_snapshot space_anomaly 连续 2 次 → halt 待人工")
        else:
            st["space_anomaly_streak"] = 0

        save_meta_atomic(gen_dir, meta)
        record_success(home)
        journal(home, "create", gen=gen_id, state=app_state, rounds=rounds_used,
                files=len(files_index), label=label or "")
        # 步11:尾接 prune = 同进程内联,不重取锁(D12)
        prune_run(home, keep=DEFAULT_KEEP, apply=True, require_confirm=False)
        out("created %s app_state=%s rounds=%d files=%d cleaned=%d%s" %
            (gen_id, app_state, rounds_used, len(files_index), cleaned,
             " db_journal_present" if db_journal_flag else ""))
        return EXIT_OK, gen_id
    finally:
        release_home_lock(home)


def record_failure(home, reason):
    st = load_state(home)
    n = int(st.get("consecutive_failures", 0)) + 1
    st["consecutive_failures"] = n
    st["last_failure_at"] = now_iso()
    st["last_failure_reason"] = reason
    if n >= MAX_CONSEC_FAILURES:
        st["failure_halted"] = True
    save_state(home, st)
    journal(home, "failure", reason=reason, consecutive=n)


def record_success(home):
    st = load_state(home)
    st["consecutive_failures"] = 0
    st["failure_halted"] = False
    st["last_ok_at"] = now_iso()
    save_state(home, st)


# ---------------------------------------------------------------- verify(方案 §3.3)

def verify_generation(home, gen_id, deep=False, quiet=False):
    """返回 (ok, reasons, meta)。非 deep 也做 files_index 全量 size 对账。"""
    gen_dir = os.path.join(home, gen_id)
    meta = load_meta(gen_dir)
    if meta is None:
        return False, ["meta 不可读/缺失"], None
    store = os.path.join(gen_dir, "store")
    if not os.path.isdir(store):
        return False, ["快照 store/ 缺失"], meta
    reasons = []

    # files_index 全量 size 对账(双向)
    current = build_files_index(store)
    idx = meta.get("files_index") or {}
    for p, sz in idx.items():
        if p not in current:
            reasons.append("files_index: 缺 %s" % p)
        elif current[p] != sz:
            reasons.append("files_index: size 漂移 %s (%d→%d)" % (p, sz, current[p]))
    for p in current:
        if p not in idx and not is_whitelisted(p):
            reasons.append("files_index: 多出 %s" % p)

    for chk in (check_forward_closure, check_reverse_closure):
        okc, rs = chk(store)
        if not okc:
            reasons += rs
    okl, rl, _ = check_ledger(store)
    if not okl:
        reasons += rl
    okc, rc_ = check_assets_db(store)
    if not okc:
        reasons += rc_

    def cmp_md5(base, rels_map, dom):
        for rel, want in rels_map.items():
            fp = os.path.join(base, rel)
            if not os.path.exists(fp):
                reasons.append("%s md5: 缺 %s" % (dom, rel))
                continue
            if md5_file(fp) != want:
                reasons.append("%s md5: 不匹配 %s" % (dom, rel))

    doms = meta.get("domains") or {}
    assets = doms.get("assets") or {}
    if assets.get("db_md5"):
        cmp_md5(store, {ASSETS_DB_REL: assets["db_md5"]}, "assets")
    cmp_md5(os.path.join(store, "assets"), assets.get("sample_md5") or {}, "assets-sample")
    for dom in (SW_DOMAIN, EX_DOMAIN):
        cmp_md5(os.path.join(store, dom), (doms.get(dom) or {}).get("files_md5") or {}, dom)
    cmp_md5(store, (doms.get("flat") or {}).get("files_md5") or {}, "flat")

    if deep:
        deep_map = {}
        files = [p for p in build_files_index(store) if not is_whitelisted(p)]
        for i, p in enumerate(files):
            deep_map[p] = md5_file(os.path.join(store, p))
            if not quiet and (i + 1) % max(1, len(files) // 20) == 0:
                out("[deep] %d/%d" % (i + 1, len(files)))
        meta["deep_md5"] = deep_map

    meta["verify_status"] = "PASS" if not reasons else "FAIL"
    meta["verify_at"] = now_iso()
    save_meta_atomic(gen_dir, meta)
    return (not reasons), reasons, meta


def cmd_verify(args):
    home = expand(args.home)
    ok, reasons, _ = verify_generation(home, args.id, deep=args.deep)
    if ok:
        out("verify %s PASS" % args.id)
        return EXIT_OK
    out("verify %s FAIL:" % args.id)
    for r in reasons[:20]:
        out("  - %s" % r)
    return EXIT_FAIL


# ---------------------------------------------------------------- list / status(方案 §3.2/3.6)

def cmd_list(args):
    home = expand(args.home)
    gens = list_generations(home)
    for g in gens:
        meta = load_meta(os.path.join(home, g))
        if meta is None:
            out("%s ? ? META-UNREADABLE ?" % g)
            continue
        out("%s %s %s %s %d %s" % (
            g, meta.get("created_at", "?"), meta.get("app_state", "?"),
            meta.get("verify_status", "?"),
            len(meta.get("files_index") or {}),
            meta.get("label") or ""))
    free_gi = df_avail_bytes(home, home) / (1 << 30)
    out("total=%d keep=%d disk_free=%.0fGi" % (len(gens), args.keep, free_gi))
    return EXIT_OK


def cmd_status(args):
    home = expand(args.home)
    st = load_state(home)
    last_ok = st.get("last_ok_at")
    if last_ok:
        try:
            h = (datetime.datetime.now() -
                 datetime.datetime.fromisoformat(last_ok)).total_seconds() / 3600
            out("last_ok=%.1fh ago (%s)" % (h, last_ok))
        except Exception:
            out("last_ok=%s" % last_ok)
    else:
        out("last_ok=never")
    if st.get("failure_halted"):
        out("HALTED: consecutive_failures=%s (需 --reset-failures)"
            % st.get("consecutive_failures"))
    if st.get("space_anomaly_halted"):
        out("HALTED: space_anomaly_streak=%s (清盘 + --reset-failures)"
            % st.get("space_anomaly_streak"))
    anomalous = []
    for g in list_generations(home):
        meta = load_meta(os.path.join(home, g))
        if meta is None:
            anomalous.append("%s meta不可读(僵尸代,人工处置;prune 跳过不删)" % g)
            continue
        for k in ("db_journal_present", "space_anomaly", "ledger_schema_unknown"):
            if meta.get(k):
                anomalous.append("%s %s" % (g, k))
        if meta.get("verify_status") == "FAIL":
            anomalous.append("%s verify=FAIL" % g)
    out("异常代: %s" % ("; ".join(anomalous) if anomalous else "无"))
    jf = os.path.join(home, "journal.log")
    if os.path.exists(jf):
        lines = open(jf, encoding="utf-8").read().splitlines()
        out("journal 尾 20 行:")
        for ln in lines[-20:]:
            out("  " + ln)
    out("disk_free=%.0fGi" % (df_avail_bytes(home, home) / (1 << 30)))
    return EXIT_OK


# ---------------------------------------------------------------- prune(方案 §3.5)

def prune_run(home, keep, apply, require_confirm=True, confirm=None):
    """排序=代名字典序(即时间序,免疫 --deep 写回刷新 mtime);救援代最近2豁免;
    meta 缺失代跳过+告警;模式外跳过+告警。"""
    all_dirs = sorted(os.listdir(home)) if os.path.isdir(home) else []
    gens = [d for d in all_dirs if GEN_RE.fullmatch(d)]
    out_of_pattern = [d for d in all_dirs
                      if not GEN_RE.fullmatch(d)
                      and d not in ("state.json", "journal.log", "lock",
                                    "state.json.tmp")]
    metas = {}
    bad_meta = []
    created_mismatch = []
    for g in gens:
        meta = load_meta(os.path.join(home, g))
        if meta is None:
            bad_meta.append(g)
            continue
        # meta.created_at 一致性校验(与代名时间戳比对)
        ca = (meta.get("created_at") or "").split(".")[0]
        ca_norm = ca.replace("-", "").replace(":", "").replace("T", "")
        if ca_norm and ca_norm != g[5:].replace("-", ""):
            created_mismatch.append(g)
            continue
        metas[g] = meta
    for g in bad_meta:
        out("告警: %s meta 不可读/缺失 → 跳过不删(status 曝光,人工处置)" % g)
    for g in created_mismatch:
        out("告警: %s meta.created_at 与代名不一致 → 跳过不删" % g)
    for d in out_of_pattern:
        out("告警: 模式外条目 %s 不触碰" % d)

    rescue_gens = sorted(g for g, m in metas.items()
                         if (m.get("label") or "").startswith(RESCUE_LABEL_PREFIX))
    rescue_exempt = set(rescue_gens[-RESCUE_EXEMPT_COUNT:])

    # 可删候选 = meta 可读且 created_at 一致的代,字典序(旧→新)
    candidates = sorted(metas)
    survivors = set(candidates[-keep:]) if keep < len(candidates) else set(candidates)
    to_delete = [g for g in candidates
                 if g not in survivors and g not in rescue_exempt]

    if require_confirm:
        expected = "prune keep=%d" % keep
        if not apply:
            out("prune dry-run: keep=%d total=%d 将删除 %d 代%s"
                % (keep, len(candidates), len(to_delete),
                   (": " + ", ".join(to_delete)) if to_delete else ""))
            return EXIT_OK
        if confirm != expected:
            out("prune --apply 需确认语: --confirm \"%s\"" % expected)
            return EXIT_FAIL
    for g in to_delete:
        shutil.rmtree(os.path.join(home, g))
        journal(home, "prune", deleted=g)
    out("prune: keep=%d 删除 %d 代%s"
        % (keep, len(to_delete), (": " + ", ".join(to_delete)) if to_delete else ""))
    return EXIT_OK


def cmd_prune(args):
    home = expand(args.home)
    return prune_run(home, args.keep, args.apply,
                     require_confirm=True, confirm=args.confirm)


# ---------------------------------------------------------------- restore(方案 §3.4)

FAIL_MANUAL = """终检 FAIL 处置手册:
前提:先 pgrep 确认无任何写入方(App 退出+无维护脚本在跑)再动手。
a) 白名单差异(README.md/_store-layout-v1.json/*.bak-reap-*/.DS_Store)→ 接受结果 + 清理旁位。
b) 回原态 → safe_mv 旁位 outgoing/<域> 回 store/<域>(旁位内存的即回滚前状态)。
c) 快照代坏 → 换一代或重拍:create 后重新 restore;救援代(label=pre-restore-*)可作应急源。"""


def resolve_scope_entries(store_dir, gen_store, scope):
    """盘上发现制(D7/围攻#11):{assets,studio-workflow,extraction} 为大域,其余顶层归 flat;
    studio-workflow 恒联 extraction。返回 (entries, error)。"""
    if scope == "store-all":
        live = set(os.listdir(store_dir)) if os.path.isdir(store_dir) else set()
        snap = set(os.listdir(gen_store)) if os.path.isdir(gen_store) else set()
        return sorted(live | snap), None
    if scope in BIG_DOMAINS:
        entries = [scope]
        if scope == SW_DOMAIN:
            entries.append(EX_DOMAIN)
        return entries, None
    if scope == "flat":
        live = set(os.listdir(store_dir)) if os.path.isdir(store_dir) else set()
        snap = set(os.listdir(gen_store)) if os.path.isdir(gen_store) else set()
        return sorted(e for e in (live | snap)
                      if e not in BIG_DOMAINS), None
    return None, "未知 scope=%s(可用: store-all/studio-workflow/assets/extraction/flat)" % scope


def _sentinel_check(store, entries, baseline):
    changed = []
    for e in entries:
        p = os.path.join(store, e)
        try:
            if os.path.exists(p) and os.lstat(p).st_mtime != baseline.get(e):
                changed.append(e)
        except OSError:
            pass
    return changed


def collect_mtime_sentinels(store, entries):
    base = {}
    for e in entries:
        p = os.path.join(store, e)
        try:
            if os.path.exists(p):
                base[e] = os.lstat(p).st_mtime
        except OSError:
            pass
    return base


def md5_scope_both_ends(store, gen_store, entries, root, sentinels, sample_only=False):
    """门6 双端现算 md5(白名单除外),60s 周期重探;进度 5% 粒度。返回 (ok, problems)。"""
    files = []
    for e in entries:
        base = os.path.join(store, e)
        if not os.path.exists(base):
            continue
        if os.path.isdir(base):
            for r in walk_files(base):
                if not is_whitelisted("%s/%s" % (e, r)):
                    files.append((e, r))
        elif not is_whitelisted(e):
            files.append((e, ""))
    if sample_only and len(files) > 5:
        step = max(1, len(files) // 5)
        files = files[::step][:5]
    problems = []
    last_probe = time.time()
    next_pct = 5
    for i, (e, r) in enumerate(files):
        live = os.path.join(store, e, r) if r else os.path.join(store, e)
        snap = os.path.join(gen_store, e, r) if r else os.path.join(gen_store, e)
        if not os.path.exists(snap):
            problems.append("快照端缺 %s/%s" % (e, r))
            continue
        if md5_file(live) != md5_file(snap):
            problems.append("md5 不匹配 %s/%s" % (e, r))
        pct = (i + 1) * 100 // max(1, len(files))
        if pct >= next_pct:
            out("[md5] %d%% (%d/%d)%s" % (pct, i + 1, len(files),
                                          " [sample]" if sample_only else ""))
            next_pct += 5
        if time.time() - last_probe >= PROBE_INTERVAL_SEC:
            last_probe = time.time()
            running, _, _ = detect_app(root)
            if running:
                return False, problems + ["窗口内 App 被拉起(中止终检,保留旁位)"]
            changed = _sentinel_check(store, [e for e in entries], sentinels)
            if changed:
                out("WARN: 窗口内有写入方(维护脚本直写 store 不走锁,pgrep 探不到,mtime 哨兵兜): %s"
                    % ", ".join(changed))
    # 终检后再探一次
    running, _, _ = detect_app(root)
    if running:
        return False, problems + ["终检后 App 在驾(中止,保留旁位)"]
    changed = _sentinel_check(store, entries, sentinels)
    if changed:
        out("WARN: 终检窗口 mtime 哨兵命中: %s(维护脚本直写形态,人工核查)" % ", ".join(changed))
    return not problems, problems


def cmd_restore(args):
    root = expand(args.project_root)
    home = expand(args.home)
    store = os.path.join(root, "store")
    scope = args.scope or "store-all"
    gen_id = args.id
    gen_dir = os.path.join(home, gen_id)
    gen_store = os.path.join(gen_dir, "store")

    # 门 1/1b:退出态(注入白名单见 detect_app)
    running, pid, inj = detect_app(root)
    if running:
        out("门1 FAIL: App 在驾(pid=%s,注入=%s)→ 拒绝回滚" % (pid, inj))
        return EXIT_APP_RUNNING

    # 门 2:目标代自证(非 deep verify + files_index 全量 size 对账;--verify-deep 升全量)
    if not GEN_RE.fullmatch(gen_id) or not os.path.isdir(gen_store):
        out("门2 FAIL: 目标代不存在: %s" % gen_dir)
        return EXIT_GEN_BAD
    ok, reasons, _ = verify_generation(home, gen_id, deep=args.verify_deep)
    if not ok:
        out("门2 FAIL: 目标代自证不过(--verify-deep 可升全量 md5):")
        for r in reasons[:20]:
            out("  - %s" % r)
        return EXIT_GEN_BAD

    # scope 实解(盘上发现制)
    entries, err = resolve_scope_entries(store, gen_store, scope)
    if err:
        out(err)
        return EXIT_FAIL

    # 门 3:救援代(等锁≤5min;以救援代 meta 落盘可读为过门凭据,不以退出码为凭)
    if not args.dry_run:
        deadline = time.time() + LOCK_WAIT_SEC
        while True:
            holder = lock_holder(home)
            if holder is None:
                break
            if time.time() > deadline:
                out("门3 FAIL: 等锁超时 %.0fs(pid=%s 持锁)" % (LOCK_WAIT_SEC, holder))
                return EXIT_RESCUE_BAD
            time.sleep(5)
        rc, _ = do_create(root, home, label=RESCUE_LABEL_PREFIX + gen_id,
                          rescue_tolerant=True)
        rescue_meta = None
        for g in list_generations(home):
            m = load_meta(os.path.join(home, g))
            if m and (m.get("label") or "") == RESCUE_LABEL_PREFIX + gen_id:
                rescue_meta = m
                break
        if not rescue_meta or not rescue_meta.get("files_index"):
            out("门3 FAIL: 救援代 meta 未落盘可读(create rc=%s)" % rc)
            return EXIT_RESCUE_BAD
        out("门3 OK: 救援代 %s 落盘可读" % rescue_meta["id"])

    # 跨域警告(v3 围攻#4):dry-run 与确认语前强制打印
    if scope != "store-all":
        out(CROSS_DOMAIN_WARNING)

    # 门 4b:--dry-run = scope 实解清单 + 门5 预演 + FAIL 手册,exit 0 不动盘(无需确认语)
    if args.dry_run:
        out("[dry-run] scope=%s 实解清单(盘上发现制):" % scope)
        for e in entries:
            in_live = os.path.exists(os.path.join(store, e))
            in_snap = os.path.exists(os.path.join(gen_store, e))
            out("  %s  live=%s snapshot=%s" % (e, in_live, in_snap))
        holder = lock_holder(home)
        out("[dry-run] 门5 预演: home锁=%s autopack锁=%s df_free=%.0fGi" %
            ("held(pid=%s)" % holder if holder else "free",
             "held" if os.path.exists(autolock_path()) else "free",
             df_avail_bytes(root, home) / (1 << 30)))
        sidecar = os.path.join(root, ".store-restore-%d" % os.getpid())
        out("[dry-run] 旁位=%s 已存在=%s" % (sidecar, os.path.exists(sidecar)))
        for e in entries:
            out("[dry-run] safe_mv 目标: outgoing/%s 目标存在=%s;就位目标 store/%s 已存在=%s"
                % (e, os.path.exists(os.path.join(sidecar, "outgoing", e)),
                   e, os.path.exists(os.path.join(store, e))))
        out(FAIL_MANUAL)
        return EXIT_OK

    # 门 4:确认语精确全字面匹配(真回滚必过)
    expected_confirm = "restore %s scope=%s root=%s" % (gen_id, scope, root)
    if args.confirm != expected_confirm:
        out("门4 FAIL: 确认语不匹配。需:")
        out('  --confirm "%s"' % expected_confirm)
        return EXIT_CONFIRM

    # 门 5:双锁 + 重探 + 原子覆盖
    ok, holder = acquire_home_lock(home)
    if not ok:
        out("门5 FAIL: home 锁被 pid=%s 持有" % holder)
        return EXIT_LOCK
    autopack_acquired = False
    try:
        oka, apid = acquire_autopack_lock()
        if not oka:
            out("门5 FAIL: autopack 打包链在跑(lock pid=%s),避让" % apid)
            return EXIT_LOCK
        autopack_acquired = True
        running, pid2, _ = detect_app(root)
        if running:
            out("门5 FAIL: swap 前 App 重探在驾(pid=%s)" % pid2)
            return EXIT_APP_RUNNING
        sidecar = os.path.join(root, ".store-restore-%d" % os.getpid())
        incoming = os.path.join(sidecar, "incoming")
        outgoing = os.path.join(sidecar, "outgoing")
        os.makedirs(incoming, exist_ok=True)
        os.makedirs(outgoing, exist_ok=True)
        to_restore = []
        for e in entries:
            src = os.path.join(gen_store, e)
            if not os.path.exists(src):
                out("WARN: 快照缺 %s(快照后新增于 live),跳过不回滚该条目" % e)
                continue
            to_restore.append(e)
            if not safe_cp_dir(src, os.path.join(incoming, e), home):
                out("门5 FAIL: 旁位拷贝失败 %s" % e)
                return EXIT_FINALCHECK
        # 旁位 md5 抽对(每条目抽至多3文件)
        for e in to_restore:
            base = os.path.join(incoming, e)
            rels = [r for r in list(walk_files(base))[:3]]
            for r in rels:
                if md5_file(os.path.join(base, r)) != md5_file(os.path.join(gen_store, e, r)):
                    out("门5 FAIL: 旁位 md5 抽对不过 %s/%s" % (e, r))
                    return EXIT_FINALCHECK
        # swap 前重探
        running, pid3, _ = detect_app(root)
        if running:
            out("门5 FAIL: swap 前 pgrep 重探在驾(pid=%s),旁位保留待查" % pid3)
            return EXIT_APP_RUNNING
        for e in to_restore:
            live_p = os.path.join(store, e)
            if os.path.exists(live_p):
                safe_mv(live_p, os.path.join(outgoing, e), home)
            safe_mv(os.path.join(incoming, e), live_p, home)
        journal(home, "restore-swap", gen=gen_id, scope=scope, entries=",".join(to_restore))
        # mtime 哨兵基线=换位后状态(终检窗口内的新写入方才是命中)
        sentinels = collect_mtime_sentinels(store, to_restore)

        # 门 6:终检(60s 重探+mtime 哨兵;双端全量 md5+assets quick_check;--md5-sample 降级)
        okm, problems = md5_scope_both_ends(store, gen_store, to_restore, root,
                                            sentinels, sample_only=args.md5_sample)
        if "assets" in to_restore:
            okc, rc_ = check_assets_db(store)
            if not okc:
                okm = False
                problems = problems + rc_
        if not okm:
            out("门6 FAIL(旁位保留:%s,按手册处置):" % os.path.join(root, ".store-restore-%d" % os.getpid()))
            for p in problems[:20]:
                out("  - %s" % p)
            out(FAIL_MANUAL)
            return EXIT_FINALCHECK
        shutil.rmtree(sidecar, ignore_errors=True)
        release_autopack_lock()
        autopack_acquired = False
        journal(home, "restore-done", gen=gen_id, scope=scope)
        out("restore OK: gen=%s scope=%s entries=%s 救援代在 home 内(label=%s%s)"
            % (gen_id, scope, ",".join(to_restore), RESCUE_LABEL_PREFIX, gen_id))
        return EXIT_OK
    finally:
        if autopack_acquired:
            release_autopack_lock()
        release_home_lock(home)


# ---------------------------------------------------------------- main

def build_parser():
    common = argparse.ArgumentParser(add_help=False)
    # 子命令位旗标:SUPPRESS → 不覆写根位已给值(根/子两处都接受,方案 §7 演练显式双参)
    common.add_argument("--project-root", default=argparse.SUPPRESS,
                        help="工程根(默认 %s);演练一律显式传(方案 §7 纪律)" % DEFAULT_PROJECT_ROOT)
    common.add_argument("--home", default=argparse.SUPPRESS,
                        help="快照家(默认 %s;唯一写位)" % DEFAULT_HOME)
    ap = argparse.ArgumentParser(
        prog="store_snapshot",
        description="漫影 store 只读快照+一键回滚(方案 snapshot-plan-1020.md)")
    ap.add_argument("--reset-failures", action="store_true",
                    help="复位失败自停/space_anomaly halt 记账")
    ap.add_argument("--project-root", default=DEFAULT_PROJECT_ROOT)
    ap.add_argument("--home", default=DEFAULT_HOME)
    sub = ap.add_subparsers(dest="cmd")
    p = sub.add_parser("create", parents=[common], help="拍一代只读快照")
    p.add_argument("--label", default="", help="标记(auto=定时;pre-restore-*=救援代)")
    p.add_argument("--require-cold", action="store_true", help="App 在驾则拒拍")
    p.add_argument("--dry-run", action="store_true", help="只报 App态/df/锁/水位,不克隆")
    p = sub.add_parser("list", parents=[common], help="列代")
    p.add_argument("--keep", type=int, default=DEFAULT_KEEP)
    p = sub.add_parser("verify", parents=[common], help="校验一代")
    p.add_argument("--id", required=True)
    p.add_argument("--deep", action="store_true", help="现算全量 md5 写回 meta")
    for name in ("restore", "rollback"):
        p = sub.add_parser(name, parents=[common],
                           help="一键回滚" + ("(restore 别名)" if name == "rollback" else ""))
        p.add_argument("--id", required=True)
        p.add_argument("--scope", default="store-all",
                       help="store-all(默认)/studio-workflow(恒联 extraction)/assets/extraction/flat")
        p.add_argument("--md5-sample", action="store_true", help="终检降级为抽样 md5")
        p.add_argument("--verify-deep", action="store_true", help="门2 升全量 md5")
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--confirm", default="", help='确认语: "restore <id> scope=<s> root=<R>"')
    p = sub.add_parser("prune", parents=[common], help="保留最新 --keep 代(默认 dry-run)")
    p.add_argument("--keep", type=int, default=DEFAULT_KEEP)
    p.add_argument("--apply", action="store_true")
    p.add_argument("--confirm", default="", help='--apply 需 --confirm "prune keep=84"')
    p = sub.add_parser("status", parents=[common], help="活性+异常代+journal 尾+df")
    return ap


def main(argv=None):
    if sys.platform != "darwin":
        out("darwin-only 工具(cp -Rc clonefile / pgrep 面)")
        return EXIT_ENV
    ap = build_parser()
    args = ap.parse_args(argv)
    if args.reset_failures:
        home = expand(args.home)
        st = load_state(home)
        st["consecutive_failures"] = 0
        st["failure_halted"] = False
        st["space_anomaly_streak"] = 0
        st["space_anomaly_halted"] = False
        save_state(home, st)
        journal(home, "reset-failures")
        out("failures/space 记账已复位(home=%s)" % home)
        return EXIT_OK
    if not args.cmd:
        ap.print_help()
        return EXIT_FAIL
    root = expand(args.project_root)
    if args.cmd == "create":
        rc, _ = do_create(root, expand(args.home), args.label,
                          require_cold=args.require_cold, dry_run=args.dry_run)
        return rc
    if args.cmd == "list":
        return cmd_list(args)
    if args.cmd == "verify":
        return cmd_verify(args)
    if args.cmd in ("restore", "rollback"):
        return cmd_restore(args)
    if args.cmd == "prune":
        return cmd_prune(args)
    if args.cmd == "status":
        return cmd_status(args)
    ap.print_help()
    return EXIT_FAIL


if __name__ == "__main__":
    sys.exit(main())
