#!/usr/bin/env python3
"""Build the App API template from the selected saved QI2.1 canvas arm.

Turbo uses the canvas base→Fix×0.5→official avg_rank_178×1.0 chain.
Explicit viggle/native selections retain their real canvas dependencies.
PE, type, sigma, model and sampler values come from saved product controls.
SaveImage and SeedVR2 outputs and prompt/negative/seed bindings stay intact.
Use --object-info for an offline schema snapshot; --validate is opt-in generation.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CANVAS = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qi21-道劫-t2i.json"
OUT = REPO / "apps/backend/engines/comfyui/workflows/1_图片/Q2-1图像/1_文生图/qwen21-道劫-t2i-api.json"
ENGINE = None

SG6 = "96937bbe-99d1-4f16-a06c-d86b57815d91"
SG7 = "e7b9d4a2-3c5f-4e61-8d70-9f2a5c8b4d6e"


def engine_base() -> str:
    manifest = Path.home() / 'Library/Application Support/漫影工作室/comfyui/manifest.json'
    port = json.loads(manifest.read_text(encoding='utf-8'))['engine']['port']
    if not isinstance(port, int) or isinstance(port, bool) or not 0 < port < 65536:
        raise ValueError('managed manifest engine.port is invalid')
    return f'http://127.0.0.1:{port}'


def object_info(snapshot: Path | None = None) -> dict:
    if snapshot is not None:
        return json.loads(snapshot.read_text(encoding='utf-8'))
    with urllib.request.urlopen(f'{engine_base()}/object_info', timeout=30) as response:
        return json.load(response)


def flatten_canvas(workflow: dict, info: dict) -> dict:
    definitions = {subgraph['id']: subgraph for subgraph in workflow.get('definitions', {}).get('subgraphs', [])}
    root_nodes = {node['id']: node for node in workflow['nodes']}
    root_links = {link[0]: dict(zip(('id', 'origin_id', 'origin_slot', 'target_id', 'target_slot', 'type'), link)) for link in workflow['links']}
    scopes: dict[str, tuple[dict, dict, dict, dict | None]] = {'': (workflow, root_nodes, root_links, None)}
    for host in root_nodes.values():
        if host['type'] in definitions:
            subgraph = definitions[host['type']]
            scopes[f"{host['id']}:"] = (subgraph, {node['id']: node for node in subgraph['nodes']}, {link['id']: link for link in subgraph['links']}, host)

    def resolve(scope: str, node_id: int, slot: int, seen: tuple = ()):
        marker = (scope, node_id, slot)
        if marker in seen:
            raise ValueError(f'canvas dependency cycle: {marker}')
        seen = (*seen, marker)
        graph, nodes, links, host = scopes[scope]
        if node_id == -10:
            if host is None:
                raise ValueError('root graph cannot resolve a subgraph boundary input')
            name = graph['inputs'][slot]['name']
            host_slot = next((entry for entry in host['inputs'] if entry['name'] == name), {})
            if host_slot.get('link') is not None:
                link = root_links[host_slot['link']]
                return resolve('', link['origin_id'], link['origin_slot'], seen)
            named = host.get('widgets_values_named', {})
            if name in named:
                return named[name]
            promoted = [entry['name'] for entry in host['inputs'] if 'widget' in entry]
            if name in promoted:
                return host['widgets_values'][promoted.index(name)]
            return None
        node = nodes[node_id]
        if node.get('mode', 0) in (2, 4):
            return None
        if node['type'] in definitions:
            inner_scope = f'{node_id}:'
            subgraph = definitions[node['type']]
            link = next(link for link in subgraph['links'] if link['target_id'] == -20 and link['target_slot'] == slot)
            return resolve(inner_scope, link['origin_id'], link['origin_slot'], seen)
        if node['type'] == 'Reroute':
            link = links[next(entry['link'] for entry in node['inputs'] if entry.get('link') is not None)]
            return resolve(scope, link['origin_id'], link['origin_slot'], seen)
        return [f'{scope}{node_id}', slot]

    graph = {}
    output_keys = []
    scalar_types = {'INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'}
    controls = {'fixed', 'randomize', 'increment', 'decrement'}
    for scope, (_, nodes, links, _) in scopes.items():
        for node in nodes.values():
            cls = node['type']
            if cls in definitions or cls in ('Reroute', 'Note', 'MarkdownNote') or node.get('mode', 0) in (2, 4):
                continue
            schema = info[cls]
            specs = {name: spec for group in ('required', 'optional') for name, spec in schema['input'].get(group, {}).items()}
            values = [value for value in node.get('widgets_values', []) if not (isinstance(value, str) and value in controls)]
            widget_names = [name for name, spec in specs.items() if (isinstance(spec[0], list) or spec[0] in scalar_types) and not (len(spec) > 1 and isinstance(spec[1], dict) and spec[1].get('forceInput'))]
            inputs = dict(zip(widget_names, values))
            if cls == 'TextGenerate':
                from qi21_i2i_workflow_fire import PICKERS
                inputs = {name: node['widgets_values'][index] for name, index in PICKERS[cls].items()}
            for name in widget_names:
                if name in node.get('widgets_values_named', {}):
                    inputs[name] = node['widgets_values_named'][name]
                if name not in inputs:
                    spec = specs[name]
                    options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
                    if cls == 'MyQi21ApiPE' and name == 'AI扩写开关':
                        raise ValueError('canvas must explicitly save required AI扩写开关')
                    if 'default' in options:
                        inputs[name] = options['default']
                    elif isinstance(spec[0], list) and spec[0]:
                        inputs[name] = spec[0][0]
            for entry in node.get('inputs', []):
                if entry.get('link') is None:
                    continue
                link = links[entry['link']]
                value = resolve(scope, link['origin_id'], link['origin_slot'])
                if value is not None:
                    inputs[entry['name']] = value
            key = f"{scope}{node['id']}"
            graph[key] = {'class_type': cls, 'inputs': inputs}
            if schema.get('output_node'):
                output_keys.append(key)
    return selected_graph(graph, output_keys)


def selected_graph(graph: dict, outputs: list[str]) -> dict:
    graph = json.loads(json.dumps(graph))

    def literal(value):
        if isinstance(value, list) and len(value) == 2 and value[0] in graph:
            node = graph[value[0]]
            if node['class_type'] in ('PrimitiveBoolean', 'PrimitiveInt', 'PrimitiveString', 'PrimitiveStringMultiline'):
                return literal(node['inputs']['value'])
        return value

    for node in graph.values():
        inputs = node['inputs']
        if node['class_type'] == 'MyQi21SpeedSelect':
            mode = literal(inputs['mode'])
            slots = {'0 · Turbo 8步': 'latent_turbo', '1 · 原生出图': 'latent_direct', '2 · viggle': 'latent_viggle'}
            if mode not in slots:
                raise ValueError(f'unknown saved speed: {mode}')
            for name in slots.values():
                if name != slots[mode]:
                    inputs.pop(name, None)
        elif node['class_type'] == 'MyQi21PromptSelect' and literal(inputs.get('pe开关', True)) is False:
            inputs.pop('PE出文', None)
            inputs.pop('PE负面', None)
        elif node['class_type'] == 'ComfySwitchNode':
            switch = literal(inputs['switch'])
            if isinstance(switch, bool):
                inputs.pop('on_false' if switch else 'on_true', None)
    reached = set()

    def visit(key):
        if key in reached:
            return
        reached.add(key)
        for value in graph[key]['inputs'].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                if value[0] not in graph:
                    raise ValueError(f'unresolved canvas reference {key}→{value[0]}')
                visit(value[0])
    for key in outputs:
        visit(key)
    return {key: node for key, node in graph.items() if key in reached}


def build_graph(info: dict | None = None, workflow: dict | None = None) -> tuple[dict, dict]:
    """Keep the App's established dual outputs even when the GUI upscale group is bypassed."""
    source = workflow if workflow is not None else json.loads(CANVAS.read_text(encoding='utf-8'))
    saved_workflow: dict = json.loads(json.dumps(source))
    for node in saved_workflow['nodes']:
        if node['id'] in (501, 502, 503, 504):
            node['mode'] = 0
    graph = flatten_canvas(saved_workflow, info if info is not None else object_info())
    root = {node['id']: node for node in saved_workflow['nodes']}
    return graph, {'型': root[6]['widgets_values_named']['型选择'], '档': root[7]['widgets_values_named']['速度档位']}


def _widgetize(node: dict) -> dict:
    """SeedVR2 系节点 widget 名由 object_info 定,生成期在 main() 里按序回填。"""
    return {"__WIDGETS__": node["widgets_values"], "__NODE_TYPE__": node["type"]}


def resolve_widgets(graph: dict) -> dict:
    """把带 __WIDGETS__ 占位的节点按 object_info widget 序展开成实名输入。

    画布序列化两条坑:①seed 类 INT 控件后跟 'fixed'/'randomize' 等伪控件串
    (API 形不存在,跳过);②尾随默认值 widget 不落盘(值尽即停,缺的留给引擎默认)。
    """
    controls = {"fixed", "randomize", "increment", "decrement"}
    for key, node in list(graph.items()):
        payload = node["inputs"].pop("__WIDGETS__", None)
        cls = node["inputs"].pop("__NODE_TYPE__", None)
        if payload is None:
            continue
        order = _widget_order(cls)
        values = list(payload)
        idx = 0
        for name in order:
            existing = node["inputs"].get(name)
            if isinstance(existing, list):
                continue  # 该口已接连线:不消费画布 widget 值,保留连线
            if idx >= len(values):
                break
            value = values[idx]
            if isinstance(value, str) and value in controls:
                idx += 1
                if idx >= len(values):
                    break
                value = values[idx]
            node["inputs"][name] = value
            idx += 1
        if idx < len(values):
            raise SystemExit(f"[qwen21-tpl] {cls} 多余 widget 值未消费: {values[idx:]}")
    return graph


def _widget_order(cls: str) -> list[str]:
    url = f"{ENGINE}/object_info/{urllib.parse.quote(cls)}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        info = json.load(resp)[cls]
    out = []
    for group in ("required", "optional"):
        for name, spec in info["input"].get(group, {}).items():
            extra = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
            if not extra.get("forceInput"):
                out.append(name)
    return out


TEMPLATE = {
    "schemaVersion": 1,
    "name": "qwen21_道劫_t2i_api",
    "comfyuiVersionMin": "0.3.45",
    "inputs": {
        "prompt": {"node": "400", "field": "value", "class_type": "PrimitiveStringMultiline"},
        "negative_prompt": {"node": "404", "field": "value", "class_type": "PrimitiveStringMultiline"},
        "seed": {"node": "7:7014", "field": "value", "class_type": "PrimitiveInt"},
    },
}


def check_object_info(graph: dict, schemas: dict | None = None) -> None:
    schemas = schemas if schemas is not None else object_info()
    for key, node in graph.items():
        cls = node["class_type"]
        info = schemas[cls]
        known = set()
        for group in ("required", "optional"):
            known.update(info["input"].get(group, {}).keys())
        bad = [name for name in node['inputs'] if name not in known and name.partition('.')[0] not in known]
        if bad:
            raise SystemExit(f"[qwen21-tpl] {cls} 输入名对不上 object_info: {bad}")
        missing = [name for name, spec in info['input'].get('required', {}).items()
                   if name not in node['inputs'] and not any(field.startswith(name + '.') for field in node['inputs'])
                   and not (spec[0] == 'COMFY_AUTOGROW_V3' and spec[1].get('template', {}).get('min') == 0)]
        if missing:
            raise ValueError(f'{key} {cls} missing required inputs: {missing}')
        for value in node['inputs'].values():
            if isinstance(value, list) and len(value) == 2 and isinstance(value[0], str):
                if value[0] not in graph:
                    raise ValueError(f'{key} missing dependency: {value}')
                output_count = len(schemas[graph[value[0]]['class_type']].get('output', []))
                if not isinstance(value[1], int) or not 0 <= value[1] < output_count:
                    raise ValueError(f'{key} invalid output slot: {value}')


def validate_live(graph: dict) -> None:
    graph = json.loads(json.dumps(graph))
    graph["7:7014"]["inputs"]["value"] = random.randint(1, 2**31 - 1)
    req = urllib.request.Request(
        f"{ENGINE}/prompt",
        data=json.dumps({"prompt": graph, "client_id": "qwen21-tpl-build"}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        pid = json.load(urllib.request.urlopen(req, timeout=30))["prompt_id"]
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"[qwen21-tpl] 引擎拒单: {exc.read().decode()[:800]}")
    print(f"[qwen21-tpl] queued {pid}, polling …")
    t0 = time.time()
    while time.time() - t0 < 900:
        time.sleep(10)
        with urllib.request.urlopen(f"{ENGINE}/history/{pid}", timeout=10) as r:
            hist = json.load(r)
        entry = hist.get(pid)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise SystemExit(f"[qwen21-tpl] 执行失败: {str(status.get('messages'))[:800]}")
        outs = entry.get("outputs", {})
        for node_id in ("504", "8"):
            for out in outs.get(node_id, {}).get("images", []):
                print(f"[qwen21-tpl] 实弹出图 OK(node {node_id}): {out['filename']} ({time.time()-t0:.0f}s)")
                return
        if status.get("status_str") == "success":
            raise SystemExit(f"[qwen21-tpl] 成功但双 SaveImage 均无产物: {str(outs)[:300]}")
    raise SystemExit("[qwen21-tpl] 900s 超时无产物")


def main() -> None:
    global ENGINE
    ap = argparse.ArgumentParser()
    ap.add_argument("--validate", action="store_true", help="生成后直发引擎实弹验图")
    ap.add_argument('--object-info', type=Path, help='offline object_info JSON snapshot')
    args = ap.parse_args()
    source_bytes = CANVAS.read_bytes()
    previous_template = OUT.read_bytes() if OUT.exists() else None
    schemas = object_info(args.object_info)
    graph, meta = build_graph(schemas, json.loads(source_bytes))
    check_object_info(graph, schemas)
    template = {**TEMPLATE, "graph": graph}
    if CANVAS.read_bytes() != source_bytes or (OUT.read_bytes() if OUT.exists() else None) != previous_template:
        raise SystemExit('canvas/template changed during generation; refusing concurrent overwrite')
    OUT.write_text(json.dumps(template, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"[qwen21-tpl] 模板已写入 {OUT.relative_to(REPO)}")
    print(f"[qwen21-tpl] 画布现态: {json.dumps(meta, ensure_ascii=False)}")
    if args.validate:
        ENGINE = engine_base()
        validate_live(json.loads(json.dumps(template["graph"])))


if __name__ == "__main__":
    main()
