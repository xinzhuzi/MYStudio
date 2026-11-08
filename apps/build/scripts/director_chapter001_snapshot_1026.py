"""Chapter-001 read-only snapshot; default checks, --export writes task evidence only.

No network, model, credentials, storage initialization, migration or project writes.
Only manifest-listed project shards and active chapter shards are opened.
"""
import argparse
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
PROJECT_ROOT = Path('/Users/zhengbingjin/Project/IP/MA')
PROJECT_ID = '49dce4c1-64b1-42de-85c2-9f266698aec4'
CHAPTER_ID = 'chapter-001'
RESEARCH = REPO / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026'
MANUAL_ROOT = REPO / 'apps/frontend/assets/studio-manuals'
MANUAL_NAMES = (
    'README.md', 'script_narrative.md',
    'driector_skills/director_planning_narrative.md',
    'driector_skills/director_storyboard_table_narrative.md',
    'driector_skills/director_style_card_fusion.md',
)


def digest(raw):
    return hashlib.sha256(raw.encode('utf8') if isinstance(raw, str) else raw).hexdigest()


def inside(file, root):
    resolved = Path(file).resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError('scope escape or non-file')
    return resolved


def validate_manifest(manifest):
    if manifest.get('layout') != 'studio-workflow-shards-v1' or manifest.get('activeChapterId') != CHAPTER_ID:
        raise ValueError('manifest layout or active chapter mismatch')
    if not isinstance(manifest.get('version'), int) or not isinstance(manifest.get('chapterIndex'), list):
        raise ValueError('manifest version/index missing')
    names = manifest.get('shards')
    if not isinstance(names, list) or len(names) != len(set(names)):
        raise ValueError('manifest shards missing or duplicated')
    for name in names:
        if not isinstance(name, str) or len(name) > 200 or '\\' in name:
            raise ValueError('unsafe shard name')
        parts = name.split('/')
        if (len(parts) != 1 and not (len(parts) == 3 and parts[0] == 'chapters')) or not name.endswith('.json'):
            raise ValueError('unsafe shard shape')
        if any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', part) or part in ('.', '..') for part in parts):
            raise ValueError('unsafe shard segment')
    return [name for name in names if not name.startswith('chapters/') or name.split('/')[1] == CHAPTER_ID]


def reject_secret_fields(value):
    if isinstance(value, dict):
        for key, item in value.items():
            if re.fullmatch(r'(?:apiKey|accessToken|refreshToken|password|credential|secret|authorization)', key, re.I):
                raise ValueError('secret-like field: export refused')
            reject_secret_fields(item)
    elif isinstance(value, list):
        for item in value:
            reject_secret_fields(item)


def collect_snapshot(project_root, expected_root=None):
    root = Path(project_root).resolve(strict=True)
    if root != Path(expected_root or PROJECT_ROOT).resolve():
        raise ValueError('project root mismatch')
    store = (root / 'store/studio-workflow').resolve(strict=True)
    if not store.is_relative_to(root):
        raise ValueError('scope escape: workflow root')
    sources = []

    def read(name):
        file = inside(store / name, store)
        raw = file.read_bytes()
        sources.append({'relativePath': 'store/studio-workflow/' + name, 'realpath': str(file), 'sha256': digest(raw), 'bytes': len(raw)})
        return raw.decode('utf8')

    manifest_raw = read('manifest.json')
    manifest = json.loads(manifest_raw)
    wanted = validate_manifest(manifest)
    state = {}
    shards = []
    for name in wanted:
        raw = read(name)
        envelope = json.loads(raw)
        if not isinstance(envelope.get('state'), dict) or envelope.get('version') != manifest['version']:
            raise ValueError('invalid shard envelope/version')
        for key, value in envelope['state'].items():
            state[key] = state[key] + value if isinstance(state.get(key), list) and isinstance(value, list) else value
        shards.append({'relativePath': name, 'content': raw, 'sha256': digest(raw)})
    if state.get('seriesBible', {}).get('projectId') != PROJECT_ID:
        raise ValueError('project identity mismatch')
    chapter = next((item for item in state.get('novelChapters', []) if item.get('id') == CHAPTER_ID), None)
    if not chapter or not isinstance(chapter.get('sourceText'), str) or not chapter['sourceText'].strip():
        raise ValueError('chapter source missing')
    if not isinstance(chapter.get('revision'), int) or not chapter.get('sourceId'):
        raise ValueError('chapter source identity missing')
    state['novelChapters'] = [chapter if entry['id'] == CHAPTER_ID else entry for entry in manifest['chapterIndex']]
    state['activeChapterId'] = CHAPTER_ID
    batch = next((item for item in state.get('entityExtractions', []) if item.get('episodeId') == CHAPTER_ID), {})
    inventory = []
    for field, label in (('characters', '角色'), ('scenes', '场景'), ('props', '道具')):
        names = []
        for item in batch.get(field, []):
            names.extend([item['name'], *item.get('aliases', [])] if field == 'characters' else [item['name']])
        names = list(dict.fromkeys(name for name in names if name))
        if names:
            inventory.append('- ' + label + '：' + '；'.join(names))
    latest = {}
    for stage in ('scriptDraft', 'directorPlan', 'storyboardTable'):
        items = [item for item in state.get('agentWorkData', []) if item.get('episodeId') == CHAPTER_ID and item.get('key') == stage]
        latest[stage] = max(items, key=lambda item: item['updatedAt']) if items else None
    result = {
        'schemaVersion': 1, 'projectId': PROJECT_ID, 'projectRoot': str(root), 'chapterId': CHAPTER_ID,
        'createdAt': datetime.now(timezone.utc).isoformat(), 'manifest': manifest, 'manifestRaw': manifest_raw,
        'manifestSha256': digest(manifest_raw), 'sourceFiles': sources, 'shards': shards,
        'envelope': {'state': state, 'version': manifest['version']},
        'input': {'episodeId': CHAPTER_ID, 'chapterTitle': chapter['title'], 'chapterText': chapter['sourceText'], 'bibleContext': state.get('sourceBible', ''), 'assetsInventory': '\n'.join(inventory)},
        'sourceSha256': digest(chapter['sourceText']), 'latestStageWork': latest,
        'runtimeConfig': state.get('workflowConfig', {}),
        'contextBoundary': 'bibleContext is manifest-backed sourceBible only; resident MEMORY.md, preference and archive retrieval are not read or asserted equivalent',
        'otherChapterShardNames': [name for name in manifest['shards'] if name.startswith('chapters/') and name.split('/')[1] != CHAPTER_ID],
        'projectWrites': 0,
    }
    reject_secret_fields(result)
    verify_sources(result, expected_root=root)
    return result


def verify_sources(snapshot, expected_root=None):
    root = Path(snapshot['projectRoot']).resolve(strict=True)
    if root != Path(expected_root or PROJECT_ROOT).resolve(strict=True) or snapshot['projectId'] != PROJECT_ID:
        raise ValueError('project root/identity mismatch')
    wanted = validate_manifest(snapshot['manifest'])
    allowed = {'store/studio-workflow/' + name for name in ['manifest.json', *wanted]}
    if {item['relativePath'] for item in snapshot['sourceFiles']} != allowed:
        raise ValueError('source file scope mismatch')
    for item in snapshot['sourceFiles']:
        file = inside(root / item['relativePath'], root / 'store/studio-workflow')
        if str(file) != item['realpath'] or digest(file.read_bytes()) != item['sha256']:
            raise ValueError('source changed')


def freeze_manuals():
    files = []
    for name in MANUAL_NAMES:
        relative = 'story_skills/Daojie_xianxia/' + name
        file = inside(MANUAL_ROOT / relative, MANUAL_ROOT.resolve())
        raw = file.read_bytes()
        files.append({'relativePath': relative, 'content': raw.decode('utf8'), 'sha256': digest(raw)})
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-root', type=Path, default=PROJECT_ROOT)
    parser.add_argument('--export', action='store_true', help='write new task-only evidence directory; never write project')
    parser.add_argument('--output-dir', type=Path, help='new directory strictly inside task research/chapter001-repair-1026')
    parser.add_argument('--verify', type=Path, help='recheck source hashes from an exported snapshot; no writes')
    args = parser.parse_args()
    if args.verify:
        file = inside(args.verify, RESEARCH.resolve(strict=True))
        verify_sources(json.loads(file.read_bytes()))
        print(json.dumps({'verified': True, 'projectWrites': 0}))
        return
    snapshot = collect_snapshot(args.project_root)
    summary = {'manifestSha256': snapshot['manifestSha256'], 'sourceSha256': snapshot['sourceSha256'], 'readFiles': len(snapshot['sourceFiles']), 'chapters': len(snapshot['manifest']['chapterIndex']), 'projectWrites': 0}
    if args.export:
        output = (args.output_dir or RESEARCH / datetime.now(timezone.utc).strftime('snapshot-%Y%m%dT%H%M%S%fZ')).resolve()
        if not output.is_relative_to(RESEARCH.resolve()) or output == RESEARCH.resolve():
            raise ValueError('output scope mismatch')
        manuals = freeze_manuals()
        verify_sources(snapshot)
        output.mkdir(parents=True, exist_ok=False)
        for name, value in (('snapshot.json', snapshot), ('input.json', snapshot['input']), ('manuals.json', manuals)):
            with (output / name).open('x', encoding='utf8') as stream:
                json.dump(value, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
        summary['outputDirectory'] = str(output)
    elif args.output_dir:
        parser.error('--output-dir requires --export')
    print(json.dumps(summary))


if __name__ == '__main__':
    main()
