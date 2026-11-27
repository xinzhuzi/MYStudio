"""全库工作流布局机器门(11-26-workflow-layout-normalize Task 3;R7;AC2 AC3 AC4 AC6)。

把两个根(workflows/ 与 my_nodes/subgraphs/)下全部 GUI 件的三类布局问题钉住:
  - 分组互遮恒 0(group_overlap);
  - 节点出组框 / 贴边恒 0(node_out_of_group / edge_tight);
  - 例外:无解钉册件(UNRESOLVED_PINS,normalize 恒无解、--apply 按设计不写盘、
    A14 判定权在用户)按整治前实测数钉现状,只降不升——恶化即红、改善放行;
  - 间距过远只降不升(逐件逐作用域对 workflow_layout_far_baseline.json 棘轮);
  - 全库不动点检查(环境变量 LAYOUT_GATE_FIXED_POINT=1 开启,约 5 分钟);
  - 批处理脚本拒写断言(结构漂移不出半成品)。

默认轻量档:check_workflow(wf, layout={}, checks=("group_overlap",)) —— 只算组框
互遮与三个布局判据,全库数秒;线交叉 / 线遮仍归棘轮基线与批处理脚本管。

消费:
  - 判据层 .agents/skills/node-graph/tools/layout_check.py(Task 1 产物);
  - 整理层 .agents/skills/node-graph/tools/layout_normalize.py(Task 2 产物);
  - 批处理层 apps/build/scripts/workflow_layout_normalize_campaign.py(Task 4 产物)
    —— 按路径 importlib 载入,EXCLUDE 与文件圈定(iter_gui_files)从它导入,
    载入失败只让用到它的测试失败。
"""
from __future__ import annotations

import copy
import importlib.util
import json
import math
import os
import shutil
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[4]
COMFYUI = REPO / "apps" / "backend" / "comfyui"
TOOLS = REPO / ".agents" / "skills" / "node-graph" / "tools"
CAMPAIGN = REPO / "apps" / "build" / "scripts" / "workflow_layout_normalize_campaign.py"
FAR_BASELINE = COMFYUI / "tests" / "fixtures" / "workflow_layout_far_baseline.json"
SCRATCH = REPO / "apps" / "output" / "automation" / "layout-campaign" / "gate-scratch"
FIXED_POINT_ENV = "LAYOUT_GATE_FIXED_POINT"

if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))
import layout_check as lc  # noqa: E402  (技能工具,本地路径自举)
import layout_normalize as ln  # noqa: E402

# EXCLUDE 与文件圈定从批处理模块导入(Task 4 Step 4.3 起;单一份真源)。
# 载入失败不在此 raise,由 _load_campaign 报给测试体,只让用到的测试失败。
_CAMPAIGN_CACHE: dict = {}

# ── 无解件钉册(2026-11-27 终态;design §5.3「由机器门和不动点检查接着盯」)──
# 8 件无解件:档位梯子 × 四方位分离 + 并组重试后仍过不了守门(design §4 步骤 9),
# normalize 恒返回 None,--apply 按设计不写盘。处置=A14(grill-ledger:判定权在用户,
# 「用户可给这类件单独放宽容差后再跑 --apply --only」),门禁不得代用户选。
# 口径:零断言不适用钉册件,改按整治前实测数钉现状(只降不升)——恶化即红、改善放行;
# 数字来源 = apps/output/automation/workflow-layout-report.json「无解未写」清单的
# 逐作用域 before(2026-11-27 全库 --check 实测,并与当时盘上件逐一复核一致)。
# 钉册未列的作用域/判据按上限 0 断言(fail-closed);用户放宽容差收编某件后,
# 该件变全 0、钉条目自然通过但已过期,应删条目回归零断言。
UNRESOLVED_PINS = {
    "workflows/1_图片/QwenImage2.1/2_图生图/qi21-bfs-换头.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 5, "edge_tight": 6}},
    "workflows/1_图片/krea2/2_图生图/K2-无审查全家桶(4K放大+提示词增强).json": {
        "main": {"group_overlap": 7, "node_out_of_group": 11, "edge_tight": 32}},
    "workflows/1_图片/krea2/2_图生图/K2-角色设定-道劫.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 2, "edge_tight": 5}},
    "workflows/1_图片/krea2/3_改图/K2-图像编辑-整合流.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 0, "edge_tight": 20}},
    "workflows/1_图片/krea2/5_风格扩展/K2-风格扩展流（图生图版）.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 0, "edge_tight": 7}},
    "workflows/2_视频/H3视频/2_固定线/社区-480P生成-960P精修-SolAttn加速-960P直出.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 2, "edge_tight": 2}},
    "workflows/2_视频/H3视频/7_测试/社区-H3小脸修复-SAM.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 2, "edge_tight": 13}},
    "workflows/2_视频/H3视频/7_测试/社区-H3终极三采v2版.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 4, "edge_tight": 6}},
    # 1127 晚重跑追加:fasth3 i2v/t2v —— 整治解在 12 轮不动点迭代内不收敛,
    # 批处理幂等闸 fail-closed 拒写(非无解,是不稳定),盘上留整治前布局。
    # 钉现状只降不升,同上;数字 = 重建后全库 --check 的逐作用域 before。
    "workflows/2_视频/H3视频/6_视频重制/fasth3-单镜视频-i2v.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 3, "edge_tight": 1}},
    "workflows/2_视频/H3视频/6_视频重制/fasth3-单镜视频-t2v.json": {
        "main": {"group_overlap": 0, "node_out_of_group": 3, "edge_tight": 1}},
}


def _load_campaign() -> dict:
    if "mod" in _CAMPAIGN_CACHE:
        return _CAMPAIGN_CACHE
    mod, err = None, None
    try:
        if not CAMPAIGN.exists():
            err = f"批处理模块缺失: {CAMPAIGN}(11-26-workflow-layout-normalize Task 4 产物)"
        else:
            spec = importlib.util.spec_from_file_location(
                "workflow_layout_normalize_campaign", CAMPAIGN)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
    except Exception as e:  # 载入失败(语法错等)同样留给测试体报告
        mod, err = None, f"批处理模块载入失败: {CAMPAIGN}: {type(e).__name__}: {e}"
    _CAMPAIGN_CACHE["mod"], _CAMPAIGN_CACHE["err"] = mod, err
    return _CAMPAIGN_CACHE


@pytest.fixture(scope="session")
def gate_survey():
    """对每件各算一次轻量档检查并缓存:
    {rel_key: {"path": Path, "doc": 解析后文档, "reports": check_workflow 结果}}。
    范围 = 批处理模块的 iter_gui_files()(两个根下 GUI 件 − EXCLUDE)。"""
    load = _load_campaign()
    if load["mod"] is None:
        pytest.fail(f"批处理模块不可用({load['err']}),布局门无从圈定范围")
    cache = {}
    for rel, path in load["mod"].iter_gui_files():
        doc = json.loads(path.read_text(encoding="utf-8"))
        cache[rel] = {"path": path, "doc": doc,
                      "reports": lc.check_workflow(doc, layout={}, checks=("group_overlap",))}
    return cache


@pytest.fixture(scope="session")
def campaign():
    """批处理模块(Task 4 产物);载入失败留给测试体 fail,不报成 fixture ERROR。"""
    return _load_campaign()


def _layout_total(rep, key):
    return (rep.get("layout") or {}).get(key, 0)


# ── 机器门:轻量档常开 ────────────────────────────────────────────────

def test_group_overlap_is_zero(gate_survey):
    """分组互遮(1007 用户令「组与组之间不能重叠」)每件每作用域恒 0;
    无解钉册件(UNRESOLVED_PINS,A14 用户取舍待定)改按整治前实测数只降不升。"""
    bad = []
    for rel, item in sorted(gate_survey.items()):
        pinned = rel in UNRESOLVED_PINS
        for rep in item["reports"]:
            n = rep["counts"]["group_overlap"]
            scope_pin = UNRESOLVED_PINS.get(rel, {}).get(rep["name"])
            cap = (scope_pin or {}).get("group_overlap", 0)
            if n > cap:
                if pinned and scope_pin is None:
                    bad.append(f"{rel} [{rep['name']}] 互遮 {n} 对(钉册缺该作用域条目)")
                else:
                    tag = f"(钉册上限 {cap};只降不升)" if pinned else ""
                    bad.append(f"{rel} [{rep['name']}] 互遮 {n} 对{tag}")
    assert not bad, (
        "分组互遮未清零(整治前现状;--apply 后应恒 0;无解钉册件按 A14 钉现状):\n  "
        + "\n  ".join(bad))


def test_nodes_inside_groups(gate_survey):
    """节点出组框与贴边每件每作用域恒 0(非 Reroute 节点);
    无解钉册件(UNRESOLVED_PINS,A14 用户取舍待定)改按整治前实测数只降不升。"""
    problems = []
    for rel, item in sorted(gate_survey.items()):
        pinned = rel in UNRESOLVED_PINS
        for rep in item["reports"]:
            scope_pin = UNRESOLVED_PINS.get(rel, {}).get(rep["name"])
            for key, label in (("node_out_of_group", "出组框"), ("edge_tight", "贴边")):
                n = _layout_total(rep, key)
                cap = (scope_pin or {}).get(key, 0)
                if n > cap:
                    if pinned and scope_pin is None:
                        problems.append(f"{rel} [{rep['name']}] {label} {n} 节点(钉册缺该作用域条目)")
                    else:
                        tag = f"(钉册上限 {cap};只降不升)" if pinned else ""
                        problems.append(f"{rel} [{rep['name']}] {label} {n} 节点{tag}")
    assert not problems, (
        "节点出组框 / 贴边未清零(整治前现状;--apply 后应恒 0;无解钉册件按 A14 钉现状):\n  "
        + "\n  ".join(problems))


def test_spacing_far_not_worse_than_baseline(gate_survey):
    """间距过远只降不升:每件每作用域 spacing_far ≤ 棘轮基线。
    基线缺失或某件不在基线里按上限 0 断言。"""
    base_files = {}
    if FAR_BASELINE.exists():
        try:
            base_files = json.loads(FAR_BASELINE.read_text(encoding="utf-8")).get("files", {})
        except Exception as e:  # 基线损坏按缺失处理,同样点名提示重建
            base_files = {}
            print(f"WARNING: 间距基线件不可读({FAR_BASELINE}): {e}")
    hint = "先跑 `--apply --only <路径>` 再 `--write-far-baseline`"
    bad = []
    for rel, item in sorted(gate_survey.items()):
        scopes = base_files.get(rel, {}).get("scopes", {})
        for rep in item["reports"]:
            n = _layout_total(rep, "spacing_far")
            cap = scopes.get(rep["name"], 0)
            if n > cap:
                tag = "基线缺失" if rel not in base_files else "超出基线"
                bad.append(f"{rel} [{rep['name']}] spacing_far {n} > 上限 {cap}({tag};{hint})")
    assert not bad, (
        "间距过远棘轮被顶(只降不升):\n  " + "\n  ".join(bad))


def test_normalize_preserves_structural_key_absence():
    """R4/R6:原文档没有的结构键(groups/extra)不得新增——稀疏件(子图蓝图等)
    被注入空壳键就是结构漂移:批处理按 strip_mismatch 拒写,不动点检查也永不成真。
    (1127 回归发现:9 蓝图 + 3 宿主因此被 apply 拒写。)"""
    doc = {"nodes": [{"id": 1, "type": "MarkdownNote", "pos": [0, 0], "size": [200, 60],
                      "order": 0, "mode": 0, "properties": {}},
                     {"id": 2, "type": "MarkdownNote", "pos": [400, 0], "size": [200, 60],
                      "order": 1, "mode": 0, "properties": {}}],
           "links": [], "last_node_id": 2, "last_link_id": 0}
    out, rep = ln.normalize(copy.deepcopy(doc))
    assert out is not None, "两节点稀疏件应可解"
    assert "groups" not in out, "原文档无 groups 键,normalize 不得新增(结构漂移)"
    # extra.ds 视图态是设计特性(§4 step 11),允许补写;但空 extra 容器不得残留
    # 在结构对拍里(strip 白名单:ds 摘除后变空的 extra 视同无键)。
    assert ln.strip_layout(doc) == ln.strip_layout(out), \
        "结构对拍(剔布局字段)应全等——新增只许落在白名单路径上"
    out2, _rep2 = ln.normalize(copy.deepcopy(out))
    assert out2 == out, "一次整治后应是不动点"


def test_structural_compare_tolerates_designed_group_merges():
    """R6 对拍补齐(1127 回归):组合并是设计动作(design §6 步骤 9,标题「A + B」),
    apply/sync 的结构对拍须豁免「幸存组按原序留任(仅 title 可变)、被并组按 id
    消失」;节点删除、新造组、幸存组字段漂移、幸存组重排仍须判不等。"""
    def grp(i, t, extra=None):
        g = {"id": f"g{i}", "title": t, "bounding": [i * 10, 0, 100, 100],
             "color": "#a33", "flags": {}}
        if extra:
            g.update(extra)
        return g
    nodes = [{"id": 1, "type": "N", "pos": [0, 0], "size": [10, 10], "properties": {}}]
    old = {"nodes": copy.deepcopy(nodes), "links": [],
           "groups": [grp(1, "G1"), grp(2, "G2", {"locked": True})]}

    # ① 设计内合并:G2 并入 G1(标题 A + B,幸存组其余字段原样)→ 相等
    merged = {"nodes": copy.deepcopy(nodes), "links": [],
              "groups": [dict(grp(1, "G1 + G2"), bounding=[0, 0, 200, 100])]}
    assert ln.structurally_equal(old, merged), "设计内并组被误判为结构漂移"
    # ② 节点被删 → 不等(sabotage 语义)
    missing_node = {"nodes": [], "links": [], "groups": copy.deepcopy(old["groups"])}
    assert not ln.structurally_equal(old, missing_node), "节点删除未被对拍拦下"
    # ③ 新造组(新 id)→ 不等
    invented = {"nodes": copy.deepcopy(nodes), "links": [],
                "groups": [grp(1, "G1"), grp(2, "G2"), grp(3, "G3")]}
    assert not ln.structurally_equal(old, invented), "新造组未被对拍拦下"
    # ④ 幸存组字段漂移(color 变)→ 不等
    mutated = {"nodes": copy.deepcopy(nodes), "links": [],
               "groups": [dict(grp(1, "G1 + G2"), color="#0f0")]}
    assert not ln.structurally_equal(old, mutated), "幸存组字段漂移未被对拍拦下"
    # ⑤ 幸存组重排 → 不等
    reordered = {"nodes": copy.deepcopy(nodes), "links": [],
                 "groups": [grp(2, "G2", {"locked": True}), grp(1, "G1")]}
    assert not ln.structurally_equal(old, reordered), "幸存组重排未被对拍拦下"


def test_normalize_tolerance_is_pinned_to_the_original_document():
    """R4 不动点(1127 回归修正):callable 容差须按「整治前原件」取数并全程钉死。
    相对容差逐轮按当前文档重算会让容差边界件振荡不收敛(t2i-通用 实测子图交叉
    39→41→44 循环),apply 只能按 not_idempotent 拒写、门清不了零。钉死后连续
    normalize 至不动点,且对不动点再解一次必须原样。"""
    rel = COMFYUI / "workflows/1_图片/QwenImage2.1/1_文生图/t2i-通用.json"
    doc = json.loads(rel.read_text(encoding="utf-8"))

    def cross_tol(scope, before):
        return {"crossings": max(3, math.ceil(float(before.get("crossings", 0)) * 0.1))}

    a, ra = ln.normalize(copy.deepcopy(doc), tol=cross_tol)
    assert a is not None, "有解件不得判无解"
    b, _rb = ln.normalize(a, tol=cross_tol)
    c, _rc = ln.normalize(b, tol=cross_tol)
    assert b == c, f"钉死容差后第二轮应是不动点(仍移动=振荡未修: a={ra is not None})"


# ── 全库不动点(约 5 分钟,环境变量开启) ──────────────────────────────

def test_files_are_fixed_points(gate_survey, campaign):
    """每件都是整理器的不动点:normalize(读入件) 与读入件深度相等。
    容差须与批处理 --apply 同一配置(Q3 裁决 cross_tol;design §5.3):
    容差边界件(如 t2i-通用)在严格档会振荡,并非真非不动点(1127 实测)。"""
    if os.environ.get(FIXED_POINT_ENV) != "1":
        pytest.skip("全库不动点检查约 5 分钟,由批处理脚本 --check 或本环境变量开启"
                    f"({FIXED_POINT_ENV}=1)")
    if campaign["mod"] is None:
        pytest.fail(campaign["err"])
    cross_tol = campaign["mod"].cross_tol
    tol = lambda scope, before: cross_tol(before) or {}  # noqa: E731  同 campaign._tol_fn 适配
    bad = []
    for rel, item in sorted(gate_survey.items()):
        doc, rep = ln.normalize(item["doc"], tol=tol)
        if doc == item["doc"]:
            continue
        if rel in UNRESOLVED_PINS:
            # 钉册件跳过不动点断言(1127 晚):钉册含两类件——无解件(normalize
            # 恒 None,A14 用户取舍待定)与拒写件(如 fasth3 i2v/t2v:试算能解出
            # 但解在 12 轮迭代内不收敛,幂等闸 fail-closed 拒写)。两类盘上都不是
            # 不动点,这是登记时已知且接受的终态;它们的现状由钉册在其他两个
            # 测试里按「只降不升」盯。这里只对钉册外的件断言不动点。
            continue
        elif doc is None:
            bad.append(f"{rel}: 无解(normalize 返回 None)——新无解件须先出报告呈报,"
                       "经用户处置(A14)后补进 UNRESOLVED_PINS")
        else:
            bad.append(f"{rel}: 非不动点")
    assert not bad, ("不动点检查失败(文件 ≠ normalize(文件)):\n  " + "\n  ".join(bad))


# ── 批处理脚本拒写断言 ────────────────────────────────────────────────

def test_campaign_refuses_structural_drift(campaign, monkeypatch):
    """结构漂移不出半成品: sabotage normalize 删一个节点后,apply_one 必须
    拒写(written=False, reason="strip_mismatch"),文件字节不变。"""
    if campaign["mod"] is None:
        pytest.fail(campaign["err"])
    campaign = campaign["mod"]
    # 选体量最小且可解的一件,拷到 apps/output/ 下的临时位;动的是拷贝不是真源。
    cands = []
    for rel, path in campaign.iter_gui_files():
        cands.append((path.stat().st_size, rel, path))
    cands.sort(key=lambda t: (t[0], t[1]))
    target = None
    for _size, rel, path in cands:
        doc = json.loads(path.read_text(encoding="utf-8"))
        real_doc, _rep = campaign.normalize(copy.deepcopy(doc))
        if real_doc is not None:
            target = (rel, path)
            break
    assert target is not None, "没有可解的 GUI 件,拒写测试无从搭台"
    rel, src = target

    SCRATCH.mkdir(parents=True, exist_ok=True)
    work = SCRATCH / Path(src).name
    shutil.copy2(src, work)
    before_bytes = work.read_bytes()
    try:
        real_normalize = campaign.normalize

        def sabotaged(wf, **kwargs):
            doc, rep = real_normalize(wf, **kwargs)
            if doc is not None and doc.get("nodes"):
                doc = copy.deepcopy(doc)
                doc["nodes"].pop()          # 结构漂移:删掉一个节点
            return doc, rep

        monkeypatch.setattr(campaign, "normalize", sabotaged)
        result = campaign.apply_one(work)
        assert result["written"] is False, f"结构漂移竟被写盘: {result}"
        assert result["reason"] == "strip_mismatch", f"拒写原因不对: {result}"
        assert work.read_bytes() == before_bytes, "拒写后文件字节变了"
    finally:
        monkeypatch.undo()
        shutil.rmtree(SCRATCH, ignore_errors=True)


def test_far_baseline_ratchet(campaign):
    """merge_far_baseline 棘轮:新值调低则更新、新件则加入、调高抛 ValueError、
    两次合并结果字节相同。"""
    if campaign["mod"] is None:
        pytest.fail(campaign["err"])
    campaign = campaign["mod"]
    merge = campaign.merge_far_baseline
    old = {"files": {
        "a.json": {"scopes": {"main": 5}},
        "b.json": {"scopes": {"main": 3, "sub:x": 7}},
    }}
    # 新值调低 → 更新
    merged = merge(old, {"files": {"a.json": {"scopes": {"main": 2}}}})
    assert merged["files"]["a.json"]["scopes"]["main"] == 2
    assert merged["files"]["b.json"]["scopes"] == {"main": 3, "sub:x": 7}
    # 新件 → 加入
    merged2 = merge(old, {"files": {"c.json": {"scopes": {"main": 9}}}})
    assert merged2["files"]["c.json"]["scopes"]["main"] == 9
    # 新值调高 → ValueError
    with pytest.raises(ValueError):
        merge(old, {"files": {"b.json": {"scopes": {"main": 4}}}})
    with pytest.raises(ValueError):
        merge(old, {"files": {"b.json": {"scopes": {"sub:x": 8}}}})
    # 两次合并结果字节相同(幂等)
    new = {"files": {"a.json": {"scopes": {"main": 1}},
                     "d.json": {"scopes": {"main": 6}}}}
    m1 = merge(old, new)
    m2 = merge(m1, new)
    assert json.dumps(m1, ensure_ascii=False, sort_keys=True).encode("utf-8") == \
        json.dumps(m2, ensure_ascii=False, sort_keys=True).encode("utf-8")
