#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""test_store_snapshot —— store_snapshot.py 契约锚面(方案 v3 §6)。

临时目录夹具构造迷你 store,绝不触碰生产 IP/MA。注入白名单(门 1b):
pytest tmp 位于 /private/var/folders → MYSTUDIO_SNAPSHOT_APP_STATE 等注入生效;
autopack 借用锁经 MYSTUDIO_SNAPSHOT_AUTOLOCK_PATH 重定向,不碰真实 ~/.my-studio-autopack。

锚面(方案 §6):0 syntax-floor(/usr/bin/python3=3.9.6);1 create 冷/热;
2 正向闭包红绿;2b 反向闭包(孤儿章→FAIL;清→PASS);3 收敛循环+失败记账;
3b D15 dict 解析(dict 台账+章缺→FAIL;数组形态→ledger_schema_unknown 跳过不崩);
4 清洗;5 restore 门(注入 running exit6/confirm 不匹配 exit9/--dry-run 不动盘/
全过 md5 绿+救援代+借用锁已清);5b safe_mv/safe_cp 嵌套防线;5c 门 1b 注入白名单;
6 prune(dry-run 不动盘/apply 确认语/代名字典序删旧/救援代豁免/meta 缺失跳过/模式外不删);
7 extraction 联回(scope=studio-workflow 恒联 extraction)。

跑法:python3 -m pytest -q test_store_snapshot.py -p no:cacheprovider
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(HERE, "store_snapshot.py")
USR_PY = "/usr/bin/python3"  # 3.9.6 地板(D11)


# ---------------------------------------------------------------- 夹具与工具

def run_tool(args, env_extra=None, python=None, timeout=180):
    env = os.environ.copy()
    env["MYSTUDIO_SNAPSHOT_APP_STATE"] = "quit"  # 门1b 注入:pytest tmp 在白名单内
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [python or sys.executable, SCRIPT] + [str(a) for a in args],
        capture_output=True, text=True, env=env, timeout=timeout,
    )


def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def build_mini_store(proj, ledger_chapters=None, ledger_array=False):
    store = os.path.join(proj, "store")
    w(os.path.join(store, "_store-layout-v1.json"), '{"version":1}')
    for n in ("characters.json", "scenes.json", "overview.json"):
        w(os.path.join(store, n), '{"v":1,"n":"%s"}' % n)
    sw = os.path.join(store, "studio-workflow")
    w(os.path.join(sw, "README.md"), "readme")
    shards = ["core-abc123.json"]
    w(os.path.join(sw, "core-abc123.json"), '{"k":"core"}')
    for name in ("novel-chapters-001-a1b2c3d4.json", "agent-work-data-001-e5f6a7b8.json"):
        w(os.path.join(sw, "chapters", "chapter-001", name), '{"c":1}')
        shards.append("chapters/chapter-001/" + name)
    manifest = {
        "layout": "studio-workflow-shards-v1", "version": 1, "shards": shards,
        "chapterIndex": [{"id": "chapter-001", "title": "一"}],
        "activeChapterId": "chapter-001",
    }
    w(os.path.join(sw, "manifest.json"), json.dumps(manifest, ensure_ascii=False))
    if ledger_array:
        ledger = {"version": 1, "runId": "r1", "range": [1, 1], "status": "done",
                  "chapters": [{"id": "chapter-001", "state": "success"}]}
    else:
        chapters = ledger_chapters if ledger_chapters is not None else {
            "chapter-001": {"state": "success"}}
        ledger = {"version": 1, "runId": "r1", "range": [1, 1], "status": "done",
                  "chapters": chapters}
    w(os.path.join(proj, "store", "extraction", "extraction-run.json"),
      json.dumps(ledger, ensure_ascii=False))
    w(os.path.join(proj, "store", "extraction", "entity-appearances.json"), "{}")
    assets = os.path.join(store, "assets")
    os.makedirs(assets, exist_ok=True)
    conn = sqlite3.connect(os.path.join(assets, "assets.db"))
    conn.execute("CREATE TABLE IF NOT EXISTS a(x)")
    conn.execute("INSERT INTO a VALUES(1)")
    conn.commit()
    conn.close()
    w(os.path.join(assets, "files", "role", "hero.json"), '{"role":1}')
    w(os.path.join(assets, "thumbs", "t1.json"), "{}")
    w(os.path.join(store, "media", "m1.bin"), "M")
    w(os.path.join(store, "image-studio", "c1.json"), '{"canvas":1}')
    return store


@pytest.fixture
def mini(tmp_path):
    proj = str(tmp_path / "proj")
    os.makedirs(proj)
    build_mini_store(proj)
    home = str(tmp_path / "snaps")
    autolock = str(tmp_path / "autolock")
    return {"proj": proj, "home": home, "autolock": autolock,
            "store": os.path.join(proj, "store")}


def env_of(mini):
    return {"MYSTUDIO_SNAPSHOT_AUTOLOCK_PATH": mini["autolock"]}


def list_gens(home):
    if not os.path.isdir(home):
        return []
    return sorted(d for d in os.listdir(home)
                  if re.fullmatch(r"snap-\d{8}-\d{6}", d))


def load_meta(home, gen):
    with open(os.path.join(home, gen, "snapshot-meta.json"), encoding="utf-8") as f:
        return json.load(f)


def create(mini, extra=None, env_extra=None, python=None):
    args = ["create", "--project-root", mini["proj"], "--home", mini["home"]] + (extra or [])
    return run_tool(args, env_extra={**env_of(mini), **(env_extra or {})}, python=python)


def one_gen(home):
    gens = list_gens(home)
    assert len(gens) == 1, gens
    return gens[0]


# ---------------------------------------------------------------- 锚 0:D11 地板

def test_anchor0_syntax_floor_py396():
    p = subprocess.run([USR_PY, "-m", "py_compile", SCRIPT],
                       capture_output=True, text=True, timeout=60)
    assert p.returncode == 0, p.stderr


def test_anchor0_runtime_floor_py396_create(mini):
    p = create(mini, python=USR_PY)
    assert p.returncode == 0, p.stdout + p.stderr
    assert one_gen(mini["home"])


def test_help_smoke_all_subcommands():
    for sub in ("create", "list", "verify", "restore", "rollback", "prune", "status"):
        p = run_tool([sub, "--help"])
        assert p.returncode == 0, (sub, p.stderr)


# ---------------------------------------------------------------- 锚 1:create 冷/热

def test_create_cold_green(mini):
    p = create(mini)
    assert p.returncode == 0, p.stdout + p.stderr
    gen = one_gen(mini["home"])
    meta = load_meta(mini["home"], gen)
    assert meta["app_state"] == "cold"
    assert meta["files_index"], "files_index 非空"
    assert meta["domains"]["assets"]["count"] >= 3
    assert meta["domains"]["studio-workflow"]["files_md5"]
    assert "media" in meta["domains"] and "image-studio" in meta["domains"]
    assert os.path.exists(os.path.join(mini["home"], gen, "store", "studio-workflow", "manifest.json"))


def test_create_hot_marker(mini):
    p = create(mini, env_extra={"MYSTUDIO_SNAPSHOT_APP_STATE": "running"})
    assert p.returncode == 0, p.stdout + p.stderr
    assert load_meta(mini["home"], one_gen(mini["home"]))["app_state"] == "hot"


def test_create_skip_when_lock_held_by_live_pid(mini):
    os.makedirs(mini["home"], exist_ok=True)
    with open(os.path.join(mini["home"], "lock"), "w") as f:
        f.write(str(os.getpid()))
    p = create(mini)
    assert p.returncode == 0
    assert "skipped(lock=" in p.stdout, p.stdout
    assert list_gens(mini["home"]) == []


def test_create_dry_run_no_disk_change(mini):
    p = create(mini, extra=["--dry-run"])
    assert p.returncode == 0, p.stdout + p.stderr
    for token in ("app_state", "disk_free", "lock"):
        assert token in p.stdout, p.stdout
    assert list_gens(mini["home"]) == []


def test_create_require_cold_refuses_hot(mini):
    p = create(mini, extra=["--require-cold"],
               env_extra={"MYSTUDIO_SNAPSHOT_APP_STATE": "running"})
    assert p.returncode == 4, (p.returncode, p.stdout, p.stderr)


def test_create_df_gate_exit12(mini):
    p = create(mini, env_extra={"MYSTUDIO_SNAPSHOT_DF_FREE_GI": "10"})
    assert p.returncode == 12, (p.returncode, p.stdout, p.stderr)
    assert list_gens(mini["home"]) == []


# ---------------------------------------------------------------- 锚 4:清洗

def test_create_cleans_tmp_and_dsstore(mini):
    w(os.path.join(mini["store"], "studio-workflow", ".DS_Store"), "junk")
    w(os.path.join(mini["store"], "studio-workflow", "chapters", "chapter-001", ".x.123.tmp"), "junk")
    p = create(mini)
    assert p.returncode == 0, p.stdout + p.stderr
    gen = one_gen(mini["home"])
    snap_store = os.path.join(mini["home"], gen, "store")
    found_bad = [os.path.join(r, n) for r, _, fs in os.walk(snap_store)
                 for n in fs if n == ".DS_Store" or re.fullmatch(r".*\.\d+\.tmp", n)]
    assert found_bad == []
    assert load_meta(mini["home"], gen)["cleaned"] >= 2
    # 源(迷你 store)不被清洗触碰——只读铁律
    assert os.path.exists(os.path.join(mini["store"], "studio-workflow", ".DS_Store"))


# ---------------------------------------------------------------- 锚 2/2b/3/3b:闭包与收敛

def test_forward_closure_verify_red_green(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    vid = ["verify", "--project-root", mini["proj"], "--home", mini["home"], "--id", gen]
    assert run_tool(vid, env_extra=env_of(mini)).returncode == 0
    # 红:抠掉一片被 manifest 引用的分片 → verify FAIL
    os.remove(os.path.join(mini["home"], gen, "store", "studio-workflow",
                           "chapters", "chapter-001", "novel-chapters-001-a1b2c3d4.json"))
    p = run_tool(vid, env_extra=env_of(mini))
    assert p.returncode == 1
    assert "正向闭包" in (p.stdout + p.stderr)


def test_reverse_closure_orphan_chapter_fails_create(mini):
    w(os.path.join(mini["store"], "studio-workflow", "chapters", "chapter-002",
                   "novel-chapters-002-deadbeef.json"), '{"c":2}')
    p = create(mini)
    assert p.returncode == 5, (p.returncode, p.stdout, p.stderr)
    assert "chapter-002" in (p.stdout + p.stderr)
    assert list_gens(mini["home"]) == []  # 整代重来制:败代不留
    # 清掉孤儿 → PASS
    import shutil
    shutil.rmtree(os.path.join(mini["store"], "studio-workflow", "chapters", "chapter-002"))
    assert create(mini).returncode == 0


def test_convergence_burns_rounds_then_exit5_and_records_failure(mini):
    # manifest 引用不存在分片 → 正向闭包恒败 → 3 轮 → exit 5 + 记账
    mpath = os.path.join(mini["store"], "studio-workflow", "manifest.json")
    m = json.load(open(mpath, encoding="utf-8"))
    m["shards"].append("chapters/chapter-001/ghost-00000000.json")
    w(mpath, json.dumps(m, ensure_ascii=False))
    p = create(mini)
    assert p.returncode == 5
    st = json.load(open(os.path.join(mini["home"], "state.json"), encoding="utf-8"))
    assert st["consecutive_failures"] == 1
    # 修复后绿 + 失败计数归零
    m["shards"].remove("chapters/chapter-001/ghost-00000000.json")
    w(mpath, json.dumps(m, ensure_ascii=False))
    p = create(mini)
    assert p.returncode == 0, p.stdout + p.stderr
    st = json.load(open(os.path.join(mini["home"], "state.json"), encoding="utf-8"))
    assert st["consecutive_failures"] == 0


def test_failure_halt_after_3_and_reset(mini):
    mpath = os.path.join(mini["store"], "studio-workflow", "manifest.json")
    m = json.load(open(mpath, encoding="utf-8"))
    m["shards"].append("ghost.json")
    w(mpath, json.dumps(m, ensure_ascii=False))
    for _ in range(3):
        assert create(mini).returncode == 5
    m["shards"].remove("ghost.json")
    w(mpath, json.dumps(m, ensure_ascii=False))
    p = create(mini)  # 已 halt:即使源已好也 exit 11
    assert p.returncode == 11, (p.returncode, p.stdout, p.stderr)
    p = run_tool(["--reset-failures", "--home", mini["home"]], env_extra=env_of(mini))
    assert p.returncode == 0, p.stdout + p.stderr
    assert create(mini).returncode == 0


def test_ledger_dict_missing_chapter_fails(mini):
    build_mini_store(mini["proj"], ledger_chapters={
        "chapter-001": {"state": "success"}, "chapter-009": {"state": "success"}})
    p = create(mini)
    assert p.returncode == 5, (p.returncode, p.stdout, p.stderr)
    assert "chapter-009" in (p.stdout + p.stderr)


def test_ledger_array_form_skips_with_schema_unknown(mini):
    import shutil
    shutil.rmtree(mini["store"])
    build_mini_store(mini["proj"], ledger_array=True)
    p = create(mini)
    assert p.returncode == 0, (p.returncode, p.stdout, p.stderr)
    meta = load_meta(mini["home"], one_gen(mini["home"]))
    assert meta.get("ledger_schema_unknown") is True


# ---------------------------------------------------------------- 锚 5:restore 门

def restore(mini, gen, extra=None, env_extra=None):
    args = ["restore", "--project-root", mini["proj"], "--home", mini["home"], "--id", gen] + (extra or [])
    return run_tool(args, env_extra={**env_of(mini), **(env_extra or {})})


def confirm_line(mini, gen, scope="store-all"):
    return "restore %s scope=%s root=%s" % (gen, scope, mini["proj"])


def test_restore_gate1_app_running_exit6(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    p = restore(mini, gen, extra=["--confirm", confirm_line(mini, gen)],
                env_extra={"MYSTUDIO_SNAPSHOT_APP_STATE": "running"})
    assert p.returncode == 6, (p.returncode, p.stdout, p.stderr)


def test_restore_gate4_confirm_mismatch_exit9(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    p = restore(mini, gen, extra=["--confirm", "wrong words"])
    assert p.returncode == 9, (p.returncode, p.stdout, p.stderr)
    assert confirm_line(mini, gen) in (p.stdout + p.stderr), "须打印正确确认语"


def test_restore_dry_run_no_disk_change_and_no_rescue_gen(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    victim = os.path.join(mini["store"], "characters.json")
    before = open(victim, encoding="utf-8").read()
    p = restore(mini, gen, extra=["--dry-run", "--scope", "assets"])
    assert p.returncode == 0, p.stdout + p.stderr
    for token in ("assets", "旁位", "跨域警告", "手册"):
        assert token in (p.stdout + p.stderr), token
    assert open(victim, encoding="utf-8").read() == before
    assert not any("pre-restore" in json.dumps(load_meta(mini["home"], g).get("label", ""))
                   for g in list_gens(mini["home"]))


def test_restore_full_pass_md5_rescue_and_lock_cleared(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    # 毁生产面:删一章分片 + 改 flat 文件
    victim_ch = os.path.join(mini["store"], "studio-workflow", "chapters", "chapter-001",
                             "novel-chapters-001-a1b2c3d4.json")
    victim_flat = os.path.join(mini["store"], "characters.json")
    os.remove(victim_ch)
    w(victim_flat, '{"v":9,"tampered":true}')
    p = restore(mini, gen, extra=["--confirm", confirm_line(mini, gen)])
    assert p.returncode == 0, (p.returncode, p.stdout, p.stderr)
    assert os.path.exists(victim_ch), "章分片复活"
    assert json.load(open(victim_flat, encoding="utf-8"))["v"] == 1, "flat 回滚到快照版"
    # 救援代在场且 meta 可读
    rescue = [g for g in list_gens(mini["home"])
              if load_meta(mini["home"], g).get("label", "").startswith("pre-restore-")]
    assert rescue, "救援代在场"
    assert load_meta(mini["home"], rescue[0])["files_index"]
    # 借用锁已清 + 旁位已清
    assert not os.path.exists(mini["autolock"])
    assert not any(d.startswith(".store-restore-") for d in os.listdir(mini["proj"]))


def test_restore_scope_studio_workflow_covers_extraction(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    victim_sw = os.path.join(mini["store"], "studio-workflow", "chapters", "chapter-001",
                             "agent-work-data-001-e5f6a7b8.json")
    victim_ex = os.path.join(mini["store"], "extraction", "extraction-run.json")
    os.remove(victim_sw)
    w(victim_ex, '{"broken":1}')
    p = restore(mini, gen, extra=["--scope", "studio-workflow", "--confirm",
                                  confirm_line(mini, gen, "studio-workflow")])
    assert p.returncode == 0, (p.returncode, p.stdout, p.stderr)
    assert os.path.exists(victim_sw)
    assert json.load(open(victim_ex, encoding="utf-8")).get("runId") == "r1", "extraction 恒联回滚"
    # 旁位已清
    assert not any(d.startswith(".store-restore-") for d in os.listdir(mini["proj"]))


def test_restore_gate2_bad_generation_exit7(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    os.remove(os.path.join(mini["home"], gen, "snapshot-meta.json"))
    p = restore(mini, gen, extra=["--confirm", confirm_line(mini, gen)])
    assert p.returncode == 7, (p.returncode, p.stdout, p.stderr)


# ---------------------------------------------------------------- 锚 5b:safe_mv/safe_cp

def test_safe_mv_cp_nested_defense(mini):
    os.makedirs(mini["home"], exist_ok=True)
    import shutil
    sys.path.insert(0, HERE)
    import store_snapshot as ss
    try:
        src = os.path.join(mini["proj"], "src-thing")
        os.makedirs(src)
        w(os.path.join(src, "a.json"), "A")
        # 嵌套防线:目标已存在 → 清残留 + journal 记 clobbered
        dst = os.path.join(mini["proj"], "dst-thing")
        os.makedirs(os.path.join(dst, "old"))
        w(os.path.join(dst, "old", "stale.json"), "stale")
        ss.safe_mv(src, dst, mini["home"])
        assert open(os.path.join(dst, "a.json"), encoding="utf-8").read() == "A"
        assert not os.path.exists(os.path.join(dst, "old"))
        jtxt = open(os.path.join(mini["home"], "journal.log"), encoding="utf-8").read()
        assert "clobbered" in jtxt
        # safe_cp 同防线
        src2 = os.path.join(mini["proj"], "src2")
        os.makedirs(src2)
        w(os.path.join(src2, "b.json"), "B")
        dst2 = os.path.join(mini["proj"], "dst2")
        os.makedirs(dst2)
        w(os.path.join(dst2, "stale2.json"), "stale")
        assert ss.safe_cp_dir(src2, dst2, mini["home"]) is True
        assert open(os.path.join(dst2, "b.json"), encoding="utf-8").read() == "B"
        assert not os.path.exists(os.path.join(dst2, "stale2.json"))
    finally:
        sys.path.remove(HERE)
        for m in [m for m in list(sys.modules) if m.startswith("store_snapshot")]:
            del sys.modules[m]


# ---------------------------------------------------------------- 锚 5c:门 1b 注入白名单

def test_injection_whitelist_tmp_yes_home_repo_no(mini):
    sys.path.insert(0, HERE)
    import store_snapshot as ss
    try:
        os.environ["MYSTUDIO_SNAPSHOT_APP_STATE"] = "running"
        assert ss.injection_active("/tmp/anything") is True
        assert ss.injection_active(os.path.join(mini["proj"])) is True  # var/folders
        homeish = os.path.join(os.path.expanduser("~"), "Projects", "fake")
        assert ss.injection_active(homeish) is False
        repoish = os.path.join(HERE, "somewhere")
        assert ss.injection_active(repoish) is False
        # 家目录路径:注入被忽略(不标 injected)
        running, pid, injected = ss.detect_app(homeish)
        assert injected is False
        running2, _, injected2 = ss.detect_app(mini["proj"])
        assert (running2, injected2) == (True, True)
        del os.environ["MYSTUDIO_SNAPSHOT_APP_STATE"]
    finally:
        os.environ.pop("MYSTUDIO_SNAPSHOT_APP_STATE", None)
        sys.path.remove(HERE)
        for m in [m for m in list(sys.modules) if m.startswith("store_snapshot")]:
            del sys.modules[m]


# ---------------------------------------------------------------- 锚 6:prune

def make_gen(home, gen_id, label=None):
    """snap-YYYYMMDD-HHMMSS → created_at=YYYY-MM-DDTHH:MM:SS(与代名一致)。"""
    gd = os.path.join(home, gen_id)
    os.makedirs(os.path.join(gd, "store"), exist_ok=True)
    ts = gen_id[5:]
    created_at = "%s-%s-%sT%s:%s:%s" % (ts[0:4], ts[4:6], ts[6:8], ts[9:11], ts[11:13], ts[13:15])
    meta = {"id": gen_id, "created_at": created_at,
            "app_state": "cold", "label": label or "", "tool_ver": "1",
            "files_index": {"x": 1}}
    w(os.path.join(gd, "snapshot-meta.json"), json.dumps(meta))


def test_prune_dry_run_deletes_nothing(mini):
    os.makedirs(mini["home"], exist_ok=True)
    for i in range(5):
        make_gen(mini["home"], "snap-2026010%d-000000" % (1 + i))
    p = run_tool(["prune", "--home", mini["home"], "--keep", "2"], env_extra=env_of(mini))
    assert p.returncode == 0, p.stdout + p.stderr
    assert len(list_gens(mini["home"])) == 5


def test_prune_apply_needs_confirm(mini):
    os.makedirs(mini["home"], exist_ok=True)
    for i in range(5):
        make_gen(mini["home"], "snap-2026010%d-000000" % (1 + i))
    p = run_tool(["prune", "--home", mini["home"], "--keep", "2", "--apply"],
                 env_extra=env_of(mini))
    assert p.returncode != 0
    assert len(list_gens(mini["home"])) == 5


def test_prune_lexicographic_rescue_meta_pattern(mini):
    os.makedirs(mini["home"], exist_ok=True)
    ids = ["snap-20260101-000000", "snap-20260102-000000", "snap-20260103-000000",
           "snap-20260104-000000", "snap-20260105-000000"]
    for i in ids:
        make_gen(mini["home"], i)
    # 救援代三个:仅最近 2 个豁免 → 最旧救援代应可删
    make_gen(mini["home"], "snap-20260101-000001", label="pre-restore-old")
    make_gen(mini["home"], "snap-20260106-000000", label="pre-restore-fresh")
    make_gen(mini["home"], "snap-20260106-000001", label="pre-restore-fresh2")
    # meta 缺失代:跳过不删
    os.makedirs(os.path.join(mini["home"], "snap-20260101-000002", "store"))
    # 模式外:不删
    os.makedirs(os.path.join(mini["home"], "manual-copy"))
    p = run_tool(["prune", "--home", mini["home"], "--keep", "3", "--apply",
                  "--confirm", "prune keep=3"], env_extra=env_of(mini))
    assert p.returncode == 0, p.stdout + p.stderr
    left = set(list_gens(mini["home"]))
    # 保留=字典序最新 3 个可删候选(20260104/05/06-救援新鲜代占位豁免…按实现:keep 计数内优先新)
    # 明确断言:最旧可删代 20260101-000000 与旧救援代 20260101-000001 已删
    assert "snap-20260101-000000" not in left
    assert "snap-20260101-000001" not in left, "超出最近2个的救援代可删"
    # meta 缺失代与模式外目录不动
    assert "snap-20260101-000002" in left
    assert os.path.isdir(os.path.join(mini["home"], "manual-copy"))
    # 最近救援代豁免在场
    assert "snap-20260106-000000" in left


def test_create_tail_prune_in_process(mini):
    # create 尾接 prune:同进程不重取锁;仅 1 代不误删
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    st = os.path.join(mini["home"], gen)
    assert os.path.isdir(st)


# ---------------------------------------------------------------- 锚 7:extraction 台账

def test_ledger_success_chapter_covered_then_rollback_restores_ledger(mini):
    # 台账 dict 语义:success 章在快照内可过;毁台账后回滚恢复
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    lp = os.path.join(mini["store"], "extraction", "extraction-run.json")
    orig = json.load(open(lp, encoding="utf-8"))
    w(lp, json.dumps({"version": 9, "chapters": {}}, ensure_ascii=False))
    p = restore(mini, gen, extra=["--scope", "extraction", "--confirm",
                                  confirm_line(mini, gen, "extraction")])
    assert p.returncode == 0, (p.returncode, p.stdout, p.stderr)
    assert json.load(open(lp, encoding="utf-8")) == orig


# ---------------------------------------------------------------- list/status

def test_list_and_status(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    p = run_tool(["list", "--home", mini["home"]], env_extra=env_of(mini))
    assert p.returncode == 0
    assert gen in p.stdout and "total=1" in p.stdout
    p = run_tool(["status", "--home", mini["home"]], env_extra=env_of(mini))
    assert p.returncode == 0
    assert "last_ok=" in p.stdout


def test_verify_deep_and_tamper(mini):
    assert create(mini).returncode == 0
    gen = one_gen(mini["home"])
    p = run_tool(["verify", "--project-root", mini["proj"], "--home", mini["home"],
                  "--id", gen, "--deep"], env_extra=env_of(mini))
    assert p.returncode == 0, p.stdout + p.stderr
    meta = load_meta(mini["home"], gen)
    assert meta.get("verify_status") == "PASS"
    assert meta.get("deep_md5")
    # 篡改一文件(白名单外)→ FAIL
    w(os.path.join(mini["home"], gen, "store", "characters.json"), '{"v":99}')
    p = run_tool(["verify", "--project-root", mini["proj"], "--home", mini["home"],
                  "--id", gen], env_extra=env_of(mini))
    assert p.returncode == 1
