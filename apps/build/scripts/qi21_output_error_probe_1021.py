"""Read-only round15 environment probe; never queues or modifies an engine."""

import hashlib
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright

repository = Path(__file__).resolve().parents[3]
evidence = (
    repository
    / ".trellis/tasks/10-20-trellis-audit-remediation/research/round15-i2i-output-error"
)
home = next((Path.home() / "Library/Application Support").glob("*/comfyui/manifest.json")).parent
manifest = json.loads((home / "manifest.json").read_text())
origin = f"http://127.0.0.1:{manifest['engine']['port']}"
receipt = {
    "timestamp": datetime.now(timezone.utc).isoformat(),
    "origin": origin,
    "production_changes": [],
    "reproduced_original_error": False,
    "browser_export_executed": False,
}
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
schema = None
try:
    with opener.open(origin + "/object_info", timeout=5) as response:
        schema = json.load(response)
    receipt["active_schema"] = {"class_count": len(schema)}
except (OSError, json.JSONDecodeError) as error:
    receipt["active_schema"] = {"error": str(error)}

static = next(home.glob("venv/lib/python*/site-packages/comfyui_frontend_package/static"))
for asset in (static / "assets").glob("*.js"):
    source = asset.read_text()
    marker = "var graphToPrompt=async"
    if marker not in source:
        continue
    start = source.index(marker)
    end = source.index("function scanMissingNodes", start)
    receipt["installed_frontend"] = {
        "path": str(asset),
        "sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
        "graphToPrompt_byte_offset": len(source[:start].encode()),
        "graphToPrompt_source": source[start:end],
    }
    break

snapshot_path = repository / "apps/backend/comfyui/tests/fixtures/qi21_object_info_snapshot.json"
snapshot = json.loads(snapshot_path.read_text())
graphs = []
for workflow in (repository / "apps/backend/comfyui/workflows").glob("**/qi21*.json"):
    if workflow.stem not in {"qi21-道劫-i2i", "qi21-道劫-t2i", "qi21-edit"}:
        continue
    graph = json.loads(workflow.read_text())
    subgraphs = graph.get("definitions", {}).get("subgraphs", [])
    nodes = graph["nodes"] + [node for subgraph in subgraphs for node in subgraph["nodes"]]
    frontend_types = {"Note", "MarkdownNote", "Reroute"} | {subgraph["id"] for subgraph in subgraphs}
    classes = sorted({node["type"] for node in nodes} - frontend_types)
    graphs.append({
        "path": str(workflow.relative_to(repository)),
        "sha256": hashlib.sha256(workflow.read_bytes()).hexdigest(),
        "top_level_nodes": len(graph["nodes"]),
        "subgraphs": len(subgraphs),
        "missing_from_offline_snapshot": sorted(set(classes) - set(snapshot)),
        "missing_from_active_schema": sorted(set(classes) - set(schema)) if schema is not None else None,
    })
receipt["graphs"] = graphs
executable = next((Path.home() / "Library/Caches/ms-playwright/chromium_headless_shell-1243").glob("**/chrome-headless-shell"))
try:
    with sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True, executable_path=str(executable))
        try:
            receipt["isolated_browser"] = {"version": browser.version, "launched": True}
        finally:
            browser.close()
except PlaywrightError as error:
    receipt["isolated_browser"] = {"launched": False, "error": str(error)}
receipt["limitations"] = [
    "Browser launch probe only: no navigation, live app attachment, or /prompt request.",
    "No original-error reproduction or real graphToPrompt export; no fix claimed.",
    "Offline schema comparison is not evidence of active engine registration.",
]
destination = evidence / "environment-probe.json"
destination.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"receipt": str(destination), "schema_reachable": schema is not None, "browser_launched": receipt["isolated_browser"]["launched"], "exit": 2}))
raise SystemExit(2)
