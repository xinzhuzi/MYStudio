"""Recover only source-proven missing verification scripts; never execute them.

The session is parsed as JSONL and JavaScript quoted literals, without eval.
First runs create a bounded source inventory. Source restoration uses explicit,
reviewed recipe data stored under the recovery evidence directory.
"""
from pathlib import Path
import argparse
import ast
import hashlib
import json
import re

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / '.trellis/tasks/10-27-script-narrative-translation-cure/research'
EVIDENCE = RESEARCH / 'verification-script-recovery-20261111'
SESSION = Path('/Users/zhengbingjin/.codex/sessions/2026/11/10/rollout-2026-11-10T12-51-38-01a1c3cb-f6ca-7763-80e2-d84b40dd8066_01a1c3cc-26fe-7dc3-90c8-fb13d7ca1737.jsonl')
CHAPTERS = set(range(1, 22)) | {23} | set(range(259, 271))


def digest(data):
    return hashlib.sha256(data).hexdigest()


def quoted(text, start):
    """Decode a static JS string literal, rejecting template interpolation."""
    quote = text[start]
    if quote not in ('"', "'", '`'):
        raise ValueError('not a quoted literal')
    i = start + 1
    out = []
    escapes = {'n': '\n', 'r': '\r', 't': '\t', 'b': '\b', 'f': '\f', 'v': '\v', '0': '\0'}
    while i < len(text):
        ch = text[i]
        if ch == quote:
            return ''.join(out), i + 1
        if quote == '`' and text.startswith('${', i):
            raise ValueError('template interpolation is not static')
        if ch != '\\':
            out.append(ch)
            i += 1
            continue
        i += 1
        ch = text[i]
        if ch in escapes:
            out.append(escapes[ch])
            i += 1
        elif ch in ('x', 'u'):
            width = 2 if ch == 'x' else 4
            if ch == 'u' and text[i + 1:i + 2] == '{':
                end = text.index('}', i + 2)
                out.append(chr(int(text[i + 2:end], 16)))
                i = end + 1
            else:
                out.append(chr(int(text[i + 1:i + 1 + width], 16)))
                i += 1 + width
        elif ch in ('\n', '\r'):
            i += 1
            if ch == '\r' and text[i:i + 1] == '\n':
                i += 1
        else:
            out.append(ch)
            i += 1
    raise ValueError('unterminated quoted literal')


def literal_calls(source):
    patterns = [
        ('exec_command', r'tools\.exec_command\(\s*\{\s*(?:"cmd"|cmd)\s*:\s*'),
        ('apply_patch', r'tools\.apply_patch\(\s*'),
    ]
    results = []
    for kind, pattern in patterns:
        for match in re.finditer(pattern, source):
            if source[match.end():match.end() + 1] not in ('"', "'", '`'):
                continue
            value, end = quoted(source, match.end())
            results.append({'kind': kind, 'start': match.start(), 'end': end, 'source': value})
    return sorted(results, key=lambda item: item['start'])


def target_inventory():
    ledger = json.loads((RESEARCH / 'fr-volumes-current-20261110.json').read_text())
    targets = {}
    for row in ledger['volume1']['chapters']:
        chapter = row['chapter']
        if chapter not in CHAPTERS or not row['status'].startswith('offline_content_closed_'):
            continue
        fresh_path = RESEARCH / f'chapter{chapter:03d}-mainfresh-20261110.json'
        if not fresh_path.exists():
            continue
        fresh = json.loads(fresh_path.read_text())
        for path in sorted(set(re.findall(r'apps/build/scripts/[A-Za-z0-9_./-]+\.py', json.dumps(fresh)))):
            item = targets.setdefault(path, {'canonical_fresh': [], 'expected_sha256': []})
            item['canonical_fresh'].append(fresh_path.name)
            if fresh.get('verifier_sha256'):
                item['expected_sha256'].append(fresh['verifier_sha256'])
    for name in ('fr_resume_check_20261110.py', 'fr_trellis_checkpoint_20261110.py'):
        targets.setdefault('apps/build/scripts/' + name, {'canonical_fresh': [], 'expected_sha256': []})
    for path, item in targets.items():
        item['expected_sha256'] = sorted(set(item['expected_sha256']))
        item['exists_at_inventory'] = (ROOT / path).exists()
    return targets


def inventory():
    EVIDENCE.mkdir(exist_ok=True)
    snippets = EVIDENCE / 'source-fragments'
    snippets.mkdir(exist_ok=True)
    targets = target_inventory()
    names = {Path(path).name: path for path in targets}
    calls = {}
    outputs = {}
    bad = []
    with SESSION.open() as stream:
        for line_number, line in enumerate(stream, 1):
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                bad.append(line_number)
                continue
            payload = record.get('payload', {})
            if record.get('type') != 'response_item':
                continue
            kind = payload.get('type')
            call_id = payload.get('call_id')
            if kind in ('custom_tool_call', 'function_call'):
                source = payload.get('input', payload.get('arguments', ''))
                matched = [name for name in names if name in source]
                if not matched:
                    continue
                if payload.get('name') == 'exec':
                    literals = literal_calls(source)
                elif payload.get('name') == 'exec_command':
                    literals = [{'kind': 'exec_command', 'source': json.loads(source)['cmd']}]
                elif payload.get('name') == 'apply_patch':
                    literals = [{'kind': 'apply_patch', 'source': source}]
                else:
                    literals = []
                fragments = []
                for index, literal in enumerate(literals):
                    relevant = [name for name in names if name in literal['source']]
                    if not relevant:
                        continue
                    fragment_name = f'line-{line_number}-{call_id}-{index}-{literal["kind"]}.txt'
                    content = literal.pop('source')
                    (snippets / fragment_name).write_bytes(content.encode())
                    fragments.append({**literal, 'targets': relevant, 'file': fragment_name,
                                      'bytes': len(content.encode()), 'sha256': digest(content.encode())})
                calls[call_id] = {'line': line_number, 'call_id': call_id,
                                  'name': payload.get('name'), 'targets': matched,
                                  'fragments': fragments}
            elif kind in ('custom_tool_call_output', 'function_call_output') and call_id in calls:
                output_name = f'line-{line_number}-{call_id}-output.json'
                output = payload.get('output')
                (snippets / output_name).write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
                outputs[call_id] = {'line': line_number, 'file': output_name}
    for call_id, call in calls.items():
        call['output'] = outputs.get(call_id)
    result = {'session': str(SESSION), 'session_bytes_observed': SESSION.stat().st_size,
              'targets': targets, 'calls': list(calls.values()), 'invalid_jsonl_lines': bad}
    (EVIDENCE / 'inventory.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'targets': len(targets), 'calls': len(calls), 'outputs': len(outputs),
                      'fragments': sum(len(call['fragments']) for call in calls.values()),
                      'inventory': str(EVIDENCE / 'inventory.json')}, ensure_ascii=False))


def envelopes(value):
    """Find execution envelopes, including intact JSON lines in clipped wrappers."""
    if isinstance(value, dict):
        if 'exit_code' in value and isinstance(value.get('output'), str):
            yield value
        else:
            for child in value.values():
                yield from envelopes(child)
    elif isinstance(value, list):
        for child in value:
            yield from envelopes(child)
    elif isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            for line in value.splitlines():
                if line.startswith('{'):
                    try:
                        parsed = json.loads(line)
                    except ValueError:
                        continue
                    yield from envelopes(parsed)
        else:
            yield from envelopes(parsed)


def normalize_outputs():
    data = json.loads((EVIDENCE / 'inventory.json').read_text())
    destination = EVIDENCE / 'decoded-outputs'
    destination.mkdir(exist_ok=True)
    result = []
    for call in data['calls']:
        if not call['output']:
            continue
        value = json.loads((EVIDENCE / 'source-fragments' / call['output']['file']).read_text())
        for index, envelope in enumerate(envelopes(value)):
            content = envelope['output']
            name = f'line-{call["line"]}-output-{index}.txt'
            (destination / name).write_bytes(content.encode())
            result.append({'call_line': call['line'], 'call_id': call['call_id'],
                           'output_log_line': call['output']['line'], 'part': index,
                           'exit_code': envelope['exit_code'], 'file': name,
                           'bytes': len(content.encode()), 'lines': len(content.splitlines()),
                           'sha256': digest(content.encode()),
                           'truncation_marker': bool(re.search(r'tokens truncated|Warning: truncated', content))})
    (EVIDENCE / 'decoded-outputs.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'decoded_outputs': len(result)}))


def fragment_for(call_line, target, kind):
    inventory_data = json.loads((EVIDENCE / 'inventory.json').read_text())
    call = next(item for item in inventory_data['calls'] if item['line'] == call_line)
    matches = [item for item in call['fragments']
               if item['kind'] == kind and Path(target).name in item['targets']]
    if kind == 'exec_command':
        matches = [item for item in matches if re.search(r'cat\s+>\s*' + re.escape(target),
                                                        (EVIDENCE / 'source-fragments' / item['file']).read_text())]
    if len(matches) != 1:
        raise ValueError(f'ambiguous source fragment: {call_line} {target} {kind}')
    item = matches[0]
    source = (EVIDENCE / 'source-fragments' / item['file']).read_text()
    return source, {'call_line': call_line, 'call_id': call['call_id'],
                    'output_log_line': call['output']['line'], 'fragment': item['file'],
                    'source_type': kind, 'fragment_sha256': item['sha256']}


def heredoc_source(call_line, target):
    source, provenance = fragment_for(call_line, target, 'exec_command')
    pattern = r"(?m)^cat\s+>\s*" + re.escape(target) + r"\s+<<'([^']+)'\n"
    match = re.search(pattern, source)
    if not match:
        raise ValueError('missing exact quoted heredoc')
    terminator = re.search(r'(?m)^' + re.escape(match[1]) + r'$', source[match.end():])
    if not terminator:
        raise ValueError('missing heredoc terminator')
    body = source[match.end():match.end() + terminator.start()]
    return body, {**provenance, 'extraction': 'exact quoted heredoc body',
                  'body_start_line': source[:match.end()].count('\n') + 1,
                  'body_lines': len(body.splitlines())}


def added_patch_source(call_line, target):
    source, provenance = fragment_for(call_line, target, 'apply_patch')
    marker = '*** Add File: ' + str(ROOT / target) + '\n'
    if source.count(marker) != 1:
        raise ValueError('missing unique Add File marker')
    section = source.split(marker, 1)[1].split('\n*** ', 1)[0]
    lines = section.splitlines()
    if any(not line.startswith('+') for line in lines):
        raise ValueError('unexpected Add File content')
    body = ''.join(line[1:] + '\n' for line in lines)
    return body, {**provenance, 'extraction': 'Add File plus-lines in order',
                  'body_lines': len(body.splitlines())}


def output_source(call_line, part, start, end):
    metadata = json.loads((EVIDENCE / 'decoded-outputs.json').read_text())
    item = next(item for item in metadata if item['call_line'] == call_line and item['part'] == part)
    if item['exit_code'] != 0:
        raise ValueError('source read did not exit zero')
    path = EVIDENCE / 'decoded-outputs' / item['file']
    raw = path.read_bytes()
    if digest(raw) != item['sha256']:
        raise ValueError('decoded source changed')
    lines = raw.decode().splitlines(keepends=True)
    if end > len(lines):
        raise ValueError('source output range exceeds available lines')
    selected = ''.join(lines[start - 1:end])
    if re.search(r'tokens truncated|Warning: truncated', selected):
        raise ValueError('selected source contains a truncation marker')
    return selected, {**item, 'source_type': 'cat_or_sed_output',
                      'selected_output_lines': [start, end],
                      'selected_output_has_no_truncation': True}


def exact_patch_update(body, call_line, target):
    patch, provenance = fragment_for(call_line, target, 'apply_patch')
    marker = '*** Update File: ' + str(ROOT / target) + '\n'
    if patch.count(marker) != 1:
        raise ValueError('missing exact Update File marker')
    section = patch.split(marker, 1)[1].split('\n*** ', 1)[0]
    hunks = re.split(r'(?m)^@@[^\n]*\n', section)[1:]
    for hunk in hunks:
        old, new = [], []
        for source_line in hunk.splitlines():
            line = source_line + '\n'
            if line.startswith((' ', '-')):
                old.append(line[1:])
            if line.startswith((' ', '+')):
                new.append(line[1:])
        before, after = ''.join(old), ''.join(new)
        if body.count(before) != 1:
            raise ValueError('patch hunk does not match exactly once')
        body = body.replace(before, after, 1)
    return body, {**provenance, 'extraction': 'exact unique context hunk application', 'hunks': len(hunks)}


def replacement_update(body, call_line, target):
    data = json.loads((EVIDENCE / 'inventory.json').read_text())
    call = next(item for item in data['calls'] if item['line'] == call_line)
    fragment = next(item for item in call['fragments'] if Path(target).name in item['targets'])
    source = (EVIDENCE / 'source-fragments' / fragment['file']).read_text()
    match = re.search(r"(?ms)^python3 - <<'PY'\n(.*?)^PY$", source)
    if not match:
        raise ValueError('missing static Python heredoc for replacement')
    constants = {}
    for node in ast.walk(ast.parse(match[1])):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant):
            for assigned in node.targets:
                if isinstance(assigned, ast.Name) and assigned.id in ('old', 'new'):
                    constants[assigned.id] = node.value.value
    if set(constants) != {'old', 'new'} or body.count(constants['old']) != 1:
        raise ValueError('replacement literals not unique and exact')
    body = body.replace(constants['old'], constants['new'], 1)
    return body, {'call_line': call_line, 'call_id': call['call_id'],
                  'output_log_line': call['output']['line'], 'fragment': fragment['file'],
                  'fragment_sha256': fragment['sha256'], 'source_type': 'static_python_literals',
                  'extraction': 'AST Constant old/new; exact single replacement; no execution'}


def recover(restore):
    inventory_data = json.loads((EVIDENCE / 'inventory.json').read_text())
    recipes = json.loads((EVIDENCE / 'recipes.json').read_text())
    copies = EVIDENCE / 'recovered-sources'
    copies.mkdir(exist_ok=True)
    manifest = []
    for target, recipe in recipes.items():
        provenance = []
        body = ''
        for operation in recipe['operations']:
            kind = operation['kind']
            if kind == 'output':
                selected, entry = output_source(operation['line'], operation['part'], operation['start'], operation['end'])
                overlap = operation.get('overlap', 0)
                if overlap:
                    selected_lines = selected.splitlines(keepends=True)
                    if body.splitlines(keepends=True)[-overlap:] != selected_lines[:overlap]:
                        raise ValueError('overlap source lines disagree')
                    selected = ''.join(selected_lines[overlap:])
                    entry['overlap_verified_lines'] = overlap
                body += selected
            elif kind == 'heredoc':
                body, entry = heredoc_source(operation['line'], target)
            elif kind == 'add_patch':
                body, entry = added_patch_source(operation['line'], target)
            elif kind == 'update_patch':
                body, entry = exact_patch_update(body, operation['line'], target)
            elif kind == 'literal_replacement':
                body, entry = replacement_update(body, operation['line'], target)
            else:
                raise ValueError('unsupported recovery operation')
            provenance.append(entry)
        raw = body.encode()
        compile(raw, target, 'exec')
        sha256 = digest(raw)
        expected = inventory_data['targets'][target]['expected_sha256']
        if expected and any(value != sha256 for value in expected):
            raise ValueError(f'historical verifier SHA mismatch: {target}: {sha256} != {expected}')
        (copies / Path(target).name).write_bytes(raw)
        path = ROOT / target
        if path.exists():
            status = 'already_exists_identical' if path.read_bytes() == raw else 'already_exists_different_not_overwritten'
        elif restore:
            with path.open('xb') as stream:
                stream.write(raw)
            if path.read_bytes() != raw:
                raise ValueError('restored target readback disagrees')
            status = 'restored'
        else:
            status = 'prepared_missing_target'
        manifest.append({'target': target, 'status': status, 'bytes': len(raw),
                         'lines': len(body.splitlines()), 'sha256': sha256,
                         'expected_sha256': expected, 'historical_sha_matches': bool(expected),
                         'compile_in_memory': True, 'executed': False,
                         'canonical_fresh': inventory_data['targets'][target]['canonical_fresh'],
                         'completeness': recipe['completeness'], 'sources': provenance})
    missing = sorted(set(inventory_data['targets']) - set(recipes))
    result = {'session': str(SESSION), 'mode': 'restore_missing_only' if restore else 'prepare_only',
              'targets': manifest, 'missing_original_source': missing,
              'target_count': len(inventory_data['targets']),
              'restored_count': sum(item['status'] == 'restored' for item in manifest),
              'historical_sha_matches': sum(item['historical_sha_matches'] for item in manifest),
              'validation_boundary': 'In-memory compile and source/readback hashes only; no verifier, resume, checkpoint or manuscript checks executed.'}
    name = 'manifest.json' if restore else 'prepared-manifest.json'
    (EVIDENCE / name).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'mode': result['mode'], 'targets': len(manifest), 'restored': result['restored_count'],
                      'historical_sha_matches': result['historical_sha_matches'], 'missing_original_source': missing}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory', action='store_true', help='extract static source evidence only')
    parser.add_argument('--normalize-outputs', action='store_true', help='decode execution output envelopes')
    parser.add_argument('--prepare', action='store_true', help='assemble proven sources without restoring targets')
    parser.add_argument('--restore', action='store_true', help='restore proven missing targets; never execute sources')
    args = parser.parse_args()
    if args.inventory:
        inventory()
    elif args.normalize_outputs:
        normalize_outputs()
    elif args.prepare or args.restore:
        recover(args.restore)
    else:
        parser.error('choose --inventory, --normalize-outputs, --prepare or --restore')
