#!/usr/bin/env python3
"""Read-only current production extraction reconciliation for the approved 10-20 audit."""
import hashlib
import json
import sys
from pathlib import Path
import repair_entity_extraction_1020 as repair

repo = Path(__file__).resolve().parents[3]
output = repo / '.trellis/tasks/10-20-trellis-audit-remediation/research'
app = next(p for p in (Path.home() / 'Library/Application Support').iterdir() if p.name == '漫影工作室')
registry = app / 'projects/mystudio-project-store.json'
project = next(p for p in json.loads(registry.read_text())['state']['projects'] if p['id'] == '49dce4c1-64b1-42de-85c2-9f266698aec4')
root = Path(project['location'])
locations = json.loads((app / 'project-locations.json').read_text())
assert locations['locations'][project['id']] == str(root)
corpus = repair.parse_corpus(repair.DEFAULT_CORPUS)
libraries = {k: repair.load_json(root / rel)['state'][repair.LIB_STATE_KEY[k]] for k, rel in repair.KIND_LIB_REL.items()}
canon, by_id = repair.build_library_indexes(libraries)
clusters = {}
for chapter, rows in corpus.items():
    cleaned = []
    for row in rows:
        if row['kind'] == 'character' and repair.normalize(row['name']) in repair.HARD_JUNK_NORM:
            continue
        if row['kind'] == 'character' and row['name'].startswith('闪回') and repair.normalize(row['name'][2:]) in canon['character']:
            row = dict(row, name=row['name'][2:])
        cleaned.append(row)
    clusters[chapter] = repair.dedupe_clusters(cleaned)
shards = repair.load_shards(root / repair.CHAPTERS_REL)
index_path = root / repair.APPEARANCE_REL
index = repair.load_json(index_path)
chapters = sorted(shards, key=repair.chapter_number)
count = sum(repair.record_id(k, r) in by_id[k] for s in shards.values() for k, field in repair.KIND_KEYS.items() for r in s['batch'].get(field, []))
stats = dict(generic_tokens=repair.build_generic_tokens(clusters, 5), library_id_records_before=count, id_detached=0, duplicate_id_merged=0, duplicate_id_split=0, output_id_split=0)
validation = repair.validate(shards, clusters, chapters, index, by_id, stats)
missing_chapters = sorted(set(corpus) - set(shards))
linked_wrong = []
same_name_unlinked = []
for chapter, shard in shards.items():
    for kind, field in repair.KIND_KEYS.items():
        for row in shard['batch'].get(field, []):
            linked = by_id[kind].get(repair.record_id(kind, row))
            exact = canon[kind].get(repair.normalize(row.get('name', '')), [])
            if linked and exact and linked['id'] not in {x['id'] for x in exact}:
                linked_wrong.append([chapter, kind, row.get('name'), linked.get('name')])
            if exact and not linked:
                same_name_unlinked.append([chapter, kind, row.get('name'), repair.record_id(kind, row)])
result = dict(projectId=project['id'], registry=str(registry), projectRoot=str(root), chapters=len(shards), corpusChapters=len(corpus), records=sum(len(s['batch'].get(v, [])) for s in shards.values() for v in repair.KIND_KEYS.values()), indexEntries=len(index), indexSha256=hashlib.sha256(index_path.read_bytes()).hexdigest(), missingChapters=missing_chapters, validation=validation, linkedWrongCanonical=linked_wrong, exactNameUnlinked=same_name_unlinked, exactNameUnlinkedMeaning='Review queue only: matching names do not prove identity or an eligible library promotion', productionWritten=False)
(output / 'current-extraction-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in result.items() if k!='validation'}, ensure_ascii=False))
print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in validation.items()}, ensure_ascii=False))
sys.exit(0 if not missing_chapters and not validation['cluster_missing_count'] and not validation['index_missing_count'] and not validation['duplicate_id_count'] and not linked_wrong else 2)
