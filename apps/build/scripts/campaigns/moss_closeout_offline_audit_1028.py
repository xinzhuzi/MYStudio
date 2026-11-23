"""Audit recovered MOSS receipts/PNGs offline; never execute a workflow or alter originals."""
import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--evidence', type=Path, required=True)
args = parser.parse_args()
root = args.evidence
originals = root / 'originals'
summary = json.loads((originals / 'summary_14types.json').read_text(encoding='utf-8-sig'))
rows = []
for item in summary:
    for attempt in item['attempts']:
        receipt = json.loads((originals / attempt['receipt']).read_text(encoding='utf-8-sig'))
        image_path = root / 'images' / attempt['image']
        with Image.open(image_path) as image:
            image.load()
            mode, size = image.mode, list(image.size)
            alpha = np.asarray(image.convert('RGBA'), dtype=np.uint8)[:, :, 3]
            gray = np.asarray(image.convert('L'), dtype=np.float64)
            padded = np.pad(gray, 1, mode='edge')
            lap = (padded[:-2, 1:-1] + padded[2:, 1:-1]
                   + padded[1:-1, :-2] + padded[1:-1, 2:] - 4.0 * padded[1:-1, 1:-1])
            lapvar = round(float(lap.var()), 2)
            embedded = json.loads(image.info['prompt']) if 'prompt' in image.info else None
        prompt_path = originals / ('prompt_%02d_%s.txt' % (item['id'], attempt['attempt']))
        graph = receipt['graph']
        file_entry = [f for f in receipt['files'] if f['filename'] == attempt['image']]
        actual_bytes = image_path.stat().st_size
        checks = {
            'fullDecode': True,
            'summarySize': size == [item['w'], item['h']],
            'graphSize': size == [graph['6']['inputs']['width'], graph['6']['inputs']['height']],
            'seed': graph['7']['inputs']['seed'] == attempt['seed'],
            'promptTextUniversalNewlines': graph['100']['inputs']['value'] == prompt_path.read_text(encoding='utf-8-sig'),
            'receiptBytes': len(file_entry) == 1 and file_entry[0]['bytes'] == actual_bytes,
            'summaryBytes': attempt['verify']['bytes'] == actual_bytes,
            'summaryMode': attempt['verify']['mode'] == mode,
            'summaryLaplacian': attempt['verify']['laplacian_var'] == lapvar,
            'summaryAlphaRatio': attempt['verify']['alpha_transparent_ratio'] == float((alpha < 255).mean()),
            'embeddedGraph': embedded == graph,
        }
        rows.append({'id': item['id'], 'kind': item['zh'], 'attempt': attempt['attempt'],
                     'receipt': attempt['receipt'], 'image': attempt['image'],
                     'sha256': hashlib.sha256(image_path.read_bytes()).hexdigest(),
                     'laplacianVar': lapvar, 'mode': mode, 'size': size, 'checks': checks})
initial = []
for path in sorted(originals.glob('t0*.json')):
    receipt = json.loads(path.read_text(encoding='utf-8-sig'))
    if 'files' not in receipt:
        continue
    files = []
    for entry in receipt['files']:
        image_path = root / 'images' / entry['filename']
        with Image.open(image_path) as image:
            image.load()
            embedded = json.loads(image.info['prompt']) if 'prompt' in image.info else None
            contract_graph = json.loads(json.dumps(embedded))
            metadata_difference = None
            if (path.name == 't08-7e61fcc6-5b76-4150-a475-57a02fdafd75.json'
                    and embedded is not None
                    and embedded.get('7', {}).get('is_changed') == [
                        '3ff6e5975bce313cffa0b8a8f4a27bd84f4a28a4c269d57f89bf03dd509319d4']
                    and 'is_changed' not in receipt['graph'].get('7', {})):
                metadata_difference = {'node': '7', 'field': 'is_changed',
                                       'pngValue': contract_graph['7'].pop('is_changed')}
            files.append({'image': entry['filename'], 'size': list(image.size),
                          'receiptBytes': image_path.stat().st_size == entry['bytes'],
                          'embeddedGraph': embedded == receipt['graph'],
                          'graphAfterObservedMetadataExclusion': contract_graph == receipt['graph'],
                          'observedMetadataDifference': metadata_difference})
    initial.append({'receipt': path.name, 'test': receipt['test'], 'files': files,
                    'nodeClasses': sorted({n['class_type'] for n in receipt['graph'].values()})})
failures = [{'id': row['id'], 'attempt': row['attempt'], 'check': key}
            for row in rows for key, ok in row['checks'].items() if not ok]
initial_failures = [{'receipt': row['receipt'], 'image': f['image']}
                    for row in initial for f in row['files']
                    if not f['receiptBytes'] or not f['graphAfterObservedMetadataExclusion']]
result = {'formalRows': len(summary), 'formalAttempts': len(rows),
          'summaryStatuses': [row['status'] for row in summary],
          'batcherLogged': sorted({row['batcher_logged'] for row in summary}),
          'allOfflineVerify': all(row['offline_verify'] for row in summary),
          'rows': rows, 'initialReceipts': initial,
          'failures': failures, 'initialFailures': initial_failures,
          'limits': 'Offline evidence audit only; no fresh generation, plugin execution, aesthetics or installed-state acceptance.'}
(root / 'offline-audit.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'formalRows': len(summary), 'formalAttempts': len(rows),
                  'formalFailures': len(failures), 'initialReceipts': len(initial),
                  'initialFailures': len(initial_failures)}, ensure_ascii=False))
raise SystemExit(1 if failures or initial_failures else 0)
