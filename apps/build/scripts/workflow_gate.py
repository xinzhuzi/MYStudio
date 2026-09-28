#!/usr/bin/env python3
"""workflow_gate —— 工作流手术验收一键化(四段,只读验收 + restore-from-temp 非破坏)。

出处:2026-09-28 任务 09-28-process-formalization S5(R2;design §4)。
独立细粒度入口(npm 别名 test:workflow);不挂 run-quality-gate stages(时长闸
R2.2:四段实测总时长与挂段决定见任务档 implement.md 执行记录)。

四段:
  1. generators  三生成器幂等重跑(restore-from-temp 非破坏设计)
  2. contract   四件契约测试(pytest 显式清单,ls 验存在)
  3. layout     布局棘轮(layout_check 交叉/遮挡数 vs workflow_layout_baseline.json,
                 只降不升:高=RED,低=PASS 附「可降基线」提示)
  4. placement  落位审计(workflow_placement_audit.py;仅 darwin,非 darwin 显式 SKIP;
                 「用户区零 json」单项 WARN 不拦门——裁定 B,详见下方段4 断言口径)

语义铁律(0928 生成器覆盖用户画布手调事故):检出「产物≠生成器」=用户画布手调是
合法态,只恢复原文件+报红,绝不把覆写当修复;报文必含
「若为画布手调请先备份对账,勿直接重跑生成器」。

段1 幂等判定口径(2026-09-28 落定):生成器输出 vs 跑前工作树存证逐字节对比——
语义等价于 design §4.1 的 `git diff --quiet`(干净树下「生成器零改写」判定);
工作树对 HEAD 已脏时(并行会话在场)git diff 对 HEAD 恒非零、不可作判定,故以
存证字节对比为准,git diff 原始退出码如实记入报告仅作佐证。
恢复恒做(try/finally):无论生成器成功/失败/超时,目标 JSON 一律以存证覆写回,
保证「只会被瞬时覆写后原样恢复」。

段3 棘轮基线口径:workflow_layout_baseline.json 以 `git show HEAD:<路径>` 提取态
确定(不取工作树态——并行会话脏件在途时工作树不是可锚定态);三 JSON 任一工作树
脏(vs HEAD)时本段显式 SKIP 且不影响整体退出 0(其余段全绿为前提)。

段4 断言口径(2026-09-28 主 agent 裁定 B):逐项解析 placement_audit 输出——唯一
FAIL 项「用户区零 json(会话恒零写入)」降为 WARN 不拦门(该项设计=「用户另存
除外→发现即报警」,用户自存是合法态;WARN 含件名+mtime+「是否属会话污染须人工
甄别」提示);其余项任一 FAIL → 段4 硬 RED;多项 FAIL(含该项)→ RED;解析不出
任何 PASS/FAIL 行 → 硬 RED(不吞失败)。

用法:
  python3 workflow_gate.py                  # 跑四段,任一 RED 退出 1
  python3 workflow_gate.py --json           # 同上,另落报告 apps/output/automation/workflow-gate-report.json
  python3 workflow_gate.py --rebuild-baseline  # 从 HEAD 提取态重建布局基线后退出(不跑四段)
"""
from __future__ import annotations

import ast
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import time

SCRIPTS = pathlib.Path(__file__).resolve().parent
REPO = SCRIPTS.parents[2]
PY = sys.executable or "python3"
APPS = REPO / "apps"

# 三生成器 → (目标常量名, 生成器脚本)。目标 JSON 路径一律从生成器头部常量
# AST 解析(禁手抄);常量名是生成器既有声明,非路径复制。
GENERATORS: list[tuple[str, str]] = [
    ("QI21_JSON", "qi21_daojie_t2i_0923.py"),
    ("I2I_JSON", "qi21_daojie_i2i_0924.py"),
    ("WF", "qwen21_edit_core_pe_0923.py"),
]

# 四件契约测试(design §4.2;ls 验存在,缺失即 RED 不 spawn pytest)
CONTRACT_TESTS: list[str] = [
    "backend/engines/comfyui/tests/test_daojie_handsfix_contract.py",
    "backend/engines/comfyui/tests/test_daojie_workflow_contract.py",
    "backend/engines/comfyui/tests/test_qwen21_workflow_contract.py",
    "backend/engines/comfyui/tests/test_superset_v3_contract.py",
]

LAYOUT_CHECK = REPO / ".agents/skills/node-graph/tools/layout_check.py"
PLACEMENT_AUDIT = SCRIPTS / "workflow_placement_audit.py"
BASELINE_JSON = SCRIPTS / "workflow_layout_baseline.json"
REPORT_JSON = REPO / "apps/output/automation/workflow-gate-report.json"

MANUAL_TUNING_HINT = "若为画布手调请先备份对账,勿直接重跑生成器(0928 覆盖事故语义铁律)"


# ── 段1 前置:生成器目标路径 AST 解析(白名单求值,禁手抄) ────────────────────

_ATTR_OK = {"Path", "path", "join", "normpath", "dirname", "resolve", "parents"}


def _eval_expr(node: ast.AST, env: dict) -> object:
    """对生成器头部常量表达式做白名单求值;任何超纲节点抛异常(该常量放弃)。"""
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        if node.id not in env:
            raise ValueError(f"名字不在白名单环境: {node.id}")
        return env[node.id]
    if isinstance(node, ast.Attribute):
        if node.attr not in _ATTR_OK:
            raise ValueError(f"属性不在白名单: {node.attr}")
        return getattr(_eval_expr(node.value, env), node.attr)
    if isinstance(node, ast.Call):
        func = _eval_expr(node.func, env)
        allowed = (os.path.join, os.path.normpath, os.path.dirname, pathlib.Path,
                   pathlib.Path.resolve)
        if func not in allowed and getattr(func, "__func__", None) not in allowed:
            raise ValueError("调用目标不在白名单")
        return func(*(_eval_expr(a, env) for a in node.args))
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Div):
        left, right = _eval_expr(node.left, env), _eval_expr(node.right, env)
        if not isinstance(left, (pathlib.PurePath, str)) or not isinstance(right, (pathlib.PurePath, str)):
            raise ValueError("除法仅允许路径拼接(pathlib /)")
        return pathlib.Path(left) / pathlib.Path(right)
    if isinstance(node, ast.Subscript):
        return _eval_expr(node.value, env)[_eval_expr(node.slice, env)]
    raise NotImplementedError(f"节点类型不在白名单: {type(node).__name__}")


def resolve_generator_targets() -> tuple[list[tuple[str, pathlib.Path, pathlib.Path]], list[str]]:
    """解析三生成器头部常量,返回 [(常量名, 生成器路径, 目标 JSON 绝对路径)] 与错误清单。"""
    pairs, errors = [], []
    for const_name, script_name in GENERATORS:
        gen_path = SCRIPTS / script_name
        try:
            tree = ast.parse(gen_path.read_text(encoding="utf-8"), filename=str(gen_path))
        except Exception as exc:  # noqa: BLE001(如实收集)
            errors.append(f"{script_name}: 解析失败 {exc}")
            continue
        env: dict = {"__file__": str(gen_path), "pathlib": pathlib, "os": os,
                     "Path": pathlib.Path}
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            try:
                value = _eval_expr(node.value, env)
            except Exception:  # noqa: BLE001(非路径常量不求值,跳过)
                continue
            for target in node.targets:
                if isinstance(target, ast.Name):
                    env[target.id] = value
        raw = env.get(const_name)
        if isinstance(raw, pathlib.PurePath):
            target_path = pathlib.Path(raw)
        elif isinstance(raw, str):
            target_path = pathlib.Path(raw)
        else:
            errors.append(f"{script_name}: 常量 {const_name} 未能解析为路径")
            continue
        pairs.append((const_name, gen_path, target_path.resolve()))
    return pairs, errors


# ── 段1:生成器幂等重跑(restore-from-temp 非破坏) ──────────────────────────


def _repo_rel(p: pathlib.Path) -> str:
    return p.relative_to(REPO).as_posix()


def stage_generators() -> dict:
    print("[workflow] 段1 RUN generators:三生成器幂等重跑(restore-from-temp 非破坏)")
    started = time.monotonic()
    pairs, errors = resolve_generator_targets()
    items, ok = [], not errors
    for const_name, gen_path, target in pairs:
        print(f"[workflow]   目标(生成器 {const_name} 头部常量解析):{_repo_rel(target)}")
        if not target.exists():
            items.append({"generator": gen_path.name, "target": _repo_rel(target),
                          "status": "failed", "reason": "目标 JSON 不存在(死路径)"})
            ok = False
            continue
        stash_dir = tempfile.mkdtemp(prefix="workflow-gate-stash-")
        stash = pathlib.Path(stash_dir) / target.name
        shutil.copyfile(target, stash)
        gen_exit: int | None = None
        reason = ""
        identical = False
        try:
            try:
                proc = subprocess.run([PY, str(gen_path)], capture_output=True,
                                      text=True, timeout=600)
                gen_exit = proc.returncode
                if proc.returncode != 0:
                    tail = (proc.stdout or "").strip().splitlines()[-3:]
                    reason = f"生成器 EXIT={proc.returncode};输出尾:{' | '.join(tail)}"
            except subprocess.TimeoutExpired:
                gen_exit = None
                reason = "生成器超时(>600s)被终止"
            identical = stash.read_bytes() == target.read_bytes()
            if gen_exit != 0:
                ok = False
                if not reason:
                    reason = f"生成器 EXIT={gen_exit}"
                reason += f";已用存证恢复原文件。{MANUAL_TUNING_HINT}"
            elif not identical:
                ok = False
                reason = (f"产物≠生成器(目标 JSON 与生成器输出不一致=可能含画布手调);"
                          f"已用存证恢复原文件,未采纳生成器覆写。{MANUAL_TUNING_HINT}")
        finally:
            # 恢复恒做:无论成败,目标 JSON 以跑前存证覆写回(瞬时覆写→原样恢复)
            shutil.copyfile(stash, target)
            shutil.rmtree(stash_dir, ignore_errors=True)
        # git diff 佐证(仅记录不作判定:工作树对 HEAD 脏时恒非零)
        git_diff = subprocess.run(["git", "diff", "--quiet", "--", str(target)],
                                  cwd=REPO, capture_output=True)
        status = "passed" if (gen_exit == 0 and identical) else "failed"
        items.append({"generator": gen_path.name, "constant": const_name,
                      "target": _repo_rel(target), "status": status,
                      "generatorExit": gen_exit, "identicalToPreRun": identical,
                      "gitDiffVsHeadExit": git_diff.returncode,
                      **({"reason": reason} if reason else {})})
        print(f"[workflow]   {status.upper():6s} {gen_path.name} → {_repo_rel(target)}"
              f"(gen_exit={gen_exit}, 跑前后一致={identical}, gitDiffVsHead={git_diff.returncode})")
        if status == "failed":
            print(f"[workflow]   └─ {reason}")
    for err in errors:
        print(f"[workflow]   FAILED 解析:{err}")
    duration = int((time.monotonic() - started) * 1000)
    return {"name": "generators", "status": "passed" if ok else "failed",
            "durationMs": duration, "items": items,
            **({"resolveErrors": errors} if errors else {})}


# ── 段2:契约测试 ─────────────────────────────────────────────────────────────


def stage_contract() -> dict:
    print("[workflow] 段2 RUN contract:四件契约测试(pytest)")
    started = time.monotonic()
    missing = [t for t in CONTRACT_TESTS if not (APPS / t).exists()]
    if missing:
        for t in missing:
            print(f"[workflow]   FAILED 契约件缺失:{t}")
        return {"name": "contract", "status": "failed",
                "durationMs": int((time.monotonic() - started) * 1000),
                "reason": f"契约件缺失 {len(missing)} 件,不 spawn pytest"}
    cmd = [PY, "-m", "pytest", *CONTRACT_TESTS, "-q"]
    env = dict(os.environ, PYTHONPATH="backend")
    proc = subprocess.run(cmd, cwd=APPS, capture_output=True, text=True, env=env,
                          timeout=600)
    out = (proc.stdout or "").strip()
    print("\n".join("  " + line for line in out.splitlines()))
    if proc.stderr.strip():
        print(f"[stderr] {proc.stderr.strip()}", file=sys.stderr)
    status = "passed" if proc.returncode == 0 else "failed"
    print(f"[workflow] 段2 {status.upper()} contract(exit={proc.returncode})")
    return {"name": "contract", "status": status, "durationMs":
            int((time.monotonic() - started) * 1000), "exitCode": proc.returncode,
            "command": " ".join(["pytest", *CONTRACT_TESTS, "-q"] + ["(cwd=apps, PYTHONPATH=backend)"])}


# ── 段3:布局棘轮(基线=HEAD 提取态;三 JSON 脏则显式 SKIP) ──────────────────


def _layout_crossings(json_path: pathlib.Path) -> dict | None:
    """跑 layout_check,解析尾行 LAYOUT_CHECK_JSON 契约;返回 {scope: counts}。"""
    proc = subprocess.run([PY, str(LAYOUT_CHECK), "--json", str(json_path)],
                          capture_output=True, text=True, timeout=300)
    line = next((l for l in reversed((proc.stdout or "").splitlines())
                 if l.startswith("LAYOUT_CHECK_JSON:")), None)
    if not line:
        return None
    payload = json.loads(line[len("LAYOUT_CHECK_JSON:"):])
    return {s["name"]: s["counts"] for s in payload.get("scopes", [])}


def _targets_rel() -> list[str]:
    pairs, errors = resolve_generator_targets()
    if errors:
        raise RuntimeError("生成器目标解析失败:" + ";".join(errors))
    return [_repo_rel(t) for _, _, t in pairs]


def _is_dirty(rel: str) -> bool:
    proc = subprocess.run(["git", "status", "--porcelain", "--", rel],
                          cwd=REPO, capture_output=True, text=True)
    return bool(proc.stdout.strip())


def rebuild_baseline() -> int:
    """从 git show HEAD:<路径> 提取态重建布局棘轮基线(不取工作树态)。"""
    head = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO,
                          capture_output=True, text=True).stdout.strip()
    files: dict[str, dict] = {}
    with tempfile.TemporaryDirectory(prefix="workflow-gate-baseline-") as tmp:
        for rel in _targets_rel():
            show = subprocess.run(["git", "show", f"HEAD:{rel}"], cwd=REPO,
                                  capture_output=True)
            if show.returncode != 0:
                print(f"[workflow] FAILED git show HEAD:{rel}(exit={show.returncode})")
                return 1
            tmp_json = pathlib.Path(tmp) / pathlib.Path(rel).name
            tmp_json.write_bytes(show.stdout)
            counts = _layout_crossings(tmp_json)
            if counts is None:
                print(f"[workflow] FAILED layout_check 未产出契约行:{rel}")
                return 1
            files[rel] = {"scopes": {name: {"crossings": c.get("crossings"),
                                            "occlusion": c.get("occlusion")}
                                     for name, c in counts.items()}}
            for name, c in sorted(counts.items()):
                print(f"[workflow]   基线 {pathlib.Path(rel).name} @ {name}: "
                      f"crossings={c.get('crossings')} occlusion={c.get('occlusion')}")
    baseline = {"generatedFrom": "git show HEAD:<路径> 提取态(不取工作树态)",
                "head": head,
                "rebuiltAt": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "files": files}
    BASELINE_JSON.write_text(json.dumps(baseline, ensure_ascii=False, indent=2) + "\n",
                             encoding="utf-8")
    print(f"[workflow] 基线落 {_repo_rel(BASELINE_JSON)}(HEAD={head})")
    return 0


def stage_layout() -> dict:
    print("[workflow] 段3 RUN layout:布局棘轮(只降不升;基线=HEAD 提取态)")
    started = time.monotonic()
    if not BASELINE_JSON.exists():
        print("[workflow]   FAILED 基线文件缺失,先跑 --rebuild-baseline")
        return {"name": "layout", "status": "failed",
                "durationMs": int((time.monotonic() - started) * 1000),
                "reason": "workflow_layout_baseline.json 缺失"}
    rels = _targets_rel()
    dirty = [rel for rel in rels if _is_dirty(rel)]
    if dirty:
        # 静默门:并行会话在途态不可锚定,显式 SKIP(不静默)
        print(f"[workflow] 段3 SKIP layout:三生产 JSON 工作树脏(vs HEAD),"
              f"棘轮不可锚定在途态——{', '.join(pathlib.Path(d).name for d in dirty)};"
              f"待其落定(提交/还原)后本段恢复运行;SKIP 不拦整体退出码")
        return {"name": "layout", "status": "skipped",
                "durationMs": int((time.monotonic() - started) * 1000),
                "reason": "三生产 JSON 工作树脏(vs HEAD),棘轮段显式 SKIP",
                "dirtyFiles": dirty}
    baseline = json.loads(BASELINE_JSON.read_text(encoding="utf-8"))
    items, ok, improvable = [], True, []
    for rel in rels:
        base_scopes = baseline.get("files", {}).get(rel, {}).get("scopes")
        if base_scopes is None:
            items.append({"file": rel, "status": "failed",
                          "reason": "基线缺此文件(scope 集变化),核账后 --rebuild-baseline"})
            ok = False
            continue
        cur = _layout_crossings(REPO / rel) or {}
        deltas = []
        for name, counts in cur.items():
            if name not in base_scopes:
                deltas.append(f"新增 scope「{name}」无基线,核账后 --rebuild-baseline")
                ok = False
                continue
            base = base_scopes[name]
            for key in ("crossings", "occlusion"):
                cur_v, base_v = counts.get(key, 0), base.get(key, 0)
                if cur_v > base_v:
                    deltas.append(f"{name}.{key} {cur_v} > 基线 {base_v}(棘轮只降不升)")
                    ok = False
                elif cur_v < base_v:
                    improvable.append(f"{rel}:{name}.{key} {base_v}→{cur_v}")
        gone = [n for n in base_scopes if n not in cur]
        status = "failed" if any("> 基线" in d or "无基线" in d for d in deltas) else "passed"
        items.append({"file": rel, "status": status, "current": cur,
                      **({"deltas": deltas} if deltas else {}),
                      **({"goneScopes": gone} if gone else {})})
        print(f"[workflow]   {status.upper():6s} {pathlib.Path(rel).name}"
              + (f" :: {'; '.join(deltas)}" if deltas else ""))
    if improvable:
        print(f"[workflow]   提示:以下指标低于基线,可在核账后 --rebuild-baseline 降基线:"
              f"{'; '.join(improvable)}")
    duration = int((time.monotonic() - started) * 1000)
    print(f"[workflow] 段3 {'SKIPPED' if dirty else ('PASSED' if ok else 'FAILED')} layout")
    return {"name": "layout", "status": "passed" if ok else "failed",
            "durationMs": duration, "items": items,
            **({"improvable": improvable} if improvable else {})}


# ── 段4:落位审计(仅 darwin;「用户区零 json」单项 WARN 不拦门,2026-09-28 裁定 B) ─


_AUDIT_LINE = re.compile(r"^(PASS|FAIL)\s{2}(.+?)(?:\s*::\s*(.+))?$")
USER_JSON_LABEL_PREFIX = "用户区零 json"  # 区别于「用户区零 MY- 残留」


def _user_area_jsons() -> list[dict]:
    """装机家用户区 *.json 清单(与 placement_audit 同判据 rglob,只读;供 WARN 带证)。"""
    home = pathlib.Path.home() / "Library/Application Support/漫影工作室/comfyui"
    user_wf = home / "ComfyUI/user/default/workflows"
    out = []
    if user_wf.exists():
        for p in sorted(user_wf.rglob("*.json")):
            out.append({"file": p.name, "mtime": time.strftime(
                "%Y-%m-%d %H:%M", time.localtime(p.stat().st_mtime))})
    return out


def stage_placement(platform: str) -> dict:
    started = time.monotonic()
    if platform != "darwin":
        print("[workflow] 段4 SKIP placement:非 darwin 平台(需装机家),显式跳过")
        return {"name": "placement", "status": "skipped", "durationMs": 0,
                "reason": f"平台={platform},placement_audit 需 darwin 装机家,显式 SKIP"}
    print("[workflow] 段4 RUN placement:落位审计(workflow_placement_audit.py)")
    proc = subprocess.run([PY, str(PLACEMENT_AUDIT)], capture_output=True,
                          text=True, timeout=300)
    out_lines = (proc.stdout or "").strip().splitlines()
    print("\n".join("  " + line for line in out_lines))
    if proc.stderr.strip():
        print(f"[stderr] {proc.stderr.strip()}", file=sys.stderr)
    parsed = [m for m in (_AUDIT_LINE.match(l) for l in out_lines) if m]
    fails = [m for m in parsed if m.group(1) == "FAIL"]
    user_json_fails = [m for m in fails
                       if m.group(2).startswith(USER_JSON_LABEL_PREFIX)]
    other_fails = [m for m in fails if m not in user_json_fails]
    warn: list[dict] | None = None
    if not parsed:
        status, reason = "failed", "placement_audit 输出无可解析 PASS/FAIL 行(不吞失败)"
    elif other_fails:
        status = "failed"
        reason = "其余项 FAIL:" + "; ".join(f"{m.group(2)}" for m in other_fails)
    elif user_json_fails:
        # 裁定 B:唯一 FAIL=「用户区零 json」→ PASS-with-WARN(用户自存合法态,人工甄别)
        status = "passed"
        warn = _user_area_jsons()
        reason = ""
        print(f"[workflow]   WARN 用户区存在 {len(warn)} 件 json(该项不拦门,裁定 B):")
        for item in warn:
            print(f"[workflow]     - {item['file']}(mtime {item['mtime']})")
        print("[workflow]     用户自存为合法态/是否属会话污染须人工甄别;是否清理由用户裁定")
    else:
        status, reason = "passed", ""
    if status == "failed":
        print(f"[workflow]   └─ {reason}")
    print(f"[workflow] 段4 {status.upper()}{'(PASS-with-WARN)' if warn else ''} "
          f"placement(audit exit={proc.returncode})")
    return {"name": "placement", "status": status,
            "durationMs": int((time.monotonic() - started) * 1000),
            "exitCode": proc.returncode,
            **({"reason": reason} if reason else {}),
            **({"warnUserAreaJsons": warn} if warn else {})}


# ── 编排 ─────────────────────────────────────────────────────────────────────


def main(argv: list[str]) -> int:
    if "--rebuild-baseline" in argv:
        return rebuild_baseline()
    as_json = "--json" in argv
    platform = "darwin" if sys.platform == "darwin" else "linux"
    started = time.monotonic()
    stages = [stage_generators(), stage_contract(), stage_layout(),
              stage_placement(platform)]
    total_ms = int((time.monotonic() - started) * 1000)
    ok = all(s["status"] != "failed" for s in stages)
    report = {"ok": ok, "platform": platform, "totalDurationMs": total_ms,
              "stages": stages, "jsonReport": as_json}
    if as_json:
        REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
        REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                               encoding="utf-8")
        print(f"[workflow] 报告落 {_repo_rel(REPORT_JSON)}")
    summary = ", ".join(f"{s['name']}={s['status']}({s['durationMs']}ms)" for s in stages)
    print(f"[workflow] 汇总:{'GREEN' if ok else 'RED'}(总时长 {total_ms}ms;{summary})")
    if total_ms > 120_000:
        print("[workflow] 提示:总时长超 120s 时长闸(R2.2)——保持独立命令,不默认挂 quality-gate")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
