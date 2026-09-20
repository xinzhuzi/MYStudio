#!/usr/bin/env python3
"""Read-only docs inventory and link/command/path audit. No network or Git calls.

Run from any directory with --output pointing to a task-owned JSON report.
Missing literal source paths and npm scripts are review items: historical and
example references are deliberately not silently rewritten or treated as live.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
NODE_LINKS = r'''
const fs = require('fs');
const path = require('path');
const MarkdownIt = require(path.join(process.cwd(), 'apps/node_modules/markdown-it'));
const md = new MarkdownIt({html: true});
const files = JSON.parse(fs.readFileSync(0, 'utf8'));
const found = [];
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  const blocks = md.parse(source, {});
  function visit(tokens, parentLine = 1) {
    for (const token of tokens) {
      const line = token.map ? token.map[0] + 1 : parentLine;
      for (const attr of ['href', 'src']) {
        const target = token.attrGet(attr);
        if (target) found.push({file, line, target});
      }
      if (token.children) visit(token.children, line);
      if (token.type === 'html_block' || token.type === 'html_inline') {
        for (const match of token.content.matchAll(/(?:href|src)=["']([^"']+)["']/g))
          found.push({file, line, target: match[1]});
      }
    }
  }
  visit(blocks);
}
process.stdout.write(JSON.stringify(found));
'''


def audit() -> dict:
    from urllib.parse import unquote, urlsplit
    files = sorted((ROOT / 'docs').rglob('*.md'))
    package = json.loads((ROOT / 'apps/package.json').read_text())
    npm_scripts = package['scripts']
    inventory, missing_paths, missing_commands, keywords = [], [], [], []
    pattern = re.compile(r'`((?:apps/|src/|frontend/|backend/)[^`\n]+)`')
    legacy = re.compile(r'工作流\s*(?:->|→)\s*(?:策划编剧|剧本资产提取)|漫影/|h3-shot-template_my|MY-h3|MY-krea|设置\s*(?:->|→)\s*Python Configuration')
    for file in files:
        rel = file.relative_to(ROOT).as_posix()
        content = file.read_text()
        lines = content.splitlines()
        inventory.append({'path': rel, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(),
                          'lines': len(lines), 'chars': len(content),
                          'title': next((s[2:] for s in lines if s.startswith('# ')), file.stem),
                          'headings': [s for s in lines if s.startswith('## ')],
                          'section': file.relative_to(ROOT / 'docs').parts[0]})
        for number, line in enumerate(lines, 1):
            for match in pattern.finditer(line):
                value = re.sub(r':\d+(?:-\d+)?$', '', match.group(1))
                if any(x in value for x in ('*', '<', '>', '|', ' ', '{', '}', '…', '...')):
                    continue
                if not (ROOT / value).exists():
                    missing_paths.append({'file': rel, 'line': number, 'path': value})
            for match in re.finditer(r'\bnpm run ([A-Za-z][\w:-]*)', line):
                name = match.group(1)
                if name not in npm_scripts:
                    missing_commands.append({'file': rel, 'line': number, 'script': name})
            if legacy.search(line):
                keywords.append({'file': rel, 'line': number, 'text': line[:350]})
    result = subprocess.run(['node', '-e', NODE_LINKS], cwd=ROOT,
                            input=json.dumps([r['path'] for r in inventory]),
                            capture_output=True, text=True, check=True)
    links = json.loads(result.stdout)
    missing_links, local_links, external_links = [], [], 0
    reachable = {'docs/README.md'}
    graph: dict[str, set[str]] = {}
    for item in links:
        url = urlsplit(item['target'])
        if url.scheme or url.netloc:
            external_links += 1
            continue
        if not url.path:
            continue
        target = (ROOT / item['file']).parent / unquote(url.path)
        item['resolved'] = str(target.resolve().relative_to(ROOT)) if target.resolve().is_relative_to(ROOT) else str(target.resolve())
        local_links.append(item)
        if not target.exists():
            missing_links.append(item)
        elif target.suffix == '.md':
            graph.setdefault(item['file'], set()).add(item['resolved'])
        elif target.is_dir():
            # A directory listing is a real navigable index, not an imaginary README.
            graph.setdefault(item['file'], set()).update(p.relative_to(ROOT).as_posix() for p in target.rglob('*.md') if p.is_relative_to(ROOT / 'docs'))
    while True:
        updated = reachable | {v for k in reachable for v in graph.get(k, set())}
        if updated == reachable:
            break
        reachable = updated
    return {'created_at': datetime.now(timezone.utc).isoformat(), 'root': str(ROOT),
            'summary': {'markdown_files': len(files), 'sections': dict(Counter(x['section'] for x in inventory)),
                        'local_links': len(local_links), 'external_links_not_fetched': external_links,
                        'missing_links': len(missing_links), 'literal_source_paths_needing_review': len(missing_paths),
                        'npm_scripts_needing_review': len(missing_commands)},
            'inventory': inventory, 'missing_links': missing_links,
            'unreachable_markdown': [x['path'] for x in inventory if x['path'] not in reachable],
            'source_paths_needing_review': missing_paths, 'npm_scripts_needing_review': missing_commands,
            'legacy_text_review': keywords}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--check-links', action='store_true', help='Exit 1 if any parsed local link is missing.')
    args = parser.parse_args()
    report = audit()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(report['summary'], ensure_ascii=False, indent=2))
    print(f'Report: {args.output}')
    return 1 if args.check_links and report['missing_links'] else 0


if __name__ == '__main__':
    sys.exit(main())
