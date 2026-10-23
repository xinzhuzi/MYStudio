"""Reproduce QI2.1 frontend export errors in a fresh GET-only browser context."""
from __future__ import annotations

import json
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/round15-i2i-output-error'
APP_HOME = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
MANIFEST = json.loads((APP_HOME / 'comfyui/manifest.json').read_text())
ORIGIN = f"http://127.0.0.1:{MANIFEST['engine']['port']}"
EXECUTABLE = next((Path.home() / 'Library/Caches/ms-playwright').glob('chromium_headless_shell-*/**/chrome-headless-shell'))
NAMES = ['qi21-道劫-i2i.json', 'qi21-道劫-t2i.json', 'qi21-edit.json']


def main():
    report = {'origin': ORIGIN, 'live_app_attached': False, 'generation_submitted': False, 'blocked_requests': [], 'page_errors': [], 'cases': []}
    with sync_playwright() as driver:
        browser = driver.chromium.launch(headless=True, executable_path=str(EXECUTABLE))
        try:
            context = browser.new_context(viewport={'width': 1600, 'height': 1000})

            def guard(route):
                request = route.request
                if request.method != 'GET' or urlsplit(request.url).netloc != urlsplit(ORIGIN).netloc or urlsplit(request.url).path == '/prompt':
                    report['blocked_requests'].append({'method': request.method, 'url': request.url})
                    route.abort()
                else:
                    route.continue_()

            context.route('**/*', guard)
            context.route_web_socket('**/*', lambda route: route.close())
            page = context.new_page()
            page.on('pageerror', lambda error: report['page_errors'].append(str(error)))
            page.goto(ORIGIN, wait_until='domcontentloaded', timeout=30000)
            page.wait_for_function('() => window.comfyAPI?.app?.app?.isGraphReady === true', timeout=45000)
            report['app_ready'] = True
            for name in NAMES:
                path = next((ROOT / 'apps/backend/comfyui/workflows').rglob(name))
                graph = json.loads(path.read_text())
                result = page.evaluate('''async (graph) => {
                    const {app} = await import('/scripts/app.js');
                    const row = {name: graph.id, loaded: false};
                    try {
                        await app.loadGraphData(graph, true, true, null, {skipAssetScans: true});
                        row.loaded = true;
                        const n = app.graph.getNodeById(19);
                        row.node19 = n ? {type: n.type, comfyClass: n.comfyClass, outputs: n.outputs, inputs: n.inputs, nodeData: n.constructor.nodeData ?? null} : null;
                        const result = await app.graphToPrompt();
                        row.exported = true;
                        row.output = result.output;
                        row.nodeCount = Object.keys(result.output).length;
                    } catch (error) {
                        row.exported = false;
                        row.error = String(error);
                        row.stack = error.stack;
                    }
                    return row;
                }''', graph)
                result['file'] = str(path.relative_to(ROOT))
                report['cases'].append(result)
                print(json.dumps({k: result[k] for k in ['file', 'loaded', 'exported', 'error', 'stack', 'nodeCount'] if k in result}, ensure_ascii=False), flush=True)
            page.screenshot(path=str(OUT / 'main-isolated-canvas.png'), full_page=False)
        finally:
            browser.close()
            (OUT / 'main-browser-export.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    return 0 if all(case.get('exported') for case in report['cases']) and len(report['cases']) == 3 else 1


if __name__ == '__main__':
    raise SystemExit(main())
