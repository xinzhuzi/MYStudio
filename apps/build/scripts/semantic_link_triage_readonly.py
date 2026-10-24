"""Read-only linkage inventory; optionally create one exclusive research JSON."""

import argparse
import hashlib
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
PROJECT = Path('/Users/zhengbingjin/Project/IP/MA')
TASK = ROOT / '.trellis/tasks/10-19-script-asset-extract-all-chapters'
AUDIT = ROOT / '.trellis/tasks/10-20-trellis-audit-remediation/research/current-extraction-audit.json'
OUTPUT = TASK / 'research/semantic-link-triage-data.json'
GROUPS = {
    'character': ('characters', 'characterId', 'characters', 'description', 'char'),
    'scene': ('scenes', 'sceneId', 'scenes', 'notes', 'scene'),
    'prop': ('props', 'assetId', 'items', 'description', 'prop'),
}


def digest(content):
    return hashlib.sha256(content).hexdigest()


def text_digest(value):
    return digest(value.encode('utf-8')) if isinstance(value, str) else None


def compare_text(left, right):
    if not isinstance(left, str) or not isinstance(right, str):
        return 'unavailable'
    if not left or not right:
        return 'empty_both' if left == right else 'empty_one'
    return 'equal_nonempty' if left == right else 'different_nonempty'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write-data', action='store_true', help='Create fixed new research JSON; refuses overwrite')
    args = parser.parse_args()
    if args.write_data and OUTPUT.exists():
        raise FileExistsError(OUTPUT)
    started = datetime.now(timezone.utc).isoformat()
    inputs = {}

    def read_json(source):
        raw = source.read_bytes()
        inputs[str(source)] = {'sha256Before': digest(raw), 'bytesBefore': len(raw)}
        return json.loads(raw)

    audit = read_json(AUDIT)
    project_id = audit['projectId']
    workflow = PROJECT / 'store/studio-workflow'
    manifest = read_json(workflow / 'manifest.json')
    appearances = read_json(PROJECT / 'store/extraction/entity-appearances.json')
    library_ids = {kind: defaultdict(list) for kind in GROUPS}
    library_names = {kind: defaultdict(list) for kind in GROUPS}
    library_counts = {}
    for kind, (field, _, library_field, _, _) in GROUPS.items():
        source = PROJECT / 'store' / f'{field}.json'
        items = read_json(source)['state'][library_field]
        scoped = 0
        for position, item in enumerate(items):
            if item.get('projectId') != project_id:
                continue
            scoped += 1
            wrapped = {'value': item, 'file': str(source), 'pointer': f'/state/{library_field}/{position}'}
            library_ids[kind][item['id']].append(wrapped)
            library_names[kind][item['name']].append(wrapped)
        library_counts[kind] = {'all': len(items), 'project': scoped}
    index_names = defaultdict(list)
    for key, entry in appearances.items():
        index_names[(entry['kind'], entry['name'])].append((key, entry))
    records = defaultdict(list)
    by_name = defaultdict(list)
    extraction_paths = [relative for relative in manifest['shards'] if Path(relative).name.startswith('entity-extractions-')]
    assert len(extraction_paths) == len(set(extraction_paths))
    all_records = []
    for relative in extraction_paths:
        source = workflow / relative
        assert source.resolve().is_relative_to(workflow.resolve())
        batches = read_json(source)['state']['entityExtractions']
        for batch_position, batch in enumerate(batches):
            chapter = batch['episodeId']
            for kind, (field, id_field, _, _, _) in GROUPS.items():
                for position, item in enumerate(batch[field]):
                    wrapped = {
                        'value': item, 'chapter': chapter, 'kind': kind,
                        'file': str(source), 'batchId': batch['id'],
                        'pointer': f'/state/entityExtractions/{batch_position}/{field}/{position}',
                    }
                    records[(chapter, kind, item['name'], item[id_field])].append(wrapped)
                    by_name[(chapter, kind, item['name'])].append(wrapped)
                    all_records.append(wrapped)

    def library_view(wrapped, note, text_field):
        value = wrapped['value']
        return {
            'id': value['id'], 'name': value['name'], 'file': wrapped['file'], 'pointer': wrapped['pointer'],
            'descriptionComparison': compare_text(note, value.get('description')),
            'descriptionSha256': text_digest(value.get('description')),
            'storedTextField': text_field,
            'storedTextComparison': compare_text(note, value.get(text_field)),
            'storedTextSha256': text_digest(value.get(text_field)),
        }

    def record_view(wrapped):
        item = wrapped['value']
        kind = wrapped['kind']
        _, id_field, _, text_field, prefix = GROUPS[kind]
        current_id = item[id_field]
        linked = library_ids[kind].get(current_id, [])
        exact = library_names[kind].get(item['name'], [])
        link_status = ('missing' if not linked else 'multiple_id_records' if len(linked) > 1
                       else 'same_name' if linked[0]['value']['name'] == item['name'] else 'different_name')
        return {
            'file': wrapped['file'], 'pointer': wrapped['pointer'], 'batchId': wrapped['batchId'],
            'name': item['name'], 'idField': id_field, 'id': current_id,
            'syntheticIdShape': re.fullmatch(re.escape(prefix + '-' + wrapped['chapter'] + '-') + r'[1-9][0-9]*', current_id) is not None,
            'noteSha256': text_digest(item.get('note')), 'linkStatus': link_status,
            'linkedLibraryRecords': [library_view(target, item.get('note'), text_field) for target in linked],
            'exactNameLibraryCount': len(exact),
            'exactNameLibraryRecords': [library_view(target, item.get('note'), text_field) for target in exact],
        }

    rows = []
    for position, old in enumerate(audit['exactNameUnlinked']):
        chapter, kind, name, old_id = old
        matches = records.get(tuple(old), [])
        current_name = by_name.get((chapter, kind, name), [])
        exact = library_names[kind].get(name, [])
        index_matches = index_names.get((kind, name), [])
        rows.append({
            'queueIndex': position, 'queuePointer': f'/exactNameUnlinked/{position}',
            'chapter': chapter, 'kind': kind, 'name': name, 'oldId': old_id,
            'oldTupleOccurrenceCount': len(matches), 'currentSameNameOccurrenceCount': len(current_name),
            'oldTupleStillExists': bool(matches),
            'disposition': 'same_old_tuple' if len(matches) == 1 else 'multiple_old_tuples' if matches else 'old_tuple_absent',
            'exactNameLibraryCount': len(exact),
            'stillUnlinkedExactNameSignal': bool(matches and exact and not library_ids[kind].get(old_id)),
            'records': [record_view(match) for match in matches],
            'sameNameOtherIds': [record_view(match) for match in current_name if match not in matches],
            'appearanceEntries': [{
                'key': key, 'firstChapterId': entry.get('firstChapterId'),
                'chapterCount': len(entry['chapterIds']), 'hasChapter': chapter in entry['chapterIds'],
                'importance': entry.get('importance'),
            } for key, entry in index_matches],
            'identityApproved': False,
        })

    current_signal = []
    wrong_name_links = []
    for wrapped in all_records:
        kind = wrapped['kind']
        item = wrapped['value']
        current_id = item[GROUPS[kind][1]]
        linked = library_ids[kind].get(current_id, [])
        key = [wrapped['chapter'], kind, item['name'], current_id]
        if not linked and library_names[kind].get(item['name']):
            current_signal.append(key)
        if len(linked) == 1 and linked[0]['value']['name'] != item['name']:
            wrong_name_links.append({'key': key, 'linkedName': linked[0]['value']['name']})
    old_set = {tuple(item) for item in audit['exactNameUnlinked']}
    current_set = {tuple(item) for item in current_signal}
    records_in_queue = [item for row in rows for item in row['records']]
    exact_targets = [target for item in records_in_queue for target in item['exactNameLibraryRecords']]
    summary = {
        'queueRows': len(rows), 'queueUniqueTuples': len(old_set),
        'oldTupleExistsRows': sum(row['oldTupleStillExists'] for row in rows),
        'stillSignalRows': sum(row['stillUnlinkedExactNameSignal'] for row in rows),
        'byKind': dict(Counter(row['kind'] for row in rows)),
        'chapterCount': len({row['chapter'] for row in rows}),
        'byChapter': dict(sorted(Counter(row['chapter'] for row in rows).items())),
        'linkStatus': dict(Counter(item['linkStatus'] for item in records_in_queue)),
        'exactNameMatchCounts': dict(Counter(str(row['exactNameLibraryCount']) for row in rows)),
        'syntheticIdShapeRows': sum(item['syntheticIdShape'] for item in records_in_queue),
        'descriptionComparisons': dict(Counter(target['descriptionComparison'] for target in exact_targets)),
        'storedTextComparisons': dict(Counter(target['storedTextComparison'] for target in exact_targets)),
        'storedTextComparisonsByKind': {kind: dict(Counter(
            target['storedTextComparison'] for row in rows if row['kind'] == kind
            for item in row['records'] for target in item['exactNameLibraryRecords']
        )) for kind in GROUPS},
        'appearanceMatchCounts': dict(Counter(str(len(row['appearanceEntries'])) for row in rows)),
        'appearanceHasChapterRows': sum(any(entry['hasChapter'] for entry in row['appearanceEntries']) for row in rows),
        'appearanceTwoOrMoreChapterRows': sum(any(entry['chapterCount'] >= 2 for entry in row['appearanceEntries']) for row in rows),
        'distinctKindNamePairs': len({(row['kind'], row['name']) for row in rows}),
        'currentAllBookSignalRows': len(current_signal),
        'newSignalTuples': [list(item) for item in sorted(current_set - old_set)],
        'noLongerSignalTuples': [list(item) for item in sorted(old_set - current_set)],
        'currentDifferentNameLinkRows': wrong_name_links,
    }
    bag = [record_view(item) for item in by_name[('chapter-001', 'prop', '旧布背囊')]]
    expected_bag = bool(len(bag) == 1 and bag[0]['id'] == 'prop-chapter-001-7'
                        and bag[0]['linkStatus'] == 'different_name'
                        and bag[0]['linkedLibraryRecords'][0]['name'] == '残卷'
                        and any(item['id'] == 'prop_1792510150077_hi4lf'
                                and item['descriptionComparison'] == 'equal_nonempty'
                                for item in bag[0]['exactNameLibraryRecords']))
    evidence_sources = [
        TASK / 'check.jsonl', TASK / 'prd.md', TASK / 'design.md', TASK / 'implement.md',
        ROOT / 'apps/frontend/lib/studio/entity-sync.ts',
        ROOT / 'apps/frontend/lib/studio/entity-extraction-runner.ts',
        ROOT / 'apps/frontend/lib/studio/entity-appearances.ts',
        ROOT / 'apps/frontend/lib/studio/entity-extraction.ts', Path(__file__).resolve(),
        AUDIT.parent / 'docs-extraction-brief.md', AUDIT.parent / 'final-report.md',
    ]
    for source in evidence_sources:
        raw = source.read_bytes()
        inputs[str(source)] = {'sha256Before': digest(raw), 'bytesBefore': len(raw)}
    drift = []
    for source, details in inputs.items():
        raw = Path(source).read_bytes()
        details.update(sha256After=digest(raw), bytesAfter=len(raw))
        if details['sha256Before'] != details['sha256After']:
            drift.append(source)
    assert len(rows) == 1700
    assert sum(summary['byKind'].values()) == len(rows)
    assert len({row['queueIndex'] for row in rows}) == len(rows)
    assert all(row['identityApproved'] is False for row in rows)
    result = {
        'schemaVersion': 1, 'startedAtUtc': started, 'finishedAtUtc': datetime.now(timezone.utc).isoformat(),
        'projectId': project_id, 'sourceAudit': str(AUDIT), 'productionWritten': False,
        'identityApprovalCount': 0,
        'comparisonContract': {
            'oldRecordExists': 'Only the historic four-tuple chapter/kind/name/id is available; not historical full-record equality.',
            'exactName': 'Literal Unicode equality; same kind, projectId scoped, no normalization or alias matching.',
            'description': 'Extraction note vs library description; scenes compare notes separately, not mislabeled description.',
            'syntheticIdShape': 'Syntax only; ID is also resolved in library. Shape does not prove absence (bag counterexample).',
            'appearance': 'Exact kind/name entry only; no inference of identity from index aggregation.',
            'limitation': 'No semantic/source reading or identity approval. Before/after hashes are not an atomic snapshot.',
        },
        'current': {'manifestExtractionFiles': len(extraction_paths), 'batchRecordCount': len(all_records),
                    'chapterCount': len({item['chapter'] for item in all_records}),
                    'indexEntryCount': len(appearances), 'libraries': library_counts,
                    'indexHashEqualsOldAudit': inputs[str(PROJECT / 'store/extraction/entity-appearances.json')]['sha256Before'] == audit['indexSha256']},
        'summary': summary, 'knownChapter001Bag': {'expectedOldContinues': expected_bag, 'records': bag},
        'observedDrift': {'inputFileCount': len(inputs), 'changedFiles': drift, 'stable': not drift},
        'inputHashes': inputs, 'rows': rows,
    }
    if args.write_data:
        with OUTPUT.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
    visible_summary = {key: value for key, value in summary.items() if key != 'byChapter'}
    print(json.dumps({'current': result['current'], 'summary': visible_summary,
                      'bagExpectedOld': expected_bag, 'drift': result['observedDrift'],
                      'output': str(OUTPUT) if args.write_data else None}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
