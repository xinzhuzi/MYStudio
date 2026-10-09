#!/usr/bin/env python3
"""User-approved Qi21 text surgery. No Git, no workflow/code changes."""
from __future__ import annotations
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
TASK = ROOT / '.trellis/tasks/10-09-qi21-source-prompt-review-fixes'
INITIAL_SHA = '4a6017097aa36e69fba80a0d8da3ab7bf7ca243684f1a88ae58cf225280e2497'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def at(data, path):
    for key in path:
        data = data[key]
    return data


def changed_paths(before, after, path=()):
    if isinstance(before, dict) and isinstance(after, dict):
        return [p for key in before.keys() | after.keys()
                for p in (changed_paths(before[key], after[key], path + (key,))
                          if key in before and key in after else [path + (key,)])]
    if isinstance(before, list) and isinstance(after, list) and len(before) == len(after):
        return [p for i, (a, b) in enumerate(zip(before, after))
                for p in changed_paths(a, b, path + (i,))]
    return [] if before == after else [path]


def plan(before, batch):
    after = copy.deepcopy(before)
    edits = []

    def put(path, value):
        parent = at(after, path[:-1])
        old = parent.get(path[-1])
        assert old != value, f'already applied: {path}'
        parent[path[-1]] = value
        edits.append((path, old, value))

    def replace(path, old, new, count=1):
        value = at(after, path)
        assert value.count(old) == count, f'anchor mismatch: {path}, {old}'
        put(path, value.replace(old, new))

    if batch == 'core':
        replace(('art_style_base', 'negative_text'), '大块不透明色面', '厚涂遮蔽结构')
        replace(('color_lexicon', 'usage'), '主体句落点色锚必须用本词典词',
                '新增色彩描述使用本词典色词，主体句原有色词逐字保留')
        p = ('expand_instruction', 'system_prompt_zh')
        replace(p, '透明底立绘素材', '透明底素材', count=3)
        replace(p, '远景只留山脊轮廓剪影与大气透视；工笔、彩线描、罩染只落人物与关键配件；光的落点在人物与近景。',
                '远景按实际场景概括轮廓、剪影与大气透视；工笔、彩线描、罩染集中于焦点主体与关键部件；光的落点服从主体及画面视觉重心。')
        replace(p, '主体完整入画、四肢/衣摆/武器不断裂,轮廓至边缘清晰;光照只交代主体受到的效果。',
                '按类型与主体句指定的取景范围构图，范围内的主体与部件完整、边缘清晰；面部特写保持头肩取景，不扩展为全身。光照只交代主体受到的效果。')
        replace(('art_style_base', 'rgba_text'),
                'Subject rendered complete with clean edges, isolated on pure transparency.',
                'Visible subject within the specified framing has clean, intact edges, isolated on pure transparency.')
    elif batch == 'framing':
        replace(('types', 0, 'positive_text'),
                '主体的单人立绘，全身入画，头身比约六至七头身，解剖比例写实。细彩线勾勒全身轮廓',
                '主体的单人立绘，按主体句指定采用半身或全身取景，所选取景范围完整呈现；人物体态约六至七头身，解剖比例写实。细彩线勾勒可见人物轮廓')
        replace(('types', 3, 'positive_text'),
                '主体的单人立绘，全身入画，头身比约六至七头身，解剖比例写实。人物细节密度最高，主体落在视觉焦点',
                '主体的叙事美宣画面，人物数量、动作与取景范围遵循主体句，采用适合叙事的单人或多人构图；人物体态约六至七头身，解剖比例写实。焦点人物细节密度最高，叙事主体落在视觉焦点')
        replace(('types', 3, 'positive_text'), '细彩线勾勒全身轮廓', '细彩线勾勒可见人物轮廓')
        for key in ('positive_text', 'rgba_positive'):
            replace(('types', 2, key), '机位正侧面正交平视，器物各面平行于画面，轮廓比例忠实可量。',
                    '机位为正九十度侧面正交平视，器物侧面平行于画面，轮廓比例忠实可量。')
        put(('types', 2, 'purpose'),
            '1:1 单件器物设定图，正侧面平视、水平居中平放，默认透明底。主体句写器物名、材质与灵纹，出图作为单件物品素材；透明关闭时底色色相可由设定指定。')
    elif batch == 'sheets':
        put(('types', 4, 'aspect_ratio'), '1:1 (Square)')
        replace(('types', 4, 'positive_text'),
                '同一角色的四视图设定图：正面上半身像（肩部以上特写）、正面全身像（正身正对观者站立）、正九十度纯侧面全身像（纯侧面轮廓完整呈现）、背面全身像（背对观者站立）——四个视图两行两列网格排列，机位一致正交平视，同一站姿、同一服装、同一光源，比例逐面一致；头身比约六至七头身，解剖比例写实。细彩线勾勒全身轮廓，线随结构时粗时细；人物细节密度最高；各视图轮廓与墨线浓度逐面一致。',
                '同一角色的四视图设定图，四个视图两行两列网格排列：左上为正面头肩特写（肩部以上），右上为正面全身像（正身正对观者站立），左下为正九十度纯侧面全身像（纯侧面轮廓完整呈现），右下为背面全身像（背对观者站立）。机位一致正交平视，同一服装、同一光源；三幅全身像采用同一站姿，身高、头身比例与脚底在各自格内的位置一致，头身比约六至七头身，解剖比例写实；头肩特写单独放大，五官身份与全身像一致。细彩线勾勒可见人物轮廓，线随结构时粗时细；人物细节密度最高；各视图沿用同一组色卡线色与线描轻重基调。')
        put(('types', 4, 'purpose'),
            '1:1 方形四视图设定图，1632×1632，两行两列：左上正面头肩特写（肩部以上）、右上正面全身、左下正九十度纯侧面全身、右下背面全身。三幅全身像同姿势、同服装、同尺度，脚底在各自格内的位置一致；头肩特写单独放大。主体句写同一角色身份、基础服化与五官锚点。默认透明底，单张直接生成四格；四格均为同一角色的指定视图。')
        put(('types', 4, 'rgba_positive'),
            '同一角色的四视图设定图，两行两列网格排列：左上为正面头肩特写（肩部以上），右上为正面全身像，左下为正九十度纯侧面全身像，右下为背面全身像。机位一致正交平视，同一服装、同一光源；三幅全身像同一站姿、同一尺度，脚底在各自格内的位置一致，完整入画；头肩特写单独放大，五官身份与全身像一致，保留指定裁切范围。各格四周留出空边。图为带透明通道的RGBA透明底图，背景透明。')
        put(('types', 5, 'positive_text'),
            '单一角色的正面头肩特写素材：正面平视机位，视线直视镜头，取景为头部与肩部上缘；头顶、发型外轮廓与下颌完整，面部是画面焦点，五官比例写实、自然立体。细彩线勾勒可见轮廓，线随结构时粗时细；面部细节密度最高，五官与眉眼轮廓清晰锐利。\n头发以细彩线分组勾勒，发量与发际线自然。\n面部肤色、发色与可见衣领主色遵循主体句，服饰设色只作用于可见领口；新增色由色卡选取，以稳定基底承托，中等强度色作层次，少量高识别色仅作点睛。\n图为带透明通道的RGBA透明底图，背景透明。')
        put(('types', 5, 'rgba_positive'),
            '单一角色的正面头肩特写，正面平视机位，视线直视镜头，取景为头部与肩部上缘；头顶、发型外轮廓与下颌完整，面部是画面焦点，五官比例自然。四周留出空边，保持指定头肩取景。图为带透明通道的RGBA透明底图，背景透明。')
        put(('types', 7, 'positive_text'),
            '同一角色的九宫格表情对比表，三行三列，九格均为正面头肩特写，正面平视机位一致，头部在各格中的位置与占比一致，五官比例写实、自然立体。脸型、五官位置、发型与发际线保持同一角色身份；眉形、眼睑开合、嘴角与唇形随对应情绪变化，各格情绪与顺序以主体句为准。细彩线勾勒可见轮廓，线随结构时粗时细；面部是细节焦点。\n头发以细彩线分组勾勒，发量与发际线自然，九格发型与可见领口一致。\n面部肤色、发色与可见衣领主色遵循主体句，服饰设色只作用于可见领口；新增色由色卡选取，以稳定基底承托，中等强度色作层次，少量高识别色仅作点睛。\n图为带透明通道的RGBA透明底图，背景透明。')
        put(('types', 7, 'purpose'),
            '1:1 方形九宫格表情表，三行三列。主体句依从左到右、从上到下的顺序指定九个情绪，并为各情绪补充可见的眉眼、眼睑、鼻颊、嘴角与唇形变化；身份、发型、机位与头肩取景一致，情绪差异清晰。默认透明底，格名文字后期添加。')
        put(('types', 7, 'rgba_positive'),
            '同一角色的九宫格表情对比表，三行三列，九格均为正面头肩特写，正面平视机位一致，头部在各格中的位置与占比一致。脸型、五官位置、发型与发际线保持同一角色身份，眉眼与嘴部形态随主体句指定的九个情绪变化，顺序从左到右、从上到下。各格头顶、发型外轮廓与下颌完整，保留指定头肩取景。图为带透明通道的RGBA透明底图，背景透明。')
    else:
        raise ValueError(batch)
    return after, edits


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batch', choices=['core', 'framing', 'sheets'], required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    raw = SOURCE.read_bytes()
    state_path = TASK / 'backups/state.json'
    state = json.loads(state_path.read_text()) if state_path.exists() else {'sha': INITIAL_SHA, 'batches': []}
    assert digest(raw) == state['sha'], 'Source changed concurrently: reread/review before writing'
    assert args.batch == ['core', 'framing', 'sheets'][len(state['batches'])], 'Sequential batch order required'
    before = json.loads(raw)
    assert [t['zh'] for t in before['types']] == ['人物','场景','道具','美宣','人物多视图','高清人脸','分镜剧情图','表情差分','概念气氛图','自由']
    after, edits = plan(before, args.batch)
    text = raw.decode('utf-8')
    # Collapse several replacements of one field into one field splice.
    paths = list(dict.fromkeys(path for path, _a, _b in edits))
    report = []
    for path in paths:
        key = path[-1]
        old = at(before, path) if not (path == ('types', 7, 'rgba_positive') and key not in before['types'][7]) else None
        new = at(after, path)
        if old is None:
            anchor = '"zh": "表情差分",'
            assert text.count(anchor) == 1, 'new-field anchor mismatch'
            text = text.replace(anchor, anchor + '\n      "rgba_positive": ' + json.dumps(new, ensure_ascii=False) + ',', 1)
        elif path == ('types', 4, 'aspect_ratio'):
            anchor = '"zh": "人物多视图",\n      "aspect_ratio": ' + json.dumps(old, ensure_ascii=False)
            assert text.count(anchor) == 1, 'aspect anchor mismatch'
            text = text.replace(anchor, anchor.replace(json.dumps(old, ensure_ascii=False), json.dumps(new, ensure_ascii=False)), 1)
        else:
            anchor = json.dumps(key) + ': ' + json.dumps(old, ensure_ascii=False)
            assert text.count(anchor) == 1, f'field anchor mismatch: {path}'
            text = text.replace(anchor, json.dumps(key) + ': ' + json.dumps(new, ensure_ascii=False), 1)
        report.append({'path': list(path), 'before': old, 'after': new})
    new_raw = text.encode('utf-8')
    assert json.loads(new_raw) == after, 'Splice result mismatch'
    assert set(changed_paths(before, after)) == set(paths), 'Unexpected fields changed'
    assert after['types'][4]['resolution_override'] == [1632,1632]
    assert all('岁月与风霜' not in after['art_style_base'][k] for k in ['positive_text','positive_style_text'])
    assert '浓墨轮廓' not in after['color_lexicon']['roles']['ink']
    assert all(('### 第' + n + '步：') in after['expand_instruction']['system_prompt_zh'] for n in '一二三四五六七八')
    if args.apply:
        out = TASK / 'backups'
        backup = out / f'{args.batch}-before-qi21_bases.json'
        assert not backup.exists(), 'Never overwrite batch backup'
        shutil.copy2(SOURCE, backup)
        assert backup.read_bytes() == raw
        assert SOURCE.read_bytes() == raw, 'Source changed before write'
        fd, temp = tempfile.mkstemp(prefix='.qi21-surgery-', dir=SOURCE.parent)
        try:
            with os.fdopen(fd,'wb') as stream:
                stream.write(new_raw)
                stream.flush(); os.fsync(stream.fileno())
            shutil.copymode(SOURCE,temp)
            assert SOURCE.read_bytes() == raw, 'Source changed during surgery'
            os.replace(temp,SOURCE)
        finally:
            if Path(temp).exists(): Path(temp).unlink()
        (out / f'{args.batch}-field-diff.json').write_text(json.dumps(report, ensure_ascii=False,indent=2)+'\n')
        lines=[f'# {args.batch} 字段对比',f'改前 SHA256: {digest(raw)}',f'改后 SHA256: {digest(new_raw)}']
        for entry in report:
            lines += ['\n## ' + '.'.join(map(str,entry['path'])), '\n改前：\n\n' + str(entry['before']), '\n改后：\n\n' + entry['after']]
        (out / f'{args.batch}-field-diff.md').write_text('\n'.join(lines)+'\n')
        state['sha'] = digest(new_raw); state['batches'].append(args.batch)
        state_path.write_text(json.dumps(state,indent=2)+'\n')
    print(json.dumps({'mode':'apply' if args.apply else 'dry-run','batch':args.batch,'changed_fields':['.'.join(map(str,p)) for p in paths],'before_sha':digest(raw),'after_sha':digest(new_raw)}, ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
