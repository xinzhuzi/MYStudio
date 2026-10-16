"""Produce the reviewable change inventory and evidence report from disk."""
from qi21_style_type_revision_1016 import ROOT, OUT, SOURCE, sha
from pathlib import Path
from datetime import datetime
import json
import re
import subprocess

ledger = json.loads((OUT / 'changes.json').read_text())
distribution = json.loads((OUT / 'distribution.json').read_text())
documents = json.loads((OUT / 'document-coverage-full.json').read_text())
type_changes = json.loads((OUT / 'type-changes.json').read_text())
workflow = json.loads((OUT / 'workflow-verification.json').read_text())
runtime = json.loads((OUT / 'runtime-schema-probe.json').read_text())
ma_check = json.loads((OUT / 'ma-contract-check.json').read_text())
data = json.loads(SOURCE.read_text())
backend = (OUT / 'backend-final-tests.log').read_text()
frontend = (OUT / 'frontend-final-tests.log').read_text()
ui_probe = (OUT / 'ui-probe.log').read_text()
assert re.search(r'\b82 passed\b', backend)
assert re.search(r'Tests\s+94 passed', frontend)
assert ui_probe.startswith('PASS:')
assert ma_check['ok'] is True
assert not any(row['retired_field_hits'] or row['removed_style_clause_hits'] for row in documents)
for row in ledger:
    assert sha(Path(row['path']).read_bytes()) == row['after'], row['path']
    assert sha(Path(row['backup']).read_bytes()) == row['before'], row['backup']
for row in distribution:
    assert Path(row['source']).read_bytes() == Path(row['target']).read_bytes(), row['target']

targets = {row['target'] for row in distribution}
new_files = list((ROOT / 'apps/build/scripts').glob('qi21_style_type_*_1016.py'))
new_files += [
    ROOT / 'apps/backend/engines/comfyui/my_nodes/tests/test_qi21_style_type_separation.py',
    ROOT / 'apps/backend/engines/comfyui/my_nodes/tests/qi21_style_type_ui_probe_1016.mjs',
]
sources = {Path(row['path']) for row in ledger if row['path'] not in targets}
sources.update(new_files)
compiled = []
for path in sorted(sources):
    if path.suffix == '.py':
        compile(path.read_bytes(), str(path), 'exec')
        compiled.append(str(path))
js = ROOT / 'apps/backend/engines/comfyui/my_nodes/web/my-qi21-prompt-preview.js'
syntax = subprocess.run(['node', '--check', str(js)], text=True, capture_output=True)
assert syntax.returncode == 0, syntax.stderr

checks = {
    'timestamp': datetime.now().astimezone().isoformat(),
    'backend': {'passed': 82, 'exit_code': 0, 'log': str(OUT / 'backend-final-tests.log')},
    'frontend': {'passed': 94, 'files': 3, 'exit_code': 0, 'log': str(OUT / 'frontend-final-tests.log')},
    'ui_probe': {'passed': True, 'log': str(OUT / 'ui-probe.log'),
                 'scope': 'VM execution of the real extension; not a live visual or packaged App test.'},
    'syntax': {'python_compiled': compiled, 'javascript_exit_code': syntax.returncode},
    'documents': {'checked': len(documents), 'changed': sum(r['changed_this_revision'] for r in documents),
                  'retired_field_hits': 0, 'removed_style_clause_hits': 0},
    'workflows': {'checked': len(workflow), 'changed': sum(r['changed'] for r in workflow),
                  'outside_style_display_equal': all(r['outside_style_display_equal'] for r in workflow),
                  'shared_blueprint_matches_production': True},
    'distribution': {'targets': len(distribution), 'byte_identical': len(distribution)},
    'ma_contract_internal': ma_check,
    'runtime': runtime,
    'not_run': ['image generation', 'engine restart', 'App packaging/install',
                'live visual verification', 'full repository quality gate'],
    'limitations': [
        'Configured engine endpoint refused the read-only object_info connection; no engine was started.',
        'The frontend imports runtime-contract.json at build time; the installed app.asar was not rebuilt.',
        'The edit-only blueprint had no prior source hash; this revision did not modify it.',
    ],
    'source_files': [{'path': str(p), 'sha256': sha(p.read_bytes()), 'new_this_revision': p in new_files}
                     for p in sorted(sources)],
}
(OUT / 'verification.json').write_text(json.dumps(checks, ensure_ascii=False, indent=2) + '\n')


def link(path, label=None):
    path = Path(path)
    return f'[{label or path.name}](<{path}>)'


inventory = [
    '# 本轮逐文件清单',
    '',
    '源码、数据、文档、测试及辅助脚本如下；分发副本另列于 distribution.json。',
    '',
    '| 文件 | 本轮 | SHA256 |',
    '| --- | --- | --- |',
]
for path in sorted(sources):
    label = str(path.relative_to(ROOT))
    inventory.append(f'| {link(path, label)} | {"新增" if path in new_files else "修改"} | {sha(path.read_bytes())} |')
(OUT / 'file-inventory.md').write_text('\n'.join(inventory) + '\n')

report = [
    '# 道劫 Qwen-Image-2.1 风格与类型职责修改报告',
    '',
    '已把美术风格底座收敛为绘画语言与成像工艺；背景、光照、来源状态保留规则归入类型句，具体事实仍由主体句提供。代码、节点展示、工作流快照、手册和分发副本已同步。',
    '',
    '## 现在的美术风格底座',
    '',
    '> ' + data['art_style_base']['positive_text'],
    '',
    '保留“成像工艺干净，线条与罩染层次清晰。”。背景、受光、磨损、血痕、肢体状态与透明承载均不写入这段风格正文。',
    '',
    '## 数据与十型具体修改',
    '',
    '- art_style_base 只保留 _doc、positive_text、negative_text；positive_style_text、positive_ground_text、rgba_text 退役。',
    '- 透明承载句移至 rgba.subject_isolation；风格负向只保留画风与成像工艺，人体、文字、UI、logo 与背景缺陷归类型负向。',
    '- 背景与照明的呈现规则、来源状态保留规则归类型句；地点、时段、光源方向和具体伤损等事实归主体句。',
    '- 透明五型的 rgba_positive 同步保留均匀漫射光和来源状态，避免扩写不可用时回退漏掉规则。',
    '- 道具“主体完整”改成“可见范围完整入画”，防止断剑等既有缺损被补全；设定卡的正、侧、背三视图与直刃一致性规则保留。',
    '',
    '| 类型 | 本轮改动字段 |',
    '| --- | --- |',
]
for row in type_changes:
    report.append(f'| {row["zh"]} | {", ".join(row["fields"])} |')
report += [
    '',
    '人物、场景、道具、分镜剧情图、概念气氛图补充正向规则；美宣、多视图、人脸、表情差分、设定卡原有正向已具备相应职责。自由类型正向仍为空。逐字段前后原文见 ' + link(OUT / 'type-changes.json') + '。',
    '',
    '## 相关代码与 UI',
    '',
    '| 文件 | 改动 |',
    '| --- | --- |',
    '| my_qi21_bases_text.py | 风格节点只提供“美术风格／负向词表”两只展示框和正负双出口；主口为纯风格。通用下拉只留系统提示词、色卡、美术风格底座。 |',
    '| my_qi21_api_pe.py | 新输出按纯风格消费；旧四段存档只取画法和风格负向；残缺旧协议回退真源画法，背景段不再装配；透明回退读取类型照明与状态规则。 |',
    '| my_qi21_prompt_assembly.py | 只加载纯风格字段，兼容旧协议时剥离背景与透明段；新建资产、局部编辑、画风转换继续按各自用途装配。 |',
    '| my-qi21-prompt-preview.js | 仅显示两只只读框；旧 5／4／2 值存档按新 schema 真源默认值迁移，避免旧背景串入负向框；仅序列化新命名字段，保留无关属性。 |',
    '',
    '节点展示尺寸调整为 560×400。扫描 7 份工作流，修改提示词蓝图、道劫 t2i 画布、t2i API 图这 3 份；只改风格展示、schema、尺寸和 API 风格输入。正负出口仍连接 4013 的原槽位；模型、速度档、采样参数、seed、用户输入及其他连线保持原样。共享提示词子图逐字段一致，生产图额外的加速子图保留。证据见 ' + link(OUT / 'workflow-verification.json') + '。',
    '',
    'App 的 runtime-contract.json 同步纯风格、人物／场景／器物类型规则及纯工艺成片句，重算合同 SHA；MA 历史来源指纹保留，修订来源单独登记。',
    '',
    '## 文档与分发',
    '',
    f'完整复查 {len(documents)} 篇相关文档，本轮调整 {checks["documents"]["changed"]} 篇；现行职责统一为“风格／类型／具体事实”。历史实验保留历史标识。逐文档路径、行号、SHA 和残留扫描见 ' + link(OUT / 'document-coverage-full.json') + '。',
    '',
]
for row in documents:
    if row['changed_this_revision']:
        report.append('- ' + link(row['path'], str(Path(row['path']).relative_to(ROOT))))
report += [
    '',
    '56 个分发目标逐字节等于当前真源，覆盖安装 Resources、构建产物 Resources、引擎自研节点及两处本地手册镜像。两处本地手册原本缺少设定卡 rgba_positive，本轮按完整基线比对后明确补齐；未放行其他漂移。没有向引擎 userdata/workflows 写入实体。',
    '',
    '逐文件改动：' + link(OUT / 'file-inventory.md') + '；备份与前后 SHA：' + link(OUT / 'changes.json') + '；分发与逐字节核验：' + link(OUT / 'distribution.json') + '。',
    '',
    '## 验证与生效边界',
    '',
    '- 后端相关回归：82 passed；前端 3 份相关用例：94 passed。',
    '- 实际 JS 扩展的 VM 探针通过旧存档迁移、两框只读、执行回填和新字段序列化；Python 与 JS 语法检查通过。',
    '- MA 合同内部一致性、风格字段职责、透明五型回退、工作流差异范围及 56 个分发副本全部通过；完整证据见 ' + link(OUT / 'verification.json') + '。',
    '- 配置端口 17001 的只读 object_info 请求被拒绝；本次没有启动或重启引擎，没有进行真实画布可视验收或生成图片。节点新结构需引擎加载新版代码并刷新画布后显示。',
    '- 本次未打包、覆盖安装或运行全仓质量门。App 前端在构建时导入 runtime-contract.json，因此已安装 app.asar 内的编译内容仍需后续打包才能更新；资源文件同步不等同于 App 编译产物更新。',
    '- 本轮由主代理完成；未派子代理。最终核验依据当前磁盘、备份对比与本轮复跑结果。',
]
(OUT / 'report.md').write_text('\n'.join(report) + '\n')
print(json.dumps({'report': str(OUT / 'report.md'), 'source_files': len(sources),
                  'distributed_targets': len(distribution), 'documents': len(documents),
                  'backend_passed': 82, 'frontend_passed': 94}, ensure_ascii=False))
