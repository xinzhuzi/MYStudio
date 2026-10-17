#!/usr/bin/env python3
"""qi21 底座/链上文本换血·通用引擎(1016 用户令:合并同机制复刻链,一役一配置不再复制机壳)。

退役三代复刻(qi21_base_multicolor_swap/duocai_final/zhongcai_swap,见 retired/);
本件=唯一机壳:台账备份/拒续护栏/六阶段/43目标分发/终验全内置,役只给配置。

用法:
  python3 qi21_base_swap_tool.py --config <json> --stage core|docs|snapshots|test-anchors|distribute|verify|all
  python3 qi21_base_swap_tool.py --config <json> --stage check   # 干跑:只验前置形态,零写入

配置面(全可省除 campaign/positive_* 外):
  campaign                  役名(记台账/LOCK_SNAPSHOT)
  positive_old/new          底座正向全文(真源/prefix/contract/工作流原位换句)
  negative_pairs            [[旧,新,期望数],...] 底座负向(真源+工作流)
  source_pairs              真源内附加换句(_doc/段矩阵OWNS等)
  prefix_count              prefix.md 底座全文份数(默认2)
  prompt_layering_pairs     分层契约换句
  lock_anchor_pairs         风格底座锁锚换句
  style_guide_swaps         [{file:相对manual路径, pairs:[[旧,新,n],...]}]
  extra_file_swaps          [{file:仓内相对路径, pairs:...}](canon_lib/测试锚等)
  wf_counts                 {工作流相对路径:底座全文份数}
  neg_wf_counts             {同上:负向段份数}
  snapshot_note             LOCK_SNAPSHOT 记档段
  assembly_sha16_old        装配测试旧sha16(新值=sha(positive_new)[:16]自动算)
  boundary_pairs            边界测试词表换句
  ts_frame_pairs            TS合同框架句换句(合同指纹锚自动精确匹配 toBe 行)
  manual_files_distribute   分发手册清单(默认七件含色彩手册)
  residue_tokens            终验残留词(默认常用旧词集+配置追加)
护栏:前置形态不符→拒续退出码2;已是新稿→幂等跳过退出码0。
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
MANUAL = ROOT / 'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
SOURCE = MANUAL / 'json/qi21_bases.json'
TESTS = ROOT / 'apps/backend/engines/comfyui/my_nodes/tests'
TS_CONTRACT_TEST = ROOT / 'apps/frontend/lib/ai/daojie-prompt-contract.test.ts'

DEFAULT_MANUAL_DIST = ['prefix.md', 'json/qi21_bases.json', 'json/prompt_layering.json',
                       'style_guide/03_色彩体系.md',
                       'ma_sync/runtime-contract.json', 'ma_sync/lock-anchors.json',
                       'ma_sync/LOCK_SNAPSHOT.md']
DEFAULT_RESIDUE = []


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class Tool:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.out = ROOT / 'apps/output/automation' / cfg['out_dir']
        self.new = cfg['positive_new']
        self.old = cfg['positive_old']

    # ── 台账/备份/换句 ────────────────────────────────────────────────
    def ledger_write(self, path: Path, data: bytes, reason: str) -> None:
        before = path.read_bytes()
        if before == data:
            return
        relative = (path.relative_to(ROOT) if path.is_relative_to(ROOT)
                    else Path('external') / path.relative_to('/'))
        backup = self.out / 'backups' / relative
        backup.parent.mkdir(parents=True, exist_ok=True)
        if not backup.exists():
            shutil.copy2(path, backup)
        path.write_bytes(data)
        ledger_file = self.out / 'changes.json'
        ledger = json.loads(ledger_file.read_text()) if ledger_file.exists() else []
        row = next((r for r in ledger if r['path'] == str(path)), None)
        if row is None:
            row = {'path': str(path), 'backup': str(backup), 'before': sha(before), 'reasons': []}
            ledger.append(row)
        row['after'] = sha(data)
        if reason not in row['reasons']:
            row['reasons'].append(reason)
        ledger_file.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + '\n')

    def swap(self, path: Path, pairs, reason: str) -> None:
        text = path.read_text(encoding='utf-8')
        for old, new, expect in pairs:
            got = text.count(old)
            if got != expect:
                raise RuntimeError(f'{path.name}: 期望 {old[:24]!r}×{expect}, 实际×{got}(并行态又变了,拒续)')
            text = text.replace(old, new)
        self.ledger_write(path, text.encode('utf-8'), reason)

    # ── 前置形态/幂等 ────────────────────────────────────────────────
    def check(self) -> int:
        data = json.loads(SOURCE.read_text(encoding='utf-8'))
        pos, neg = data['art_style_base']['positive_text'], data['art_style_base']['negative_text']
        for mark in self.cfg.get('guards_positive_contain', []):
            if mark not in pos:
                print(f'拒续:真源缺前置标记 {mark!r}(并行态又变了)', file=sys.stderr)
                return 2
        for old, _new, _n in self.cfg.get('negative_pairs', []):
            if old not in neg and _new not in neg:
                print(f'拒续:负向既无旧段也无新段 {old[:16]!r}', file=sys.stderr)
                return 2
        if pos == self.new:
            print('已是新稿,幂等跳过(退出码0)')
            return 0
        if pos != self.old:
            print('拒续:真源既非旧稿也非新稿,停手人工核(退出码2)', file=sys.stderr)
            return 2
        print('前置形态核验通过,可施工')
        return 1

    def already(self) -> bool:
        return json.loads(SOURCE.read_text(encoding='utf-8'))['art_style_base']['positive_text'] == self.new

    # ── 六阶段 ───────────────────────────────────────────────────────
    def core(self) -> None:
        if self.already() and not self.cfg.get('source_pairs') and not self.cfg.get('negative_pairs'):
            return
        assert json.dumps(json.loads(SOURCE.read_text(encoding='utf-8')), ensure_ascii=False,
                          indent=2) + '\n' == SOURCE.read_text(encoding='utf-8')
        pairs = [(self.old, self.new, 1)] + [(o, n, c) for o, n, c in self.cfg.get('negative_pairs', [])]
        pairs += [(o, n, c) for o, n, c in self.cfg.get('source_pairs', [])]
        self.swap(SOURCE, pairs, f"{self.cfg['campaign']}:真源三刀+doc/OWNS随源")

    def docs(self) -> None:
        prefix = MANUAL / 'prefix.md'
        if prefix.read_text(encoding='utf-8').count(self.new) < self.cfg.get('prefix_count', 2):
            self.swap(prefix, [(self.old, self.new, self.cfg.get('prefix_count', 2))],
                      '手册底座全文随源')
        pl = MANUAL / 'json/prompt_layering.json'
        pl_pairs = self.cfg.get('prompt_layering_pairs', [])
        if pl_pairs and any(o in pl.read_text(encoding='utf-8') for o, _n, _c in pl_pairs):
            self.swap(pl, pl_pairs, '分层契约随源')
        la = MANUAL / 'ma_sync/lock-anchors.json'
        la_pairs = self.cfg.get('lock_anchor_pairs', [])
        if la_pairs and any(o in la.read_text(encoding='utf-8') for o, _n, _c in la_pairs):
            self.swap(la, la_pairs, '风格底座锁锚随源')
        for item in self.cfg.get('style_guide_swaps', []):
            p = MANUAL / item['file']
            if any(o in p.read_text(encoding='utf-8') for o, _n, _c in item['pairs']):
                self.swap(p, item['pairs'], '手册术语随源')
        for item in self.cfg.get('extra_file_swaps', []):
            p = ROOT / item['file']
            if any(o in p.read_text(encoding='utf-8') for o, _n, _c in item['pairs']):
                self.swap(p, item['pairs'], '链上镜像/测试锚随源')
        note = self.cfg.get('snapshot_note')
        if note:
            snapshot = MANUAL / 'ma_sync/LOCK_SNAPSHOT.md'
            stext = snapshot.read_text(encoding='utf-8')
            marker = '本目录是 MYStudio 道劫手册与 MA `ma-imagegen` 的同步锚点:'
            if stext.count(marker) != 1:
                raise RuntimeError('LOCK_SNAPSHOT 标记异常')
            if self.cfg['campaign'] not in stext:
                self.ledger_write(snapshot, stext.replace(marker, note + '\n' + marker).encode('utf-8'),
                                  '记档')
        contract = MANUAL / 'ma_sync/runtime-contract.json'
        data = json.loads(contract.read_text(encoding='utf-8'))
        if (data['modules']['style.gongbi-base']['text'] != self.new
                or data['localRevision'].get('styleSourceSha256') != sha(SOURCE.read_bytes())):
            data['modules']['style.gongbi-base']['text'] = self.new
            data['localRevision']['styleSourceSha256'] = sha(SOURCE.read_bytes())
            fingerprint = {k: v for k, v in data.items() if k != 'contractSha256'}
            data['contractSha256'] = sha(json.dumps(fingerprint, ensure_ascii=False, sort_keys=True,
                                                    separators=(',', ':')).encode())
            self.ledger_write(contract,
                              (json.dumps(data, ensure_ascii=False, indent=2) + '\n').encode('utf-8'),
                              '运行时风格模块同文+重算合同指纹')

    def snapshots(self) -> None:
        for rel, expect in self.cfg.get('wf_counts', {}).items():
            p = ROOT / rel
            text_now = p.read_text(encoding='utf-8')
            pairs = []
            if text_now.count(self.new) < expect:
                pairs.append((self.old, self.new, expect))
            neg_expect = self.cfg.get('neg_wf_counts', {}).get(rel)
            if neg_expect:
                o, n, _c = self.cfg['negative_pairs'][0]
                if o in text_now:
                    pairs.append((o, n, neg_expect))
            if pairs:
                self.swap(p, pairs, '工作流/子图底座原位换句')

    def test_anchors(self) -> None:
        asm = TESTS / 'test_my_qi21_prompt_assembly.py'
        new16 = sha(self.new.encode())[:16]
        atext = asm.read_text(encoding='utf-8')
        old16 = self.cfg.get('assembly_sha16_old')
        if old16 and old16 in atext:
            self.swap(asm, [(f'"{old16}"', f'"{new16}"  # {self.cfg["campaign"]}重锚', 1)],
                      '装配sha16锚随源')
        elif new16 not in atext:
            raise RuntimeError('装配 sha16 锚既无旧值也无新值,人工核')
        bp = self.cfg.get('boundary_pairs', [])
        bfile = TESTS / 'test_qi21_style_boundary_1016.py'
        if bp and any(o in bfile.read_text(encoding='utf-8') for o, _n, _c in bp):
            self.swap(bfile, bp, '边界词表锚随源')
        ts_text = TS_CONTRACT_TEST.read_text(encoding='utf-8')
        for o, n, c in self.cfg.get('ts_frame_pairs', []):
            if o in ts_text:
                self.swap(TS_CONTRACT_TEST, [(o, n, c)], 'TS框架句锚随源')
                ts_text = TS_CONTRACT_TEST.read_text(encoding='utf-8')
        rc = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())
        m = re.search(r'contractSha256"\)\.toBe\(\s*(?://[^\n]*\n\s*)?"([0-9a-f]{64})"', ts_text)
        if m and m.group(1) != rc['contractSha256']:
            self.swap(TS_CONTRACT_TEST, [(m.group(1), rc['contractSha256'], 1)], 'TS合同指纹锚随重算值')

    def distribute(self) -> None:
        app = Path('/Applications/漫影工作室.app/Contents/Resources')
        release = ROOT / 'apps/release/build/mac-arm64/mac-arm64/漫影工作室.app/Contents/Resources'
        ma = Path('/Users/zhengbingjin/Project/IP/MA/skills/art_skills/daojie_ink_guofeng')
        ip = Path('/Users/zhengbingjin/Project/IP/漫影工作室/skills/art_skills/daojie_ink_guofeng')
        engine_data = Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/daojie-data')
        engine_nodes = Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui/ComfyUI/custom_nodes/my-nodes')
        manual_rel = 'studio-manuals/art_skills/daojie_ink_guofeng'
        plan: list[tuple[Path, Path]] = []
        for name in self.cfg.get('manual_files_distribute', DEFAULT_MANUAL_DIST):
            src = MANUAL / name
            for base, rel in [(app, manual_rel), (release, manual_rel), (ma, '.'), (ip, '.')]:
                plan.append((src, base / rel / name))
        for rel in self.cfg.get('wf_counts', {}):
            src = ROOT / rel
            wf_base = src.relative_to(ROOT / 'apps/backend/engines/comfyui')
            plan.append((src, app / 'backend/engines/comfyui' / wf_base))
            plan.append((src, release / 'backend/engines/comfyui' / wf_base))
            if src.parent.name == 'subgraphs':
                plan.append((src, engine_nodes / 'subgraphs' / src.name))
        plan.append((SOURCE, engine_data / 'qi21_bases.json'))
        rows = []
        for src, target in plan:
            if not target.exists():
                rows.append({'target': str(target), 'status': 'missing'})
                continue
            src_bytes = src.read_bytes()
            if target.read_bytes() == src_bytes:
                rows.append({'target': str(target), 'status': 'already-in-sync'})
                continue
            if src == SOURCE:
                # 真源=types+底座+分层契约全量镜像(1016 型文役定谳:保types合并会漏发型文)
                data = src_bytes
            else:
                data = src_bytes
            self.ledger_write(target, data, '分发:随源' + ('(保留目标types)' if src == SOURCE else ''))
            rows.append({'target': str(target), 'status': 'written',
                         'byte_identity': target.read_bytes() == src_bytes})
        (self.out / 'distribution.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
        print(f'分发 {len(rows)}: written={sum(1 for r in rows if r["status"] == "written")}, '
              f'in-sync={sum(1 for r in rows if r["status"] == "already-in-sync")}, '
              f'missing={sum(1 for r in rows if r["status"] == "missing")}')

    def verify(self) -> None:
        problems = []
        for tok in DEFAULT_RESIDUE + self.cfg.get('residue_tokens', []):
            for p in [SOURCE, MANUAL / 'json/prompt_layering.json', MANUAL / 'prefix.md',
                      MANUAL / 'ma_sync/runtime-contract.json', MANUAL / 'ma_sync/lock-anchors.json'] \
                    + [MANUAL / i['file'] for i in self.cfg.get('style_guide_swaps', [])] \
                    + [ROOT / rel for rel in self.cfg.get('wf_counts', {})]:
                if tok in p.read_text(encoding='utf-8'):
                    problems.append(f'残留 {tok!r}: {p.name}')
        for p, expect in [(SOURCE, 1), (MANUAL / 'prefix.md', self.cfg.get('prefix_count', 2)),
                          (MANUAL / 'ma_sync/runtime-contract.json', 1)] \
                + [(ROOT / rel, c) for rel, c in self.cfg.get('wf_counts', {}).items()]:
            got = p.read_text(encoding='utf-8').count(self.new)
            if got != expect:
                problems.append(f'新句次数 {p.name}: {got}!={expect}')
        asm = (TESTS / 'test_my_qi21_prompt_assembly.py').read_text(encoding='utf-8')
        if sha(self.new.encode())[:16] not in asm:
            problems.append('装配sha16锚未同步')
        rc_sha = json.loads((MANUAL / 'ma_sync/runtime-contract.json').read_text())['contractSha256']
        if rc_sha not in TS_CONTRACT_TEST.read_text(encoding='utf-8'):
            problems.append('TS指纹锚未同步')
        anchors = json.loads((MANUAL / 'ma_sync/lock-anchors.json').read_text())
        prefix_text = (MANUAL / 'prefix.md').read_text(encoding='utf-8')
        for lock in anchors['locks']:
            if lock['name'] == '风格底座锁':
                for a in lock.get('manualAnchors', []):
                    if a not in prefix_text:
                        problems.append(f'风格锁锚不在 prefix.md: {a[:28]}')
        dist_file = self.out / 'distribution.json'
        if not dist_file.exists():
            problems.append('未跑 distribute,无分发台账')
        else:
            for row in json.loads(dist_file.read_text()):
                if row['status'] == 'missing':
                    problems.append(f'分发目标缺失: {row["target"]}')
        print(json.dumps({'ok': not problems, 'problems': problems}, ensure_ascii=False, indent=1))
        if problems:
            sys.exit(1)


STAGES = ['core', 'docs', 'snapshots', 'test-anchors', 'distribute', 'verify']


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--config', required=True)
    ap.add_argument('--stage', required=True,
                    choices=['check', 'all'] + STAGES)
    args = ap.parse_args()
    cfg = json.loads((ROOT / args.config).read_text(encoding='utf-8')) \
        if not Path(args.config).is_absolute() else json.loads(Path(args.config).read_text(encoding='utf-8'))
    tool = Tool(cfg)
    tool.out.mkdir(parents=True, exist_ok=True)
    if args.stage == 'check':
        sys.exit(0 if tool.check() in (0, 1) else 2)
    if args.stage == 'all':
        st = tool.check()
        if st == 0:
            print('已是新稿,幂等跳过全部阶段')
            return
        if st == 2:
            sys.exit(2)
        for s in STAGES:
            print(f'── {s} ──')
            getattr(tool, s.replace('-', '_'))()
        return
    getattr(tool, args.stage.replace('-', '_'))()


if __name__ == '__main__':
    main()
