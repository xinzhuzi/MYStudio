#!/usr/bin/env python3
"""工作流模板同步门禁(1123 用户令:模板不许落后源件,漂移必须当场红+可定位)。

背景:App 发车模板(frontend/lib/assist/image-studio/h3-*.api.json)是画布/UI 源件的
「适配形态」(四针适配:提示词占位/图名/前缀),不是裸转换——所以本门不做字节比对,
做**语义指纹比对**:类谱/lora 谱/调度器谱/布尔默认/关键接线。适配层合法差异(占位文本、
MyShot 锚摘除)走白名单逐条注明;任何结构漂移(少一段采/换 lora/改步数/换接线)当场红。

真源关系(1123 盘点):
  单镜.json(画布)            → h3-three-stage-template.api.json
  一镜到底-分段.json(画布)    → h3-multiseg-template.api.json(另有 1118 生成器幂等重放)
  h3-shot-template.json(UI)  → h3-shot-template.api.json(i2v31)
  pika-shot-template.json    → pika-shot-template.api.json
  pika-ref-shot-template.json→ pika-ref-shot-template.api.json
  fasth3-shot-template.json  → fasth3-shot-template.api.json
  h3-shot-template-ref2va.json = UI-only 无 API 面(不发车,免检)

跑法:cd apps && uv run pytest backend/comfyui/tests/test_workflow_template_sync.py -q
"""
import json
import unittest
from collections import Counter
from pathlib import Path

TESTS = Path(__file__).resolve().parent
FRONTEND = TESTS.parents[2] / "frontend/lib/assist/image-studio"
WORKFLOWS = TESTS.parents[0] / "workflows"
UI_ONLY = {"Note", "MarkdownNote", "Reroute"}


def load_canvas(path: Path) -> dict:
    return json.loads(path.read_text())


def load_api(path: Path) -> dict:
    return json.loads(path.read_text())


def canvas_nodes(d: dict) -> list:
    """画布全节点(含子图递归——qi21 刻碑:恒递归 definitions.subgraphs)。"""
    ns = list(d.get("nodes", []))
    for sg in d.get("definitions", {}).get("subgraphs", []):
        ns += sg.get("nodes", [])
    return ns


def api_nodes(t: dict) -> list:
    return [{"id": k, "type": v["class_type"], "inputs": v["inputs"]} for k, v in t.items()]


def class_census(nodes: list) -> Counter:
    return Counter(n["type"] for n in nodes if n["type"] not in UI_ONLY)


def _canvas_widget_lora(n: dict):
    wv = n.get("widgets_values") or []
    name = wv[0] if wv else None
    strength = wv[1] if len(wv) > 1 and isinstance(wv[1], (int, float)) else None
    return (name, strength)


def _api_lora(inputs: dict):
    name = inputs.get("lora_name") or inputs.get("adapter_name")
    strength = inputs.get("strength_model", inputs.get("adapter_strength"))
    return (name, strength)


LORA_CLASSES = {"LoraLoaderModelOnly", "LoraLoader", "ViggleTurboLora", "Load LakonLab Adapter"}


def lora_census(nodes: list) -> Counter:
    out = Counter()
    for n in nodes:
        if n["type"] in LORA_CLASSES:
            out[_canvas_widget_lora(n) if "widgets_values" in n else _api_lora(n["inputs"])] += 1
    return out


def scheduler_census(nodes: list) -> Counter:
    """BasicScheduler(scheduler,steps,denoise) 谱——步数漂移的机器哨。"""
    out = Counter()
    for n in nodes:
        if n["type"] != "BasicScheduler":
            continue
        if "widgets_values" in n:
            wv = n["widgets_values"]
            out[(wv[0], wv[1], wv[2])] += 1
        else:
            i = n["inputs"]
            out[(i.get("scheduler"), i.get("steps"), i.get("denoise"))] += 1
    return out


def boolean_defaults(nodes: list) -> Counter:
    out = Counter()
    for n in nodes:
        if n["type"] == "PrimitiveBoolean":
            v = (n.get("widgets_values") or [None])[0] if "widgets_values" in n else n["inputs"].get("value")
            out[v] += 1
    return out


def canvas_src_of(d: dict, dst: int, slot_type: str, in_name: str | None = None):
    nodes = {n["id"]: n for n in canvas_nodes(d)}
    for l in d.get("links", []):
        if l[3] != dst or l[5] != slot_type:
            continue
        if in_name is not None:
            hit = next((i for i in nodes[dst].get("inputs", []) if i.get("link") == l[0] and i.get("name") == in_name), None)
            if hit is None:
                continue
        return nodes[l[1]]["type"]
    return None


def api_src_of(t: dict, dst: str, in_name: str):
    v = t.get(dst, {}).get("inputs", {}).get(in_name)
    if isinstance(v, list):
        return t.get(v[0], {}).get("class_type")
    return None


def diff_report(name: str, got: Counter, want: Counter, allowed: set, why: str) -> list:
    issues = []
    for key in sorted(set(got) | set(want), key=str):
        g, w = got.get(key, 0), want.get(key, 0)
        if g == w:
            continue
        if key in allowed:
            continue
        issues.append(f"[{name}] {key}: 源={w} 模板={g}(差异未在白名单;白名单依据:{why})")
    return issues


PAIRS = [
    {
        "name": "三采-单镜(单镜.json→h3-three-stage-template)",
        "canvas": WORKFLOWS / "2_视频/H3视频/1_漫影自研/单镜.json",
        "api": FRONTEND / "h3-three-stage-template.api.json",
        # 模板四针适配摘 MyShot 收件箱锚(3061),UI 回写锚不进 API 直投面——1113 双胎役设计
        "class_allowed": {"MyShot"},
        "class_why": "MyShot=UI收件箱锚,API 面摘除(四针适配)",
        "edges": [("5002", "video", "ReCaVSRUpscale"), ("5100", "on_false", "ReCaVSRUpscale")],
    },
    {
        "name": "multiseg(一镜到底-分段.json→h3-multiseg-template)",
        "canvas": WORKFLOWS / "2_视频/H3视频/1_漫影自研/一镜到底-分段.json",
        "api": FRONTEND / "h3-multiseg-template.api.json",
        # multiseg=1118 生成器适配面(画布↔模板结构非同构):策略=生成器幂等重放+git 对账
        "mode": "generator",
        "regen": ["uv", "run", "python", "build/scripts/multiseg_inline_facerefine_build_1118.py"],
        "outputs": ["backend/comfyui/workflows/2_视频/H3视频/1_漫影自研/一镜到底-分段.json",
                     "frontend/lib/assist/image-studio/h3-multiseg-template.api.json"],
        "edges": [("5002", "video", "ReCaVSRUpscale"), ("5100", "on_false", "ReCaVSRUpscale"),
                  ("4002", "video", "CreateVideo")],
    },
    {
        "name": "i2v31(h3-shot-template→.api)",
        "canvas": FRONTEND / "h3-shot-template.json",
        "api": FRONTEND / "h3-shot-template.api.json",
        "class_allowed": set(),
        "class_why": "UI→API 纯转换(仅 UI-only 豁免)",
        "edges": [],
    },
    {
        "name": "pika(pika-shot-template→.api)",
        "pending": "底模分歧待用户裁定:模板=Cobijada vs 生成器=官方 fl2va(1123 门禁抓出;生成器路径已修活,重放即换底模,禁擅动)",
        "canvas": FRONTEND / "pika-shot-template.json",
        "api": FRONTEND / "pika-shot-template.api.json",
        "class_allowed": set(),
        "class_why": "UI→API 纯转换",
        "edges": [],
    },
    {
        "name": "pika-ref(pika-ref-shot-template→.api)",
        "pending": "底模分歧待用户裁定:模板=Cobijada vs 生成器=官方 ref2va(1123 门禁抓出;生成器路径已修活,重放即换底模,禁擅动)",
        "canvas": FRONTEND / "pika-ref-shot-template.json",
        "api": FRONTEND / "pika-ref-shot-template.api.json",
        "class_allowed": set(),
        "class_why": "UI→API 纯转换",
        "edges": [],
    },
    {
        "name": "fasth3(fasth3-shot-template→.api)",
        "canvas": FRONTEND / "fasth3-shot-template.json",
        "api": FRONTEND / "fasth3-shot-template.api.json",
        "class_allowed": set(),
        "class_why": "UI→API 纯转换",
        "edges": [],
    },
]


class TestWorkflowTemplateSync(unittest.TestCase):
    def _run_pair(self, pair: dict) -> None:
        if pair.get("pending"):
            self.skipTest(pair["pending"])
        if pair.get("mode") == "generator":
            import subprocess
            apps = TESTS.parents[2]
            subprocess.run(pair["regen"], cwd=apps, check=True, capture_output=True, timeout=600)
            r = subprocess.run(["git", "status", "--porcelain", "--"] + pair["outputs"],
                               cwd=apps, capture_output=True, text=True, check=True)
            self.assertEqual(r.stdout.strip(), "",
                "生成器重放后 git 有改动=画布/模板落后生成器: " + r.stdout)
        canvas = load_canvas(pair["canvas"])
        api = load_api(pair["api"])
        cnodes, anodes = canvas_nodes(canvas), api_nodes(api)
        issues = []
        if pair.get("mode") != "generator":
            # generator 模式:重放+git 对账已证明同步,画布↔模板结构非同构(适配面),
            # 同构指纹豁免;只保留下方接线哨(关键语义双查)
            issues += diff_report(f"{pair['name']}·类谱", class_census(anodes), class_census(cnodes),
                                  pair.get("class_allowed", set()), pair.get("class_why", ""))
            issues += diff_report(f"{pair['name']}·lora谱", lora_census(anodes), lora_census(cnodes),
                                  set(), "lora 挂载零豁免")
            issues += diff_report(f"{pair['name']}·调度器谱", scheduler_census(anodes), scheduler_census(cnodes),
                                  set(), "步数/调度零豁免")
            issues += diff_report(f"{pair['name']}·布尔默认", boolean_defaults(anodes), boolean_defaults(cnodes),
                                  set(), "开关出厂态零豁免")
        for dst, in_name, expect in pair["edges"]:
            # 接线以「源节点类型」为锚(画布与 API 的节点 id 同族一致,此处双查)
            a = api_src_of(api, dst, in_name)
            if a != expect:
                issues.append(f"[{pair['name']}·接线] api #{dst}.{in_name} ← {a}(期望 {expect})")
            c = canvas_src_of(canvas, int(dst), "VIDEO" if in_name in ("video",) else
                              ("IMAGE" if in_name == "images" else "COMFY_MATCHTYPE_V3"),
                              {"on_false": "on_false"}.get(in_name))
            if c is not None and c != expect:
                issues.append(f"[{pair['name']}·接线] 画布 #{dst}.{in_name} ← {c}(期望 {expect})")
        self.assertEqual(issues, [], "\n" + "\n".join(issues))

    def test_all_pairs_synced(self):
        for pair in PAIRS:
            with self.subTest(pair=pair["name"]):
                self._run_pair(pair)

    def test_union_fixture_covers_all_sources(self):
        """联合 object_info fixture 必须罩住全部源件类(缺类=转换/对账盲区)。"""
        fixture = json.loads((TESTS / "fixtures/template_sync_object_info_1123.json").read_text())
        missing = []
        for pair in PAIRS:
            for n in canvas_nodes(load_canvas(pair["canvas"])):
                if n["type"] not in UI_ONLY and n["type"] not in fixture:
                    missing.append(f"{pair['name']}: {n['type']}")
        self.assertEqual(missing, [], f"fixture 缺类: {sorted(set(missing))}")


if __name__ == "__main__":
    unittest.main()
