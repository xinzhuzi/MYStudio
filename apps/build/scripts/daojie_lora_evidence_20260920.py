#!/usr/bin/env python3
"""Read-only LoRA reference and deployment snapshot; no engine jobs or sync.

Writes a new task-local evidence directory. Counts distinct (node, file)
references, including nested subgraphs and rgthree widget dictionaries.
The legacy scanner uses a different counting rule; both outputs are retained.
"""
from __future__ import annotations

import ast
import hashlib
import json
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import daojie_lora_refscan_0919 as legacy

REPO = Path(__file__).resolve().parents[3]
TASK = REPO / '.trellis/tasks/09-19-daojie-lora-governance'
DATA_NAMES = ('daojie_bases.json', 'daojie_lora_stack.json', 'daojie_loras.json')
STANDARD_LOADERS = {'LoraLoaderModelOnly', 'LoraLoader'}
POWER_LOADER = 'Power Lora Loader (rgthree)'


def main() -> None:
    out = TASK / 'research' / ('independent_evidence_' + datetime.now().strftime('%Y%m%d_%H%M%S_%f'))
    out.mkdir(parents=True, exist_ok=False)
    home = legacy.LORA_DIR.parent.parent
    observed = {}
    parse_errors = []

    def read(path):
        raw = path.read_bytes()
        observed[str(path)] = hashlib.sha256(raw).hexdigest()
        return raw

    def read_json(path):
        try:
            return json.loads(read(path))
        except (ValueError, UnicodeError) as exc:
            parse_errors.append({'file': str(path), 'error': str(exc)})
            return None

    inventory = legacy.build_inventory()
    # This host keeps an additional native ComfyUI model root. Its QuadView
    # file is exposed by the live engine but absent from the managed root.
    model_roots = (legacy.LORA_DIR, home / 'ComfyUI/models/loras')
    model_locations = {name: [str(legacy.LORA_DIR / name)] for name in inventory}
    for path in sorted(model_roots[1].rglob('*')):
        if not path.is_file() or not path.name.lower().endswith(legacy.EXTS):
            continue
        relative = path.relative_to(model_roots[1]).as_posix()
        inventory.setdefault(relative, path.stat().st_size)
        model_locations.setdefault(relative, []).append(str(path))
    model_paths = sorted(p for p in inventory if p.lower().endswith(legacy.EXTS))
    # Evaluate only the actual installed pure filename resolver, not the plugin.
    resolver_file = home / 'ComfyUI/custom_nodes/rgthree-comfy/py/power_prompt_utils.py'
    tree = ast.parse(read(resolver_file))
    resolver_def = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'get_lora_by_filename')
    namespace = {'os': os}
    exec(compile(ast.Module(body=[resolver_def], type_ignores=[]), str(resolver_file), 'exec'), namespace)
    power_resolve = namespace['get_lora_by_filename']
    refs, unknown_nodes = [], []

    def strings(value):
        if isinstance(value, dict):
            for child in value.values():
                yield from strings(child)
        elif isinstance(value, list):
            for child in value:
                yield from strings(child)
        elif isinstance(value, str) and value.lower().endswith(legacy.EXTS):
            yield value

    def record(file, trail, node_type, values, mode=None):
        for ref in sorted(set(values)):
            # ComfyUI's native loader resolves a relative path exactly on macOS.
            exact = os.path.relpath(os.path.join('/', ref), '/')
            resolved = exact if exact in inventory else None
            method = 'exact' if resolved else 'missing'
            if node_type == POWER_LOADER:
                resolved = power_resolve(ref, lora_paths=model_paths, log_node=None)
                method = 'rgthree_resolver' if resolved else 'missing'
            refs.append({'file': str(file), 'trail': trail, 'type': node_type,
                         'ref': ref, 'resolved': resolved, 'method': method,
                         'node_mode': mode})

    def walk(value, file, trail='$'):
        if isinstance(value, dict):
            typ = value.get('class_type') or value.get('type')
            if isinstance(typ, str) and (typ in STANDARD_LOADERS or typ == POWER_LOADER):
                values = []
                keys = ('inputs',) if 'class_type' in value else ('widgets_values', 'widgets_values_named')
                for key in keys:
                    values.extend(strings(value.get(key)))
                record(file, trail, typ, values, value.get('mode'))
            elif isinstance(typ, str) and 'lora' in typ.lower() and ('id' in value or 'class_type' in value):
                unknown_nodes.append({'file': str(file), 'trail': trail, 'type': typ})
            for key, child in value.items():
                walk(child, file, f'{trail}.{key}')
        elif isinstance(value, list):
            for index, child in enumerate(value):
                walk(child, file, f'{trail}[{index}]')

    root_counts = {}
    for root in (legacy.REPO_WF, legacy.HOME_WORKFLOWS):
        assert root.is_dir(), f'Missing scan root: {root}'
        paths = sorted(root.rglob('*.json'))
        root_counts[str(root)] = len(paths)
        for path in paths:
            walk(read_json(path), path)
    for name in DATA_NAMES:
        path = legacy.MY_NODES / 'nodes' / name
        data = read_json(path)
        # A data entry is a distinct reference owner; preset duplicates inside it
        # are counted once. This is not a count of effective runtime loads.
        assert isinstance(data, list), str(path)
        for index, entry in enumerate(data):
            record(path, f'$[{index}]', 'dataplane', strings(entry))

    deployed = []
    app = next(p for p in Path('/Applications').iterdir() if p.name == '漫影工作室.app')
    roots = {'runtime': home / 'ComfyUI/custom_nodes/my-nodes/nodes',
             'installed': app / 'Contents/Resources/backend/engines/comfyui/my_nodes/nodes'}
    for name in ('my_daojie_lora_stack.py', 'my_daojie_loras.py', *DATA_NAMES):
        source = legacy.MY_NODES / 'nodes' / name
        source_raw = read(source)
        for label, root in roots.items():
            target = root / name
            equal = target.is_file() and read(target) == source_raw
            deployed.append({'name': name, 'target_kind': label, 'path': str(target), 'equal': equal})

    legacy_run = subprocess.run([sys.executable, '-B', str(Path(legacy.__file__)), '--json', str(out / 'legacy.json')],
                                cwd=REPO, text=True, capture_output=True)
    (out / 'legacy.log').write_text(legacy_run.stdout + legacy_run.stderr, encoding='utf-8')
    legacy_report = json.loads((out / 'legacy.json').read_text()) if (out / 'legacy.json').exists() else None
    changed = [p for p, digest in observed.items() if not Path(p).is_file() or hashlib.sha256(Path(p).read_bytes()).hexdigest() != digest]
    missing = [r for r in refs if r['resolved'] is None]
    counts = Counter(r['resolved'] for r in refs if r['resolved'])
    report = {'generated_at': datetime.now().astimezone().isoformat(),
              'scope': 'filesystem references and scoped deployment only; no new inference',
              'root_counts': root_counts, 'inventory': inventory, 'refs': refs,
              'model_roots': [str(root) for root in model_roots],
              'model_locations': model_locations,
              'reference_counts': dict(counts), 'missing': missing,
              'other_lora_node_types': unknown_nodes, 'parse_errors': parse_errors,
              'deployment': deployed, 'observed_sha256': observed, 'changed_during_scan': changed,
              'legacy_exit_code': legacy_run.returncode,
              'legacy_missing': legacy_report['broken'] if legacy_report else None,
              'limitations': ['Unknown external subgraph definitions and free-text model tags are not resolved.',
                             'References include bypassed nodes and disabled slots; no execution claim.',
                             'Exact-path checks cover the two inventoried model roots; other extra model roots are not inspected.',
                             'Inventory existence/size is not model-content integrity.',
                             'Other sessions remain active; this is a timestamped snapshot.']}
    (out / 'evidence.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = {'output_directory': str(out), 'json_files': sum(root_counts.values()) + len(DATA_NAMES),
               'inventory_files': len(inventory), 'references': len(refs), 'missing': len(missing),
               'parse_errors': len(parse_errors), 'changed_during_scan': changed,
               'deployment_mismatches': [x for x in deployed if not x['equal']],
               'legacy_missing_strings': len(legacy_report['broken']) if legacy_report else None}
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
