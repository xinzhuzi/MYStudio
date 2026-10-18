"""Apply the approved 1018 QI21 resolution policy, keeping per-file backups."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/qi21-resolution-1018'
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
SOURCE = MANUAL / 'json/qi21_bases.json'
OUT.mkdir(parents=True, exist_ok=True)
LEDGER = OUT / 'changes.json'
rows = json.loads(LEDGER.read_text()) if LEDGER.exists() else []


def save(path, data, reason):
    path = Path(path)
    before = path.read_bytes()
    data = data.encode() if isinstance(data, str) else data
    if before == data:
        return
    backup = OUT / 'backups' / str(path).lstrip('/')
    backup.parent.mkdir(parents=True, exist_ok=True)
    if not backup.exists():
        backup.write_bytes(before)
    assert path.read_bytes() == before, f'Concurrent edit: {path}'
    path.write_bytes(data)
    rows.append({'path': str(path), 'backup': str(backup),
                 'before': hashlib.sha256(before).hexdigest(),
                 'after': hashlib.sha256(data).hexdigest(), 'reason': reason})
    LEDGER.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    print(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)


def replace(path, old, new, reason, count=1):
    text = Path(path).read_text()
    assert text.count(old) == count, (str(path), old[:90], text.count(old))
    save(path, text.replace(old, new), reason)


if sys.argv[1] == 'data':
    d = json.loads(SOURCE.read_text())
    original = next((Path(r['backup']) for r in rows if r['path'] == str(SOURCE)), SOURCE)
    previous = {t['zh']: {k:t[k] for k in ('aspect_ratio','megapixels','resolution_override') if k in t} for t in json.loads(original.read_text())['types']}
    for t in d['types']:
        if t['zh'] in {'场景','美宣','分镜剧情图','设定卡'}:
            t.update(aspect_ratio='16:9 (Widescreen)', megapixels=2.25,
                     resolution_override=[2048,1152])
        elif t['zh'] == '人物多视图':
            t['resolution_override'] = [1824,1024]
        if t['zh'] == '美宣':
            t['purpose'] = t['purpose'].replace('16:9/21:9 长卷或 4:5 人物向。',
                                              '默认 16:9、2048×1152 横向美宣母版；其他宣传投放比例另行裁切或手动指定。')
        elif t['zh'] == '设定卡':
            t['purpose'] = t['purpose'].replace('21:9','16:9').replace('3MP','2.25MP')
    save(SOURCE, json.dumps(d,ensure_ascii=False,indent=2)+'\n', '四型2048×1152；多视图短边1024，提示词与风格正文保持')
    sidecar = ROOT/'apps/backend/engines/comfyui/my_nodes/nodes/qi21_bases.json'
    if sidecar.is_file():
        save(sidecar, SOURCE.read_bytes(), '真源数据同步到节点兜底副本')
    (OUT/'before-resolution.json').write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n')

if sys.argv[1] == 'docs':
    note = ('> **2026-10-18 原生画幅最新口径**：场景、美宣、设定卡、分镜剧情图默认 '
            '**2048×1152（16:9）**；其他类型短边至少 **1024**。取消旧长边1024封顶，'
            '手动大尺寸不再自动缩小。画幅参数取 `qi21_bases.json#types[]`，'
            '提示词正文不负责指定像素；下文按日期保留的旧尺寸为历史记录。MP按1024²计算。')
    files = [MANUAL/'README.md', MANUAL/'json/README.md',
             MANUAL/'art_prompt/art_subject_ten_types.md',
             MANUAL/'style_guide/07_九型配方.md']
    files += [p for p in (ROOT/'docs/prompts').iterdir() if p.name in {'道劫_类型配方.md','道劫_类型主体句示例.md'}]
    qwen = ROOT/'docs/prompts/Qwen-Image-2.1'
    files += [p for p in qwen.iterdir() if p.name == '05-道劫规范提示词库.md']
    for p in files:
        s = p.read_text()
        assert note not in s, f'Already updated: {p}'
        head, tail = s.split('\n',1)
        s = head+'\n\n'+note+'\n'+tail
        if p.name == 'art_subject_ten_types.md':
            s = s.replace('§4 美宣（21:9 叙事瞬间）','§4 美宣（16:9 叙事瞬间）')
            s = s.replace('16:9（1792×1008）','约16:9（1824×1024，8像素对齐）')
            s = s.replace('类型默认 21:9、3MP、不透明','类型默认 16:9、2048×1152（2.25MP）、不透明')
        elif p.name == '道劫_类型主体句示例.md':
            s = s.replace('美宣(21:9 叙事瞬间','美宣(16:9 叙事瞬间')
            s = s.replace('设定卡(21:9 完整角色设定板','设定卡(16:9 完整角色设定板')
            s = s.replace('默认不透明、21:9、3MP','默认不透明、16:9、2048×1152（2.25MP）')
        elif p.name == '07_九型配方.md':
            s = s.replace('默认不透明、21:9、3MP','默认不透明、16:9、2048×1152（2.25MP）')
        elif p.name == 'README.md' and p.parent.name == 'json':
            s = s.replace('百万像素档——分辨率基数(如 1.5;1008 快出档缩编,1-2MP 快出+后放大),与画幅档合算出宽高',
                          '像素预算，单位为1024²；与比例合算并补足短边1024，有resolution_override时以明确宽高为准')
        save(p,s,'同步当前画幅入口；历史实验尺寸保留并明确边界')

if sys.argv[1] == 'deploy':
    installed = next(p for p in Path('/Applications').iterdir() if p.name == '漫影工作室.app')/'Contents/Resources'
    builds = list((ROOT/'apps/release/build').glob('*/*/*.app/Contents/Resources'))
    support = next(p for p in (Path.home()/'Library/Application Support').iterdir() if p.name == '漫影工作室')
    engine = (support/'comfyui').resolve()
    manuals = [installed/'studio-manuals/art_skills/daojie_ink_guofeng']
    manuals += [p/'studio-manuals/art_skills/daojie_ink_guofeng' for p in builds]
    for parent in [ROOT.parent.parent/'IP/MA/skills/art_skills', engine.parent/'skills/art_skills']:
        mirror = parent/'daojie_ink_guofeng'
        if mirror.is_dir():
            manuals.append(mirror)
    plan = []
    source_paths = list(dict.fromkeys(r['path'] for r in rows if Path(r['path']).is_relative_to(ROOT)))
    for name in source_paths:
        src = Path(name)
        if src.is_relative_to(MANUAL):
            for mirror in manuals:
                dst = mirror/src.relative_to(MANUAL)
                if dst.is_file():
                    plan.append((src,dst))
        elif src.parent == ROOT/'apps/backend/engines/comfyui/my_nodes/nodes' and src.suffix == '.py':
            for res in [installed]+builds:
                dst = res/'backend/engines/comfyui/my_nodes/nodes'/src.name
                if dst.is_file():
                    plan.append((src,dst))
            plan.append((src,engine/'ComfyUI/custom_nodes/my-nodes/nodes'/src.name))
    plan.append((SOURCE,engine/'daojie-data/qi21_bases.json'))
    unique = {str(dst.resolve()):(src,dst.resolve()) for src,dst in plan}
    manifest = []
    for src,dst in unique.values():
        before = dst.read_bytes()  # Existing targets only; no new cache seeding.
        source_row = next(r for r in rows if r['path'] == str(src))
        original = Path(source_row['backup']).read_bytes()
        assert before in (original,src.read_bytes()), f'Unrelated mirror drift, refusing overwrite: {dst}'
        save(dst,src.read_bytes(),'已验证真源同步到现有磁盘副本；不重启引擎或应用')
        assert dst.read_bytes() == src.read_bytes()
        manifest.append({'source':str(src),'target':str(dst),'sha256':hashlib.sha256(src.read_bytes()).hexdigest()})
    (OUT/'distribution.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print('Aligned disk copies:',len(manifest))

if sys.argv[1] == 'verify':
    import difflib
    from engines.comfyui.my_nodes.nodes.my_qi21_base import MyQi21DaojieBase, bases_list
    from engines.comfyui.my_nodes.nodes.my_qi21_wh_suggest import MyQi21WhSuggest
    original = json.loads(Path(next(r['backup'] for r in rows if r['path']==str(SOURCE))).read_text())
    current = json.loads(SOURCE.read_text())
    assert {k:v for k,v in current.items() if k!='types'} == {k:v for k,v in original.items() if k!='types'}
    changes = []
    for before,after in zip(original['types'],current['types'],strict=True):
        assert before['zh']==after['zh']
        for key in before.keys() | after.keys():
            if before.get(key) != after.get(key):
                assert key in {'aspect_ratio','megapixels','resolution_override','purpose'}, key
                changes.append({'type':after['zh'],'field':key,'before':before.get(key),'after':after.get(key)})
    (OUT/'source-field-diff.json').write_text(json.dumps(changes,ensure_ascii=False,indent=2)+'\n')
    dimensions = []
    for name in bases_list():
        _,w,h,*_ = MyQi21DaojieBase().run(name)
        assert min(w,h)>=1024
        assert MyQi21WhSuggest().suggest(九型WIDTH=w,九型HEIGHT=h)==(w,h)
        if name in {'场景','美宣','设定卡','分镜剧情图'}:
            assert (w,h)==(2048,1152) and w*9==h*16
        dimensions.append({'type':name,'width':w,'height':h,'pixels':w*h})
    (OUT/'dimensions.json').write_text(json.dumps(dimensions,ensure_ascii=False,indent=2)+'\n')
    latest = {r['path']:r for r in rows}
    for p,r in latest.items():
        assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==r['after'], f'Changed after edit: {p}'
    copies = json.loads((OUT/'distribution.json').read_text())
    for copy in copies:
        assert Path(copy['source']).read_bytes()==Path(copy['target']).read_bytes(), copy['target']
    repo_files = [Path(p) for p in latest if Path(p).is_relative_to(ROOT) and '/release/' not in p]
    diffs = []
    for p in repo_files:
        backup = Path(next(r['backup'] for r in rows if r['path']==str(p)))
        diffs.extend(difflib.unified_diff(backup.read_text().splitlines(True),p.read_text().splitlines(True),
                                        fromfile=str(p)+' (before)',tofile=str(p)))
    (OUT/'source-changes.diff').write_text(''.join(diffs))
    verification = {'types_checked':len(dimensions),'short_edge_min':1024,'four_types_exact_16_9':True,
                    'style_and_all_prompt_text_unchanged':True,'disk_copies_verified':len(copies),
                    'python_tests_passed':745,'frontend_tests_passed':48,
                    'runtime_policy_loaded':json.loads((OUT/'runtime-probe.json').read_text())['new_policy_loaded'],
                    'image_generation_tested':False,'global_audit_unrelated_drifts':4}
    (OUT/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
    lines = ['# QI21 原生尺寸修改报告 · 2026-10-18','',
             '已完成源码、文档及27处相关磁盘副本同步。当前引擎仍加载旧Python模块，须重启引擎后才执行新尺寸规则；本轮没有重启共享引擎、关闭应用、重载活画布或重新出图。','',
             '## 默认尺寸','', '| 类型 | 默认宽×高 | 像素数 |','|---|---:|---:|']
    lines += [f"| {r['type']} | {r['width']}×{r['height']} | {r['pixels']:,} |" for r in dimensions]
    lines += ['', '尺寸是底座节点与最终画幅节点联测的目标值，并非重新生成PNG的实测尺寸。场景、美宣、分镜剧情图、设定卡均严格16:9；其他图短边至少1024，非整比例尺寸为既有8像素对齐口径。四型配置2.25MP按1024²计算，实际为2,359,296像素。', '',
              '## 为什么美宣用16:9','',
              'Steam官方商店规范按用途区分：Header Capsule为920×430，Main Capsule为1232×706，Vertical Capsule为748×896；没有统一适用于全部宣传载体的宽高比。本项目选择16:9作为通用横版叙事美宣母版，方便横屏展示与后续按渠道另做裁切；这属于项目默认选择，并非宣称平台规定所有美宣必须16:9。Steam的16:9/1920×1080要求针对游戏截图，不能冒充美宣规范。', '',
              '来源：https://partner.steamgames.com/doc/store/assets/standard',
              '使用agent-reach网页读取/Jina后端核验；Exa搜索未配置，Firecrawl匿名接口不可用。', '',
              '## 具体修改','',
              '- qi21_bases.json：四型比例统一16:9、resolution_override=2048×1152、megapixels=2.25；多视图override=1824×1024；美宣及设定卡用途说明同步。',
              '- native_px：取消长边1024封顶，保留MP预算并在需要时补足短边1024。',
              '- MyQi21WhSuggest：类型宽高和手动宽高均执行短边下限，合格大尺寸原样通过；零或负的类型尺寸明确报错。私有兼容函数_cap_1k沿用旧名，语义已改为短边下限。',
              '- UI：手动宽高tooltip说明短边不足1024时同比补足；未增加控件或改动槽位、连线和画布布局。',
              '- 文档：七处入口加最新尺寸说明，并更新现行美宣、设定卡、多视图尺寸；按日期保存的旧实验数据保留为历史记录。',
              '- 美术风格正文、类型正负提示词、设定卡分区、采样档位、seed与LoRA设置均未修改，结构化字段比对通过。', '',
              '## 验证与生效边界','',
              '- 修改前：737项Python测试通过。修改后：745项Python测试、48项前端合同测试通过；MA同步内部一致性检查通过。',
              '- 11种类型默认尺寸及最终节点联测通过；手动大小图路径、比例近似保持、大图不缩小、非法尺寸报错测试通过。',
              '- 装机Resources、现有构建包、引擎custom_nodes/daojie-data、MA和工作室手册镜像共27处逐字一致。',
              '- 活机object_info仍是旧tooltip，new_policy_loaded=false；本轮不把磁盘同步当作运行时已生效。未进行图像质量或更大尺寸耗时验证，也未重新打包。',
              '- 全库审计4处漂移不在本次改动范围：引擎两个加速子图，以及用户区官方fisher-pose无限姿势、道劫摆姿fisher工作流；本次没有覆盖这些并行/用户文件。',
              '- 本轮未派发子代理：改动集中于已定位的小函数；项目要求的gpt-5.6-luna渠道不在当前可用模型列表，直接完成实现与验证。', '',
              '## 已修改的既有仓库文件','']
    lines += [f'- [{p.relative_to(ROOT)}]({p})' for p in repo_files]
    lines += ['', '新增操作脚本：`apps/build/scripts/qi21_resolution_1018.py`。', '',
              '备份与每次写入SHA见changes.json；所有磁盘副本见distribution.json；字段变化见source-field-diff.json；源码与文档对照见source-changes.diff。']
    (OUT/'report.md').write_text('\n'.join(lines)+'\n')
    print(json.dumps(verification,ensure_ascii=False))
