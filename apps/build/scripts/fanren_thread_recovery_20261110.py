"""Extract the referenced chat's complete visible message history for bounded review."""
import collections
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.trellis/tasks/11-10-humanizer-fusion/research/thread-recovery-20261110'
SOURCES = [
    (Path('/Users/zhengbingjin/.codex/sessions/2026/10/25/rollout-2026-10-25T10-53-01-01a170f9-afdb-7543-ac43-01c5196ea2d2_01a170f9-ccfb-7bb0-b644-2de1c6968899.jsonl'), 445452334),
    (Path('/Users/zhengbingjin/.codex/sessions/2026/11/10/rollout-2026-11-10T01-44-28-01a170f9-afdb-7543-ac43-01c5196ea2d2_01a1c169-5784-7c03-990b-09798a87a851.jsonl'), None),
]
OUT.mkdir(exist_ok=True)
counts = collections.Counter()
index = []
users = []
finals = []
messages = []
sections = {'production': [], 'offline': [], 'fusion': []}
for source, limit in SOURCES:
    digest = hashlib.sha256()
    consumed = 0
    last_line = 0
    with source.open('rb') as stream:
        for number, raw in enumerate(stream, 1):
            if limit is not None and consumed >= limit:
                break
            if limit is not None and consumed + len(raw) > limit:
                raise ValueError('History boundary splits a JSONL record')
            consumed += len(raw)
            last_line = number
            digest.update(raw)
            record = json.loads(raw)
            payload = record.get('payload', {})
            kind = record.get('type')
            counts[kind] += 1
            if kind == 'response_item' and payload.get('type') == 'message':
                role = payload.get('role')
                content = '\n'.join(part.get('text', '') for part in payload.get('content', []) if isinstance(part, dict))
                content = re.sub(r'\b[A-Za-z0-9]{32}\.[A-Za-z0-9]{16}\b', '[REDACTED_API_KEY]', content)
                content = re.sub(r'\bsk-[A-Za-z0-9_-]{12,}\b', '[REDACTED_API_KEY]', content)
                phase = payload.get('phase', '')
                header = f'### {source.name}:{number} | {role} | {phase}\n\n'
                if role == 'user':
                    if content.startswith(('<codex_internal_context', '# AGENTS.md', '<environment_context')):
                        counts['injected_user_blocks'] += 1
                    else:
                        users.append(header + content + '\n')
                if role in ('user', 'assistant'):
                    if not content.startswith(('<codex_internal_context', '# AGENTS.md', '<environment_context')):
                        messages.append(header + content + '\n')
                        section = 'fusion' if source == SOURCES[1][0] or number >= 87349 else ('offline' if number >= 23856 else 'production')
                        sections[section].append(header + content + '\n')
                if role == 'assistant' and phase in ('final', 'final_answer'):
                    finals.append(header + content + '\n')
            if kind == 'event_msg' and payload.get('type') == 'task_complete':
                text = payload.get('last_agent_message')
                if text:
                    text = re.sub(r'\b[A-Za-z0-9]{32}\.[A-Za-z0-9]{16}\b', '[REDACTED_API_KEY]', text)
                    text = re.sub(r'\bsk-[A-Za-z0-9_-]{12,}\b', '[REDACTED_API_KEY]', text)
                    finals.append(f'### {source.name}:{number} | task_complete\n\n{text}\n')
            if kind == 'response_item' and payload.get('type') in ('function_call', 'custom_tool_call'):
                counts['tool_calls'] += 1
    index.append({'source':str(source), 'bytes_read':consumed, 'last_line':last_line, 'sha256':digest.hexdigest(), 'boundary':limit})
for name, entries in [('user-requests', users), ('final-reports', finals), ('visible-history', messages), *sections.items()]:
    (OUT / (name + '.md')).write_text('\n'.join(entries))
manifest = {'sources':index, 'counts':dict(counts), 'user_requests':len(users), 'final_reports':len(finals), 'visible_messages':len(messages)}
(OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'output':str(OUT), **manifest}, ensure_ascii=False, indent=2))
