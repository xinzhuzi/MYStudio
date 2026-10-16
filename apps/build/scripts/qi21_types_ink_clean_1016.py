#!/usr/bin/env python3
"""1016 型文层墨字头清理+同步(用户令:按建议六句替换,全链同步)。

六句刀(vs 新底座「色面边界明确平整/色相对比保持清晰/crisp sharp edges」对齐):
  A×2 人物+美宣:「远景允许淡墨软边与空气过渡」→「远景以低饱和色面退开,保留清晰色相层次」
  B×3 场景+分镜+概念:「淡墨和软边退开,保留空气透视」→「低饱和成片色面退开,色相对比保持清晰」
  D×1 场景中景:「墨色分层晕染」→「色彩分层晕染」(1009 墨色浓淡家族同款换法)
  E×1 美宣:「笔墨退居其次」→「线描退居其次」(笔墨=1009 退役余量词)
不动:色卡 color_lexicon 的「淡墨」传统色名(合规);05库/canon_lib 陈年镜像仅清 E 词
(其 A/B/D 为旧 vintage 本就无,漂移系并行役前账);历史手术脚本(台账不改写);测试零锚。
同步面:真源+装机+release+MA+IP+引擎data 六份 bases(直改等计数)+05库+canon_lib。
fail-closed:每对词每文件精确计数;术后残留零+回读;幂等 exit 3。
"""
import json, shutil, sys, hashlib
from pathlib import Path
ROOT = Path('/Users/zhengbingjin/Project/Github/MYStudio')
OUT = ROOT / 'apps/output/automation/qi21-types-ink-clean-1016'
PAIRS = [
    ('远景允许淡墨软边与空气过渡', '远景以低饱和色面退开，保留清晰色相层次', 2),
    ('淡墨和软边退开，保留空气透视', '低饱和成片色面退开，色相对比保持清晰', 3),
    ('墨色分层晕染', '色彩分层晕染', 1),
    ('笔墨退居其次', '线描退居其次', 1),
]
BASES = [
    ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
    Path('/Applications/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
    ROOT / 'apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json',
    Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/漫影工作室/skills/art_skills/daojie_ink_guofeng/json/qi21_bases.json'),
    Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data/qi21_bases.json'),
]
MIRRORS = [
    (ROOT / 'docs/prompts/Qwen-Image-2.1/05-道劫规范提示词库.md', [('笔墨退居其次', '线描退居其次', 1)]),
    (ROOT / 'apps/build/scripts/daojie_canon_lib.py', [('笔墨退居其次', '线描退居其次', 1)]),
]

def fail(m): print(f'[ink] FAIL: {m}'); sys.exit(2)

def md5(p): return hashlib.md5(p.read_bytes()).hexdigest()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ledger = []
    for p in BASES + [m[0] for m in MIRRORS]:
        if not p.exists(): fail(f'目标缺失:{p}')
        text = p.read_text(encoding='utf-8')
        pairs = PAIRS if p in BASES else next(mp[1] for mp in MIRRORS if mp[0] == p)
        if all(text.count(new) == n and text.count(old) == 0 for old, new, n in pairs) \
                and (p not in BASES or text.count(PAIRS[0][0]) == 0):
            print(f'[ink] {p.name}({str(p.parent)[-20:]}) 已术后,跳过'); continue
        bak = OUT / ('bak-' + md5(p)[:10] + '-' + p.name)
        if not bak.exists(): shutil.copy2(p, bak)
        for old, new, expect in pairs:
            got = text.count(old)
            if got != expect: fail(f'{p}: 「{old[:14]}」期望×{expect} 实际×{got}')
            text = text.replace(old, new)
        p.write_text(text, encoding='utf-8')
        ledger.append({'path': str(p), 'before': md5(bak), 'after': md5(p)})
    (OUT / 'changes.json').write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')
    # 终验:六份 bases 残留零(A/B/D/E 旧词)+色卡淡墨仍在+JSON 合法
    for p in BASES:
        t = p.read_text(encoding='utf-8')
        for old, _, _ in PAIRS:
            if old in t: fail(f'{p}: 残留 {old[:14]}')
        d = json.loads(t)
        if '淡墨' not in json.dumps(d.get('color_lexicon', {}), ensure_ascii=False):
            fail(f'{p}: 色卡淡墨色名失踪(误伤)')
    print(f'[ink] 完成:六句刀落 {len(ledger)} 文件(六 bases+两镜像);'
          f'色卡淡墨色名保全;残留零')

if __name__ == '__main__':
    main()
