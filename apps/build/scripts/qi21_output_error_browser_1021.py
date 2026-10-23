"""Host-only isolated frontend export reproduction; never submits a prompt."""

import argparse
import hashlib
import http.client
import json
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Route, WebSocketRoute, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--executable", type=Path)
parser.add_argument("--output", type=Path)
arguments = parser.parse_args()
repository = Path(__file__).resolve().parents[3]
scope = repository / ".trellis/tasks/10-20-trellis-audit-remediation/research/round15-i2i-output-error"
destination = arguments.output or scope / "host-browser-replay.json"
if destination.exists():
    parser.error(f"Refusing to overwrite existing evidence: {destination}")
home = next((Path.home() / "Library/Application Support").glob("*/comfyui/manifest.json")).parent
manifest = json.loads((home / "manifest.json").read_text())
port = int(manifest["engine"]["port"])
origin = f"http://127.0.0.1:{port}"
executable = arguments.executable
if executable is None:
    executable = next((Path.home() / "Library/Caches/ms-playwright/chromium_headless_shell-1243").glob("**/chrome-headless-shell"))
blocked: list[dict] = []
receipt: dict = {
    "timestamp": datetime.now(UTC).isoformat(),
    "origin": origin,
    "executable": str(executable),
    "policy": "Fresh browser/context per graph; same-origin GET/HEAD only; /prompt and all WebSockets blocked.",
    "blocked": blocked,
    "graphs": [],
    "exit": 2,
    "fix_claimed": False,
}


def guard_request(route: Route) -> None:
    request = route.request
    parsed = urlsplit(request.url)
    same_origin = (parsed.scheme, parsed.hostname, parsed.port) == ("http", "127.0.0.1", port)
    if not same_origin or request.method not in {"GET", "HEAD"} or parsed.path.rstrip("/").startswith("/prompt"):
        blocked.append({"method": request.method, "url": request.url})
        route.abort("blockedbyclient")
        return
    response = route.fetch(max_redirects=0, timeout=15000)
    if 300 <= response.status < 400:
        blocked.append({"method": request.method, "url": request.url, "reason": "redirect"})
        route.abort("blockedbyclient")
        return
    route.fulfill(response=response)


def guard_websocket(route: WebSocketRoute) -> None:
    blocked.append({"method": "WEBSOCKET", "url": route.url})
    route.close()


try:
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    try:
        connection.request("GET", "/object_info")
        response = connection.getresponse()
        schema_bytes = response.read()
        if response.status != 200:
            raise RuntimeError(f"GET /object_info returned {response.status}; redirects are not followed")
        schema = json.loads(schema_bytes)
    finally:
        connection.close()
    receipt["active_schema"] = {"class_count": len(schema), "sha256": hashlib.sha256(schema_bytes).hexdigest()}
    with sync_playwright() as driver:
        browser = driver.chromium.launch(
            headless=True,
            executable_path=str(executable),
            timeout=15000,
            args=["--disable-background-networking", "--disable-component-update", "--disable-sync"],
        )
        try:
            receipt["browser_version"] = browser.version
            workflow_root = repository / "apps/backend/comfyui/workflows"
            stems = ("qi21-道劫-i2i", "qi21-道劫-t2i", "qi21-edit")
            for stem in stems:
                matches = list(workflow_root.glob(f"**/{stem}.json"))
                if len(matches) != 1:
                    raise RuntimeError(f"Expected one exact workflow for {stem}, found {len(matches)}")
                path = matches[0]
                graph_bytes = path.read_bytes()
                graph = json.loads(graph_bytes)
                definitions = graph.get("definitions", {}).get("subgraphs", [])
                nodes = graph["nodes"] + [node for definition in definitions for node in definition["nodes"]]
                frontend_types = {"Note", "MarkdownNote", "Reroute"} | {definition["id"] for definition in definitions}
                classes = {node["type"] for node in nodes} - frontend_types
                result: dict = {
                    "path": str(path.relative_to(repository)),
                    "sha256": hashlib.sha256(graph_bytes).hexdigest(),
                    "missing_from_active_schema": sorted(classes - set(schema)),
                    "page_errors": [],
                }
                receipt["graphs"].append(result)
                context = browser.new_context(service_workers="block")
                try:
                    context.route("**/*", guard_request)
                    context.route_web_socket("**/*", guard_websocket)
                    page = context.new_page()
                    page.on("pageerror", lambda error, current=result: current["page_errors"].append(str(error)))
                    page.goto(origin, wait_until="domcontentloaded", timeout=60000)
                    page.wait_for_function(
                        "typeof window.comfyAPI?.app?.app?.graphToPrompt === 'function' && !!window.comfyAPI.app.app.rootGraph",
                        timeout=60000,
                    )
                    result["export"] = page.evaluate(
                        """async (graph) => {
                            const app = window.comfyAPI.app.app;
                            let stage = 'loadGraphData';
                            try {
                                await app.loadGraphData(graph);
                                stage = 'graphToPrompt';
                                const exported = await app.graphToPrompt();
                                const classCounts = {};
                                for (const node of Object.values(exported.output)) {
                                    const name = String(node.class_type);
                                    classCounts[name] = (classCounts[name] || 0) + 1;
                                }
                                return {ok: true, stage, classCounts,
                                    outputNodeCount: Object.keys(exported.output).length,
                                    rootNodeCount: app.rootGraph._nodes.length,
                                    frontendVersion: exported.workflow.extra?.frontendVersion};
                            } catch (error) {
                                return {ok: false, stage, message: String(error), stack: error.stack};
                            }
                        }""",
                        graph,
                    )
                    exported = result["export"]
                    result["pass"] = (
                        exported["ok"]
                        and exported["outputNodeCount"] > 0
                        and exported["rootNodeCount"] == len(graph["nodes"])
                        and not result["missing_from_active_schema"]
                        and not (set(exported["classCounts"]) - set(schema))
                    )
                finally:
                    context.close()
            receipt["exit"] = 0 if all(result["pass"] for result in receipt["graphs"]) else 1
        finally:
            browser.close()
except (OSError, ValueError, RuntimeError, PlaywrightError, KeyError, TypeError) as error:
    receipt["setup_error"] = {"type": type(error).__name__, "message": str(error)}
    receipt["exit"] = 2
finally:
    with destination.open("x") as output:
        json.dump(receipt, output, ensure_ascii=False, indent=2)
        output.write("\n")
print(json.dumps({"receipt": str(destination), "exit": receipt["exit"], "fix_claimed": False}))
raise SystemExit(receipt["exit"])
