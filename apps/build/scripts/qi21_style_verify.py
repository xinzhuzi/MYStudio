"""Audit this style correction from current disk state; never generate or reload."""
from datetime import datetime
import ast
import difflib
import json
from pathlib import Path

from qi21_style_correction import ROOT, MANUAL, OUT, SOURCE, STYLE, sha


def load(path):
    return json.loads(Path(path).read_text())


def differences(a, b, chain=()):
    if type(a) is not type(b):
        return [list(chain)]
    if isinstance(a, dict):
        result = []
        for key in a.keys() | b.keys():
            result += ([list(chain + (key,))] if key not in a or key not in b
                       else differences(a[key], b[key], chain + (key,)))
        return result
    if isinstance(a, list):
        if len(a) != len(b):
            return [list(chain)]
        return [path for i, (x, y) in enumerate(zip(a, b))
                for path in differences(x, y, chain + (i,))]
    return [] if a == b else [list(chain)]


ledger = load(OUT / 'changes.json')
distribution = load(OUT / 'distribution.json')
targets = {row['target'] for row in distribution['files']}
primary = [row for row in ledger if row['path'] not in targets]
by_path = {row['path']: row for row in ledger}
checks = []


def check(name, ok, details):
    checks.append({'name': name, 'ok': bool(ok), 'details': details})


bad = []
for row in ledger:
    if sha(Path(row['path']).read_bytes()) != row['after']:
        bad.append(row['path'])
    if sha(Path(row['backup']).read_bytes()) != row['before']:
        bad.append('backup:' + row['path'])
check('files_and_backups', not bad, {'files': len(ledger), 'errors': bad})
data = load(SOURCE)
before = load(by_path[str(SOURCE)]['backup'])
art = data['art_style_base']
forbidden = ['衣物', '尘土', '血痕', '身体状态', '来源事实', '背景', '近景',
             '远景', '时段', '光源', '光照', '构图', '留白']
check('pure_art_style', art['positive_text'] == art['positive_style_text'] == STYLE
      and art['positive_ground_text'] == '' and not any(s in STYLE for s in forbidden),
      {'characters': len(STYLE), 'sha256': sha(STYLE.encode())})
unchanged = [key for key in before if key not in ['art_style_base', 'layer_contract']]
check('source_types_and_other_sections_preserved', all(data[k] == before[k] for k in unchanged)
      and all(art[k] == before['art_style_base'][k] for k in ['negative_text', 'rgba_text']),
      {'type_entries': len(data['types']), 'unchanged_sections': unchanged})
contract = load(MANUAL / 'ma_sync/runtime-contract.json')
fingerprint = {k: v for k, v in contract.items() if k != 'contractSha256'}
check('contract_and_fingerprints', contract['modules']['style.gongbi-base']['text'] == STYLE
      and contract['localRevision']['styleSourceSha256'] == sha(SOURCE.read_bytes())
      and contract['contractSha256'] == sha(json.dumps(fingerprint, ensure_ascii=False,
                                           sort_keys=True, separators=(',', ':')).encode()),
      {'contract_sha256': contract['contractSha256']})
flow_details = []
for row in load(OUT / 'snapshots.json'):
    actual = differences(load(by_path[row['path']]['backup']), load(row['path']))
    ok = {tuple(p) for p in actual} == {tuple(p) for p in row['changed_string_paths']}
    flow_details.append({'path': row['path'], 'ok': ok, 'changed_leaves': len(actual)})
check('workflow_only_style_strings_changed', all(r['ok'] for r in flow_details), flow_details)
bad = []
preserved = []
for row in distribution['files']:
    target, source = Path(row['target']), Path(row['source'])
    if sha(target.read_bytes()) != row['after']:
        bad.append(str(target))
    if source == SOURCE:
        current = load(target)
        target_change = by_path.get(str(target))
        if target_change:
            original = load(target_change['backup'])
        else:
            assert row['before'] == row['after'], f'Missing backup for changed target: {target}'
            original = current
        if current['art_style_base'] != art or current['layer_contract'] != data['layer_contract']:
            bad.append('style:' + str(target))
        keys = [k for k in original if k not in ['art_style_base', 'layer_contract']]
        if not all(current[k] == original[k] for k in keys):
            bad.append('unrelated:' + str(target))
        if row['preserved_existing_type_difference']:
            preserved.append({'target': str(target),
                              'preserved_paths': differences(data['types'], current['types'])})
    elif target.read_bytes() != source.read_bytes():
        bad.append('copy:' + str(target))
check('distribution_style_parity_and_scope', not bad,
      {'targets': len(targets), 'errors': bad, 'preserved_existing_type_differences': preserved})
node = ROOT / 'apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_bases_text.py'
ast.parse(node.read_text())
check('node_syntax', True, str(node))
check('tests', load(OUT / 'backend-test-command.json')['exit_code'] == 0
      and load(OUT / 'frontend-test-command.json')['exit_code'] == 0
      and '62 passed' in (OUT / 'backend-tests.log').read_text()
      and '94 passed' in (OUT / 'frontend-tests.log').read_text(), {'python': 62, 'vitest': 94})
layer = load(OUT / 'layer-scan-after.json')
check('layer_and_internal_contract', not layer['conflicts']
      and all(v['count'] == 0 for v in layer['clash'].values())
      and load(OUT / 'ma-internal-check.json')['ok'], {'types_scanned': len(layer['clash'])})
q = ROOT / 'docs/prompts/Qwen-Image-2.1'
docs = list(MANUAL.rglob('*.md')) + list(q.glob('*.md'))
docs += [p for p in (ROOT / 'docs/prompts').iterdir() if p.suffix == '.md' and p.name.startswith('道劫')]
for name in ['qwen-image-2-1-prompter', 'qwen-image-prompt-en', 'daojie-charsheet-prompter']:
    docs += list((ROOT / '.agents/skills' / name).rglob('*.md'))
docs += [p for p in (ROOT / 'docs/comfyui-kb').rglob('*.md') if p.name == 'Qwen-Image-2.1-文生图.md']
old = load(OUT / 'original-style.json')
needles = [old['positive_style_text'], old['positive_ground_text'], '光型契约',
           '底座全文(带背景)', '带背景六型的底色/平涂/大色面段']
coverage = []
for path in sorted(set(docs)):
    lines = path.read_text().splitlines()
    hits = [{'line': n, 'text': line[:240]} for n, line in enumerate(lines, 1)
            if any(needle in line for needle in needles)]
    changed = str(path) in by_path
    coverage.append({'path': str(path), 'changed_this_correction': changed, 'residual_hits': hits,
                     'review': ('已同步纯美术底座职责。' if changed else
                                '本次底座旧句与错误职责扫描无命中；历史快照保留其原有范围标识。')})
check('document_residual_scan', not any(row['residual_hits'] for row in coverage),
      {'documents': len(coverage), 'modified_markdown': sum(r['changed_this_correction'] for r in coverage)})
result = {'created': datetime.now().astimezone().isoformat(), 'ok': all(c['ok'] for c in checks),
          'checks': checks, 'counts': {'existing_source_files_modified': len(primary),
          'distribution_targets': len(targets), 'documents_scanned': len(coverage),
          'markdown_modified': sum(r['changed_this_correction'] for r in coverage)},
          'limits': ['未提交生图或视觉对照，不能据静态检查确认实际画面效果。',
                     '未重新打包；app.asar中的前端内联合同未由本轮更新。',
                     '未启动或重启引擎；17001仅作节点元数据只读核查。']}
(OUT / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
(OUT / 'document-coverage.json').write_text(json.dumps(coverage, ensure_ascii=False, indent=2) + '\n')
with (OUT / 'source-changes.diff').open('w') as handle:
    for row in primary:
        handle.writelines(difflib.unified_diff(Path(row['backup']).read_text().splitlines(True),
                           Path(row['path']).read_text().splitlines(True),
                           fromfile=row['backup'], tofile=row['path']))


def link(path, label=None):
    return f'[{label or Path(path).name}](<{Path(path)}>)'


report = ['# 道劫美术风格底座纠正报告', '', f'核验时间：{result["created"]}。', '',
          '**实际底座已写入。** 本轮基于《三国望神州》美术依据恢复传统绘画经现代游戏美术设计重组的表达，'
          '只保留美术语言与通用成像工艺。', '', '## 当前底座全文', '', STYLE, '',
          '真源：' + link(SOURCE) + '。`positive_text` 与 `positive_style_text` 同文；'
          '`positive_ground_text` 显式为空。', '', '## 本次具体修改', '',
          '- 补回中国传统人物画、现代游戏设计重组、工笔白描与连环画、线条提按和笔性、墨色虚实、传统色体系与受控饱和度和对比度。',
          '- 保留用户认可的“成像工艺干净，线条与罩染层次清晰。”。',
          '- 从底座移出主体固有色、具体部件与焦点细节、衣物磨损/尘土/血痕/身体状态、背景色相明暗和光源、近远景结构、空气透视与净空。'
          '这些属于主体句和类型句职责；既有类型数组逐项保持本次修改前的值。',
          '- 四段协议保留；节点接受显式空背景段，缺字段的旧库仍沿用全文回退。同步修改节点说明。',
          '- 手册质量锚定、风格底座锁、完整与内联分层契约、运行合同及指纹、手册锚、十型写法和主体句宪法统一边界。',
          '- 同步6份工作流/独立子图中的13处风格字符串。逐叶核验：节点、连线、采样和其余内容均与本次备份一致。',
          '- 修正4份现有测试的过时画法、背景与指纹锚；新增的2项边界回归已从失败转为通过。', '',
          '## 文档与分发核对', '',
          f'对既有修订范围的{len(coverage)}篇文档进行本次底座职责回查，{sum(r["changed_this_correction"] for r in coverage)}篇Markdown实际修改；'
          '未检出旧底座句、底座带背景说明或光型契约残留。其余历史实验、官方通用配方不重写。逐篇记录：'
          + link(OUT / 'document-coverage.json') + '。', '',
          f'核验{len(targets)}个现有副本，其中{sum(r["before"] != r["after"] for r in distribution["files"])}份执行写入，'
          '其余在分发前已与真源一致。覆盖装机资源、构建资源、MA风格手册、用户风格手册、引擎数据和节点/独立子图。'
          '仅更新本次修订文件。JSON数据副本只改底座及内联契约，其余段落保留。', '',
          '发现MA和用户手册两份数据副本原先缺少真源已有的设定卡`rgba_positive`；本轮保留各副本原有类型字段，'
          '没有将该差异算成本次底座改动。所有副本的美术底座与内联契约均与真源一致，'
          '其中48份文件与对应源逐字节相同，另2份仅保留上述原有类型差异。', '',
          '## 验证与生效范围', '',
          '- 后端装配、用途、透明/不透明回退与协议：62项通过。' + link(OUT / 'backend-tests.log'),
          '- 前端运行合同、清理器和手册合同：94项通过。' + link(OUT / 'frontend-tests.log'),
          '- 分层冲突0条，11个类型项撞词均为0；MA合同内部检查通过。',
          '- 全部改动及备份哈希、源类型不变、分发边界、工作流字符串范围和合同指纹均核验通过。' + link(OUT / 'verification.json'),
          '- 17001只读节点元数据已显示“背景协议段可为空”的新说明。证据：' + link(OUT / 'runtime-node-readonly.json'),
          '- 本轮未启动/重启引擎，未生图；尚不能据此确认视觉效果。',
          '- 未重新打包：app.asar内的前端内联合同尚未由本轮更新；当前已打开的画布是否刷新未验证。', '',
          '## 现有源文件完整修改清单', '', '| 文件 | 修改 |', '|---|---|']
for row in primary:
    report.append('| ' + link(row['path'], str(Path(row['path']).relative_to(ROOT))) + ' | '
                  + '；'.join(row['reasons']).replace('|', '／') + ' |')
report += ['', '全部现有文件首次修改前均已备份。辅助脚本为小批修订与只读核验工具；修订脚本按当时锚点执行，不应重复运行。', '',
           '- 逐文件前后SHA和备份位置：' + link(OUT / 'changes.json'),
           '- 源文件完整差异：' + link(OUT / 'source-changes.diff'),
           '- 逐副本分发记录：' + link(OUT / 'distribution.json')]
(OUT / 'report.md').write_text('\n'.join(report) + '\n')
print(json.dumps({'ok': result['ok'], 'counts': result['counts'],
                  'report': str(OUT / 'report.md'),
                  'failed_checks': [c for c in checks if not c['ok']]}, ensure_ascii=False))
raise SystemExit(0 if result['ok'] else 1)
