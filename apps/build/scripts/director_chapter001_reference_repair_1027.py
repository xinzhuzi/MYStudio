"""Read-only first-chapter reference evidence; writes a NEW task directory only."""
import hashlib
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

REPO = Path(__file__).resolve().parents[3]
RESEARCH = REPO / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research'
BASE = RESEARCH / 'chapter001-repair-1026'
SNAPSHOT = BASE / 'snapshot-20261026T161314424840Z/snapshot.json'
PID = '49dce4c1-64b1-42de-85c2-9f266698aec4'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    snapshot = json.loads(SNAPSHOT.read_text())
    user_data = next(p for p in (Path.home() / 'Library/Application Support').iterdir()
                     if p.name == '漫影工作室')
    locations_file = user_data / 'project-locations.json'
    marker_file = user_data / 'asset-home.json'
    locations = json.loads(locations_file.read_text())
    marker = json.loads(marker_file.read_text())
    root = Path(locations['locations'][PID]).resolve(strict=True)
    assert root == Path(snapshot['projectRoot']).resolve(strict=True)
    assert marker['projectId'] == PID and marker['assetsStoreMigrated'] is True
    assert Path(marker['lastKnownLocation']).resolve(strict=True) == root
    asset_root = root / 'store/assets'
    db = asset_root / 'assets.db'
    assert not Path(str(db) + '-wal').exists(), 'Stop: active WAL requires a new read plan'
    index_path = BASE / 'reference-v5-full-1027/index.json'
    provenance_path = BASE / 'reference-v5-full-1027/provenance.json'
    review_path = BASE / 'reference-v5-full-1027/primary-contact-review.json'
    provenance = json.loads(provenance_path.read_text())
    manifest_path = Path(provenance['source'])
    manifest = json.loads(manifest_path.read_text())
    assert sha(manifest_path) == provenance['manifestSha256']
    protected = [SNAPSHOT, locations_file, marker_file, db, index_path, review_path, manifest_path]
    protected += [Path(x['realpath']) for x in snapshot['sourceFiles']]
    before = {str(p): sha(p) for p in dict.fromkeys(protected)}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    out = RESEARCH / ('chapter001-reference-repair-evidence-' + stamp)
    out.mkdir(exist_ok=False)

    def write(name, value):
        with (out / name).open('x') as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.write('\n')

    source = snapshot['input']['chapterText']
    assert hashlib.sha256(source.encode()).hexdigest() == snapshot['sourceSha256']
    with (out / 'chapter-source-lines.txt').open('x') as f:
        f.write('\n'.join(f'{i}: {line}' for i, line in enumerate(source.splitlines(), 1)) + '\n')
    batch = snapshot['envelope']['state']['entityExtractions'][0]
    entities = []
    for collection, key in [('characters', 'characterId'), ('scenes', 'sceneId'), ('props', 'assetId')]:
        entities += [dict(x, exactId=x[key], collection=collection) for x in batch[collection]]
    write('source-entities.json', entities)
    connection = sqlite3.connect(db.as_uri() + '?mode=ro&immutable=1', uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute('pragma query_only=on')
    columns = [x['name'] for x in connection.execute('pragma table_info(assets)')]
    names = sorted({e['name'] for e in entities} | {'铁山', '李先生'})
    rows = [dict(x) for x in connection.execute(
        'select id,type,name,description,prompt,filePath,images,remark,updatedAt from assets where name in ('
        + ','.join('?' for _ in names) + ') order by name,id', names)]
    connection.close()
    all_images = []
    for row in rows:
        references = [{'name': '[filePath]', 'filePath': row['filePath']}]
        references += json.loads(row['images'] or '[]')
        seen = set()
        resolved = []
        for image in references:
            relative = image.get('filePath')
            if not relative or relative in seen:
                continue
            seen.add(relative)
            path = (asset_root / 'files' / relative).resolve()
            assert path.is_relative_to((asset_root / 'files').resolve()), 'asset path escape'
            item = {'storeId': row['id'], 'storeName': row['name'], 'imageName': image['name'],
                    'path': str(path), 'exists': path.is_file(),
                    'sha256': sha(path) if path.is_file() else None}
            resolved.append(item)
            all_images.append(item)
        row['resolvedImages'] = resolved
        row['hasApprovalColumn'] = any('approv' in x.lower() for x in columns)
    write('store-records.json', rows)
    stored_versions = snapshot['envelope']['state']['continuityAssetVersions']
    write('stored-versions.json', [{k: v.get(k) for k in (
        'assetId', 'versionId', 'assetKind', 'label', 'referenceImagePaths', 'referenceImageSha256',
        'approved', 'reviewStatus', 'approval', 'source', 'structurallyComplete')}
        for v in stored_versions])
    by_entity = {e['exactId']: e for e in entities}
    by_version = {v['versionId']: v for v in stored_versions}
    plans = {a['versionId']: a for a in manifest['assetPlan']}
    mapping = []
    for n, entry in enumerate(json.loads(index_path.read_text()), 1):
        assert sha(Path(entry['path'])) == entry['sha256']
        e = by_entity.get(entry['assetId'])
        v = by_version.get(entry['versionId'])
        mapping.append(dict(entry, number=n, sourceEntity=e,
                            snapshotApproval=None if v is None else {
                                'approved': v.get('approved'), 'reviewStatus': v.get('reviewStatus'),
                                'status': v.get('approval', {}).get('status')},
                            manifestSourcePaths=plans[entry['versionId']]['sourcePaths'],
                            exactNameStoreIds=[] if e is None else [r['id'] for r in rows if r['name'] == e['name']],
                            storeLinkMeaning='exact name only; IDs remain distinct; no inferred identity merge'))
    write('reference-mapping.json', mapping)
    selected = []
    contact_names = {'旧布背囊', '管事', '断臂散修', '铁山', '李先生', '小杂役', '晏燎'}
    for row in rows:
        if row['name'] not in contact_names:
            continue
        items = row['resolvedImages']
        selected += [x for x in items if x['exists'] and (
            x['imageName'] == '[filePath]' or row['name'] == '小杂役' or
            (row['name'] == '晏燎' and ('练气期' in x['imageName'] or '无衣物定妆' in x['imageName'])))]
    font = ImageFont.truetype('/Library/Fonts/Arial Unicode.ttf', 18)
    for page in range((len(selected) + 5) // 6):
        canvas = Image.new('RGB', (1600, 1080), '#eeeeee')
        draw = ImageDraw.Draw(canvas)
        for offset, item in enumerate(selected[page * 6:(page + 1) * 6]):
            x, y = offset % 2 * 800, offset // 2 * 360
            with Image.open(item['path']) as im:
                tile = ImageOps.contain(im.convert('RGB'), (780, 300))
                canvas.paste(tile, (x + (800 - tile.width) // 2, y))
            draw.text((x + 8, y + 305), f"{page * 6 + offset + 1}. {item['storeName']} {item['imageName']}", fill='black', font=font)
            draw.text((x + 8, y + 334), item['sha256'][:40], fill='black', font=font)
        canvas.save(out / f'store-contact-{page + 1}.jpg', quality=92)
    write('store-contact-index.json', selected)
    after = {p: sha(Path(p)) for p in before}
    write('provenance.json', {'createdAt': stamp, 'sourceSha256': snapshot['sourceSha256'],
          'projectRoot': str(root), 'assetRoot': str(asset_root), 'databaseSchemaColumns': columns,
          'manifestApprovalSummary': manifest['approvalSummary'], 'referenceCount': len(mapping),
          'storeRecordCount': len(rows), 'contactImageCount': len(selected),
          'protectedBefore': before, 'protectedAfter': after, 'protectedUnchanged': before == after,
          'projectWrites': 0, 'approvalWrites': 0, 'modelCalls': 0, 'networkCalls': 0})
    assert before == after, 'Concurrent protected-file drift; do not treat evidence as stable'
    print(json.dumps({'output': str(out), 'references': len(mapping), 'storeRecords': len(rows),
                      'contactImages': len(selected), 'protectedUnchanged': True}))


if __name__ == '__main__':
    main()
