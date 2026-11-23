#!/usr/bin/env python3
"""顶层带日期脚本迁入 campaigns/ 的迁移器(单元 F;任务 11-23-apps-architecture-cleanup)。

迁移集 = scripts_hygiene.scan() 的 RED 集 − 豁免集 − 留守集(候裁点 D13 平铺、D16 只迁 RED 300;
迁移集不自带正则,经 importlib 加载同目录 scripts_hygiene.py 取口径)。

留守集三部分(候裁点 D14):
  1. 硬清单 9 件:8 件测试执行依赖 + win_nightbatch_guard_1028.ps1(常驻生产守护件);
  2. 在途交集件:文件名以固定串出现在 .trellis/tasks 下 status 非 completed 的任务目录
     (排除本任务目录与 archive)即留守,理由「在途役占用(<任务目录名>)」;
  3. 静默门命中件:mtime 距今不足 30 分钟的候选不迁,逐件报告——瞬态挡板,不登记豁免
     (30 分钟后重跑即入迁移集;豁免条目只承载持久理由,避免瞬态信号固化成永久豁免)。

他人的备份副本(文件名以 .bak- 加日期结尾的未跟踪件)既不迁也不登记豁免,
输出单列为「他人在途件,不碰」。

用法:
  python3 scripts_dated_archive.py             # dry-run(默认):只打印清单,不动任何文件
  python3 scripts_dated_archive.py --apply     # 实迁:对迁移集逐件 git mv 到 campaigns/ 平铺同名
  python3 scripts_dated_archive.py --selftest  # 临时目录夹具自测,不碰现库
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPTS_DIR.parents[2]
CAMPAIGNS_DIR = SCRIPTS_DIR / "campaigns"
TASKS_DIR = REPO_ROOT / ".trellis" / "tasks"
SELF_TASK_DIR = "11-23-apps-architecture-cleanup"

HOLD_SECONDS = 30 * 60
BAK_RE = re.compile(r"\.bak-\d+$")

# 留守集第一部分:硬清单 9 件(implement.md Task F Step 3 逐件抄录)。
HARD_KEEP: dict[str, str] = {
    "multiseg_inline_facerefine_build_1118.py": "测试执行依赖(引用者)",
    "h3_template_to_api_1027.py": "测试执行依赖(引用者)",
    "daojie_sheet_workflow_build_1113.py": "测试执行依赖(引用者)",
    "daojie_sheet_workflow_qwen_build_1113.py": "测试执行依赖(引用者)",
    "director_console_v2_generate_1114.py": "测试执行依赖(引用者)",
    "inline_fire_runner_1118.py": "测试执行依赖(引用者)",
    "moss_daojie_build_1108.py": "测试执行依赖(引用者)",
    "qi21_local_face_mask_repair_1027.py": "测试执行依赖(引用者)",
    "win_nightbatch_guard_1028.ps1": "常驻生产守护件,被 .gitignore 白名单引用",
}


def _load_hygiene_module(scripts_dir: Path):
    """importlib 加载同目录 scripts_hygiene.py——RED 集与豁免集的口径唯一真源。"""
    path = scripts_dir / "scripts_hygiene.py"
    spec = importlib.util.spec_from_file_location("scripts_hygiene_loaded", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"无法加载 {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rg_appears(name: str, task_dir: Path) -> bool:
    """文件名是否以固定串出现在该任务目录(.trellis 整体被 gitignore,须 --hidden --no-ignore)。

    rg 不可用或超时直接抛错终止——静默降级会把在途役占用的件误判成可迁。
    """
    r = subprocess.run(
        ["rg", "-l", "-F", "--hidden", "--no-ignore", "--", name, str(task_dir)],
        capture_output=True, text=True, timeout=30, check=False,
    )
    return r.returncode == 0 and bool(r.stdout.strip())


def git_untracked(path: Path) -> bool:
    """git status --porcelain 判定未跟踪(?? 开头);git 不可用保守返回 False(照常参选)。"""
    try:
        r = subprocess.run(
            ["git", "-C", str(REPO_ROOT), "status", "--porcelain", "--", str(path)],
            capture_output=True, text=True, timeout=30, check=False,
        )
        return r.stdout.startswith("??")
    except (OSError, subprocess.SubprocessError):
        return False


def in_flight_task_dirs(tasks_dir: Path, self_task: str) -> list[Path]:
    """status 非 completed 的任务目录;排除本任务目录与 archive;无 task.json 的目录跳过。

    task.json 存在但读不出 status(损坏/缺字段)按在途计——留守方向保守,不丢件。
    """
    dirs: list[Path] = []
    if not tasks_dir.exists():
        return dirs
    for entry in sorted(tasks_dir.iterdir()):
        if not entry.is_dir() or entry.name in (self_task, "archive"):
            continue
        task_json = entry / "task.json"
        if not task_json.exists():
            continue
        try:
            status = json.loads(task_json.read_text(encoding="utf-8")).get("status")
        except (OSError, json.JSONDecodeError):
            status = None
        if status != "completed":
            dirs.append(entry)
    return dirs


def build_plan(*, hits: list[str], exemptions: dict[str, str], tasks_dirs: list[Path],
               sources_dir: Path, hard_keep: dict[str, str] | None = None,
               now: float | None = None, rg_check=None, untracked_check=None) -> dict:
    """把 RED 命中分拣成迁移 / 留守 / 他人备份三类。

    Args:
        hits: scripts_hygiene.scan() 的命中文件名(scan 已剔豁免,此处再显式减一次,幂等)。
        exemptions: scripts_hygiene.load_exemptions() 的豁免清单。
        tasks_dirs: 在途任务目录(in_flight_task_dirs 的产出)。
        sources_dir: 候选件所在目录(顶层 scripts 目录)。
        hard_keep: 硬清单(默认 HARD_KEEP;自测注入夹具清单)。
        now: 当前时间戳(自测注入;缺省 time.time())。
        rg_check: 文件名是否出现在某任务目录(自测注入;缺省 rg_appears)。
        untracked_check: 路径是否 git 未跟踪(自测注入;缺省 git_untracked)。

    Returns:
        {"migrate": [文件名], "keep": [{"name","reason","durable"}], "others": [文件名]};
        durable=True 的留守件才进豁免条目(exempt_entries)。
    """
    hard_keep = HARD_KEEP if hard_keep is None else hard_keep
    now = time.time() if now is None else now
    rg_check = rg_appears if rg_check is None else rg_check
    untracked_check = git_untracked if untracked_check is None else untracked_check
    migrate: list[str] = []
    keep: list[dict] = []
    others: list[str] = []
    for name in sorted(set(hits)):
        if name in exemptions:
            continue  # 豁免件:不迁不留守(scan 已剔,此处显式再减一次,幂等)
        if BAK_RE.search(name) and untracked_check(sources_dir / name):
            others.append(name)
            continue  # 他人备份副本:单列「他人在途件,不碰」
        if name in hard_keep:
            keep.append({"name": name, "reason": hard_keep[name], "durable": True})
            continue
        occupier = next((d.name for d in tasks_dirs if rg_check(name, d)), None)
        if occupier is not None:
            keep.append({"name": name, "reason": f"在途役占用({occupier})", "durable": True})
            continue
        path = sources_dir / name
        if path.exists() and now - path.stat().st_mtime < HOLD_SECONDS:
            keep.append({"name": name,
                         "reason": "静默门命中(mtime 距今不足 30 分钟;瞬态挡板,不登记豁免)",
                         "durable": False})
            continue
        migrate.append(name)
    return {"migrate": migrate, "keep": keep, "others": others}


def _rel(path: Path) -> Path:
    """仓库相对路径(不在仓库内时原样返回);清单与逆映射统一用它,输出可移植。"""
    try:
        return path.relative_to(REPO_ROOT)
    except ValueError:
        return path


def exempt_entries(plan: dict) -> list[tuple[str, str]]:
    """留守件里的持久理由件(硬清单 + 在途交集;静默门命中是瞬态挡板,不登记)。"""
    return [(k["name"], k["reason"]) for k in plan["keep"] if k["durable"]]


def resolve_action(source: Path, target: Path) -> str:
    """判定单件迁移动作:move / already-done / conflict / missing。"""
    src_there, dst_there = source.exists(), target.exists()
    if src_there and not dst_there:
        return "move"
    if dst_there and not src_there:
        return "already-done"
    if src_there and dst_there:
        return "conflict"
    return "missing"


def _git_mv(src: Path, dst: Path) -> int:
    """git mv 单件(实迁专用;campaigns/ 虽在 .gitignore,已跟踪件移入仍被跟踪)。"""
    r = subprocess.run(["git", "-C", str(REPO_ROOT), "mv", str(src), str(dst)],
                       timeout=60, check=False)
    return r.returncode


def apply_moves(plan: dict, scripts_dir: Path, campaigns_dir: Path) -> int:
    """实迁:逐件 git mv;目标已存在而源已不在记为已完成;源目标并存报冲突停下,不覆盖。

    完成后把逆映射清单(新路径到旧路径)完整打印到标准输出,供主会话存为任务档
    research/scripts-move-map.txt 回滚用。
    """
    campaigns_dir.mkdir(exist_ok=True)
    reverse: list[tuple[Path, Path]] = []
    done: list[str] = []
    for name in plan["migrate"]:
        src = scripts_dir / name
        dst = campaigns_dir / name
        action = resolve_action(src, dst)
        if action == "move":
            if _git_mv(src, dst) != 0:
                print(f"ABORT:git mv 失败({src});已迁 {len(reverse)} 件,停下不回滚。", file=sys.stderr)
                return 1
            reverse.append((dst, src))
        elif action == "already-done":
            done.append(name)
        else:
            print(f"ABORT:{name} 状态为 {action}(源目标并存/双双缺失),不覆盖,停下。", file=sys.stderr)
            return 1
    print(f"实迁完成:git mv {len(reverse)} 件;已完成(此前已迁){len(done)} 件。")
    print("逆映射清单(新路径 -> 旧路径;回滚逐件反向 git mv):")
    for dst, src in reverse:
        print(f"{_rel(dst)} -> {_rel(src)}")
    return 0


def print_dry_run(plan: dict, scripts_dir: Path, campaigns_dir: Path,
                  hits_total: int, exemptions_count: int) -> None:
    """dry-run 三段输出 + 他人备份单列(附节)+ 统计行。"""
    print("scripts_dated_archive dry-run(默认;--apply 才实迁,本跑未动任何文件)")
    print(f"口径:RED {hits_total} 件取自 scripts_hygiene.scan()(豁免 {exemptions_count} 件已在集外,"
          f"迁移集再显式减一次,幂等)= 迁移 + 留守 + 他人备份副本")
    print()
    print(f"一、迁移清单({len(plan['migrate'])} 件;--apply 时逐件 git mv 到 campaigns/ 平铺同名):")
    for name in plan["migrate"]:
        print(f"  {_rel(scripts_dir / name)} -> {_rel(campaigns_dir / name)}")
    print()
    print(f"二、留守清单({len(plan['keep'])} 件;逐件理由,不迁):")
    for k in plan["keep"]:
        print(f"  {k['name']}  {k['reason']}")
    print()
    entries = exempt_entries(plan)
    print(f"三、留守件的豁免条目({len(entries)} 件,持久理由;供并入 scripts-hygiene-exemptions.json,"
          f"一行一个 JSON 对象,键是顶层文件名,值是理由):")
    for name, reason in entries:
        print(json.dumps({name: reason}, ensure_ascii=False))
    print()
    print(f"附、他人在途件({len(plan['others'])} 件,不碰——既不迁也不登记豁免):")
    for name in plan["others"]:
        print(f"  {name}")
    print()
    print(f"统计:RED {hits_total} = 迁移 {len(plan['migrate'])} + 留守 {len(plan['keep'])} "
          f"+ 他人备份副本 {len(plan['others'])}")


def _selftest() -> int:
    """内嵌红绿自测:临时目录夹具 + 注入式检查器,不碰现库。"""
    failures: list[str] = []

    def expect(cond: bool, label: str) -> None:
        print(("PASS" if cond else "FAIL"), "-", label)
        if not cond:
            failures.append(label)

    def guard(label: str, fn) -> None:
        """跑一个情形;异常计为该情形 FAIL(RED 阶段功能未实现即如此呈现)。"""
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 —— 自测要吞一切异常计 FAIL,不中断其余情形
            print(f"FAIL - {label}(异常:{exc})")
            failures.append(label)

    def make_fixture(root: Path) -> Path:
        scripts = root / "scripts"
        scripts.mkdir()
        old, fresh = time.time() - 2 * HOLD_SECONDS, time.time() - 60
        for name in ("campaign_0928.py", "exempted_0928.py", "hardkept_1027.py", "inflight_1106.py"):
            (scripts / name).write_text("# 夹具\n", encoding="utf-8")
            os.utime(scripts / name, (old, old))  # 候选件 mtime 摆旧,避开静默门
        (scripts / "fresh_1113.py").write_text("# 夹具\n", encoding="utf-8")
        os.utime(scripts / "fresh_1113.py", (fresh, fresh))  # 恰为静默门命中件
        (scripts / "other_1019.py.bak-1123").write_text("# 他人备份副本\n", encoding="utf-8")
        os.utime(scripts / "other_1019.py.bak-1123", (old, old))
        return scripts

    hits = ["campaign_0928.py", "exempted_0928.py", "hardkept_1027.py",
            "inflight_1106.py", "fresh_1113.py", "other_1019.py.bak-1123"]

    def build(scripts: Path) -> dict:
        return build_plan(
            hits=hits,
            exemptions={"exempted_0928.py": "自测豁免"},
            tasks_dirs=[scripts.parent / "tasks" / "11-99-fake"],
            sources_dir=scripts,
            hard_keep={"hardkept_1027.py": "测试执行依赖(引用者)"},
            rg_check=lambda name, d: name == "inflight_1106.py",
            untracked_check=lambda p: p.name.endswith(".bak-1123"),
        )

    with tempfile.TemporaryDirectory(prefix="scripts-dated-archive-selftest-") as td:
        root = Path(td)
        scripts = make_fixture(root)

        def scenario_selected() -> None:
            plan = build(scripts)
            expect("campaign_0928.py" in plan["migrate"], "情形1:命中门禁且不在留守集的件被选中")

        def scenario_exempted() -> None:
            plan = build(scripts)
            touched = set(plan["migrate"]) | {k["name"] for k in plan["keep"]}
            expect("exempted_0928.py" not in touched, "情形2:豁免件不被选中")

        def scenario_hardkeep() -> None:
            plan = build(scripts)
            keeps = {k["name"]: k for k in plan["keep"]}
            ok = ("hardkept_1027.py" in keeps
                  and "hardkept_1027.py" not in plan["migrate"]
                  and keeps["hardkept_1027.py"]["reason"] == "测试执行依赖(引用者)")
            expect(ok, "情形3:留守件(硬清单)不被选中,理由原样带出")

        def scenario_already_done() -> None:
            campaigns = root / "campaigns"
            campaigns.mkdir()
            (campaigns / "moved_0928.py").write_text("# 已迁件\n", encoding="utf-8")
            action = resolve_action(scripts / "moved_0928.py", campaigns / "moved_0928.py")
            expect(action == "already-done", "情形4:目标已存在而源已不在时记为已完成")

        def scenario_inflight() -> None:
            plan = build(scripts)
            keeps = {k["name"]: k for k in plan["keep"]}
            ok = ("inflight_1106.py" in keeps
                  and keeps["inflight_1106.py"]["reason"] == "在途役占用(11-99-fake)"
                  and "inflight_1106.py" not in plan["migrate"])
            expect(ok, "加测:在途交集件留守,理由带任务目录名")

        def scenario_hold() -> None:
            plan = build(scripts)
            keeps = {k["name"] for k in plan["keep"]}
            exempt_names = {name for name, _ in exempt_entries(plan)}
            ok = ("fresh_1113.py" in keeps
                  and "fresh_1113.py" not in plan["migrate"]
                  and "fresh_1113.py" not in exempt_names)
            expect(ok, "加测:静默门命中件留守且不进豁免条目")

        def scenario_others_backup() -> None:
            plan = build(scripts)
            touched = set(plan["migrate"]) | {k["name"] for k in plan["keep"]}
            ok = ("other_1019.py.bak-1123" in plan["others"]
                  and "other_1019.py.bak-1123" not in touched)
            expect(ok, "加测:他人备份副本单列「他人在途件,不碰」,不迁不豁免")

        def scenario_task_dirs() -> None:
            tasks = root / "tasks"
            for name in ("11-01-done", "11-02-live", "11-03-self", "archive", "11-04-nojson"):
                (tasks / name).mkdir(parents=True)
            (tasks / "11-01-done" / "task.json").write_text('{"status": "completed"}', encoding="utf-8")
            (tasks / "11-02-live" / "task.json").write_text('{"status": "in_progress"}', encoding="utf-8")
            (tasks / "11-03-self" / "task.json").write_text('{"status": "in_progress"}', encoding="utf-8")
            dirs = in_flight_task_dirs(tasks, self_task="11-03-self")
            expect([d.name for d in dirs] == ["11-02-live"],
                   "加测:在途任务目录只取 status 非 completed,排除本任务与 archive")

        guard("情形1", scenario_selected)
        guard("情形2", scenario_exempted)
        guard("情形3", scenario_hardkeep)
        guard("情形4", scenario_already_done)
        guard("加测:在途交集", scenario_inflight)
        guard("加测:静默门", scenario_hold)
        guard("加测:他人备份", scenario_others_backup)
        guard("加测:在途任务目录", scenario_task_dirs)

    print(f"selftest: {len(failures)} failure(s)")
    return 1 if failures else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="顶层带日期脚本迁入 campaigns/(单元 F;默认 dry-run)")
    parser.add_argument("--apply", action="store_true",
                        help="实迁:对迁移集逐件 git mv 到 campaigns/(默认 dry-run 不动件)")
    parser.add_argument("--selftest", action="store_true", help="临时目录夹具自测,不碰现库")
    args = parser.parse_args(argv)
    if args.selftest:
        return _selftest()
    hygiene = _load_hygiene_module(SCRIPTS_DIR)
    hits = [h["file"] for h in hygiene.scan(SCRIPTS_DIR)]
    exemptions = hygiene.load_exemptions()
    plan = build_plan(
        hits=hits,
        exemptions=exemptions,
        tasks_dirs=in_flight_task_dirs(TASKS_DIR, SELF_TASK_DIR),
        sources_dir=SCRIPTS_DIR,
    )
    if args.apply:
        return apply_moves(plan, SCRIPTS_DIR, CAMPAIGNS_DIR)
    print_dry_run(plan, SCRIPTS_DIR, CAMPAIGNS_DIR,
                  hits_total=len(hits), exemptions_count=len(exemptions))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
