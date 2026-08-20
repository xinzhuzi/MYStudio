#!/usr/bin/env python3
"""已知歌词 ↔ whisper 词时间戳 对齐(参数化通用版)。

输入:
  --whisper  whisper word_timestamps 转写 JSON:[{t0,t1,w}, ...]
  --lyrics   行级时间轴 JSON(仅有粗略时间也行,内容真源是 text/section/block):
             [{section, block, text, start, end}, ...]
  --vocal-start / --inter-start / --inter-end / --vocal-end
             词间隙实证锚点(秒)。interlude 可省(无间奏歌曲)。
输出:
  --out-json 字级对齐结果 [{section,block,text,start,end,chars:[{ch,s,e}]}]
  --out-dir  可选,同时生成 lyrics-chars.ts / runs.ts(Remotion 数据常量)

用法示例:
  python3 align_lyrics_whisper.py \
    --whisper whisper-words.json --lyrics lyrics-timeline.json \
    --vocal-start 16.2 --inter-start 88.76 --inter-end 102.08 --vocal-end 189.2 \
    --out-json lyrics-chars-aligned.json --out-dir src/data

技能文档: .agents/skills/lyric-sync-alignment/SKILL.md
"""
import argparse, json, re
from difflib import SequenceMatcher

HAN = re.compile(r'[\u4e00-\u9fff]')
han_of = lambda t: [c for c in t if HAN.match(c)]


def build_stream(words, min_t):
    stream = []
    for w in words:
        han = [c for c in str(w.get('w', w.get('word', ''))) if HAN.match(c)]
        if not han:
            continue
        t0, t1 = float(w['t0'] if 't0' in w else w['start']), float(w['t1'] if 't1' in w else w['end'])
        if t1 < min_t:
            continue
        per = (t1 - t0) / len(han) if t1 > t0 else 0.12
        for k, c in enumerate(han):
            stream.append((c, round(t0 + k * per, 3), round(t0 + (k + 1) * per, 3)))
    return stream


def match_lines(lines, stream):
    """第一遍:逐行单调模糊匹配。返回 records(anchors 命中字 → (s,e))。"""
    records, cursor = [], 0
    for L in lines:
        tgt = han_of(L['text'])
        best = (0, None, None)
        for lo in range(cursor, min(len(stream), cursor + 160)):
            for win in (len(tgt) + 6, len(tgt) + 12, len(tgt) + 20):
                hi = min(len(stream), lo + win)
                sm = SequenceMatcher(None, ''.join(tgt), ''.join(c for c, _, _ in stream[lo:hi]), autojunk=False)
                s = sm.find_longest_match(0, len(tgt), 0, hi - lo).size
                if s > best[0]:
                    best = (s, lo, hi)
        score, lo, hi = best
        anchors, hit = {}, False
        if score >= max(2, len(tgt) // 3):
            sm = SequenceMatcher(None, ''.join(tgt), ''.join(c for c, _, _ in stream[lo:hi]), autojunk=False)
            for op, a1, a2, b1, b2 in sm.get_opcodes():
                if op == 'equal':
                    for k in range(a2 - a1):
                        anchors[a1 + k] = (stream[lo + b1 + k][1], stream[lo + b1 + k][2])
                    cursor = max(cursor, lo + b2)
            hit = len(anchors) > 0
        records.append({**{k: L[k] for k in ('section', 'block', 'text') if k in L},
                        'tgt': tgt, 'anchors': anchors, 'hit': hit})
    return records


def align(records, sec_bounds, has_inter):
    """第二遍:锚点插值 + 未命中行按字数摊分(声部边界硬约束)。"""
    sec = 'A'
    for r in records:
        if r['hit']:
            t = min(v[0] for v in r['anchors'].values())
            sec = 'A' if (not has_inter or t < sec_bounds['inter'][0]) else 'B'
        r['sec'] = sec

    out = []
    for i, r in enumerate(records):
        tgt, anchors = r['tgt'], r['anchors']
        if r['hit']:
            keys = sorted(anchors)
            times = dict(anchors)
            for a, b in zip(keys, keys[1:]):
                for j in range(a + 1, b):
                    f = (j - a) / (b - a)
                    v = anchors[a][1] + (anchors[b][0] - anchors[a][1]) * f
                    times[j] = (v, v + 0.1)
            if keys[0] > 0:
                t0 = anchors[keys[0]][0]
                for j in range(keys[0]):
                    times[j] = (max(sec_bounds[r['sec']][0], t0 - 0.22 * (keys[0] - j)),) * 2
            if keys[-1] < len(tgt) - 1:
                t1 = anchors[keys[-1]][1]
                for j in range(keys[-1] + 1, len(tgt)):
                    v = t1 + 0.22 * (j - keys[-1])
                    times[j] = (v, v + 0.1)
            start = min(t[0] for t in times.values()) - 0.1
            end = max(t[1] for t in times.values()) + 0.15
        else:
            prev_end = out[-1]['end'] + 0.06 if out else sec_bounds[r['sec']][0]
            chain_chars, nxt_anchor = len(tgt), sec_bounds[r['sec']][1]
            for j in range(i + 1, len(records)):
                if records[j]['sec'] != r['sec']:
                    break
                if records[j]['hit']:
                    nxt_anchor = min(v[0] for v in records[j]['anchors'].values()) - 0.1
                    break
                chain_chars += len(records[j]['tgt'])
            span = max(nxt_anchor - prev_end, 0.8)
            start, end = prev_end, prev_end + span * len(tgt) / chain_chars
            times = {j: (start + (end - start) * ((j + 0.5) / len(tgt)) + 0.0,) * 2 for j in range(len(tgt))}
            times = {j: (v[0], v[0] + 0.1) for j, v in times.items()}
        chars = [{'ch': c, 's': round(times[j][0], 3), 'e': round(times[j][1], 3)} for j, c in enumerate(tgt)]
        out.append({'section': r.get('section', ''), 'block': r.get('block', 0), 'text': r['text'],
                    'start': round(start, 2), 'end': round(end, 2), 'chars': chars})

    for i in range(1, len(out)):
        if out[i]['start'] < out[i - 1]['end']:
            mid = (out[i - 1]['end'] + out[i]['start']) / 2
            out[i - 1]['end'] = round(mid, 2)
            out[i]['start'] = round(mid + 0.01, 2)
    return out


def write_ts(out, runs, out_dir, anchors_meta):
    import os
    os.makedirs(out_dir, exist_ok=True)

    def ts_const(name, val, ty=None):
        body = json.dumps(val, ensure_ascii=False)
        for k in ('block', 'section', 'start', 'end', 'ch', 's', 'e'):
            body = body.replace(f'"{k}"', k)
        return f'export const {name}{": " + ty if ty else ""} = ' + body + ';\n'

    with open(f'{out_dir}/lyrics-chars.ts', 'w') as f:
        f.write('// AUTO-GENERATED by align_lyrics_whisper.py(技能 lyric-sync-alignment)\n')
        f.write('export type CharTime = {ch: string; s: number; e: number};\n')
        f.write('export type LyricLineChars = {section: string; block: number; text: string; start: number; end: number; chars: CharTime[]};\n')
        f.write(ts_const('LYRICS_CHARS', out, 'LyricLineChars[]'))
    with open(f'{out_dir}/runs.ts', 'w') as f:
        f.write('// AUTO-GENERATED by align_lyrics_whisper.py(技能 lyric-sync-alignment)\n')
        f.write('export type Run = {block: number; section: string; start: number; end: number};\n')
        f.write(ts_const('RUNS', runs, 'Run[]'))
        f.write(f"export const VOCAL = {{start: {anchors_meta['vocal_start']}, end: {anchors_meta['vocal_end']}}} as const;\n")
        if anchors_meta['inter_start'] is not None:
            f.write(f"export const INTERLUDE = {{start: {anchors_meta['inter_start']}, end: {anchors_meta['inter_end']}}} as const;\n")
        f.write(ts_const('CHORUS_STARTS', [r['start'] for r in runs if r.get('section') == 'Chorus'], 'number[]'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--whisper', required=True)
    ap.add_argument('--lyrics', required=True)
    ap.add_argument('--vocal-start', type=float, required=True)
    ap.add_argument('--inter-start', type=float)
    ap.add_argument('--inter-end', type=float)
    ap.add_argument('--vocal-end', type=float, required=True)
    ap.add_argument('--out-json', required=True)
    ap.add_argument('--out-dir')
    a = ap.parse_args()

    words = json.load(open(a.whisper))
    lines = json.load(open(a.lyrics))
    stream = build_stream(words, a.vocal_start - 1.0)
    print(f'字流 {len(stream)} 字:{stream[0][1]:.2f}s → {stream[-1][2]:.2f}s')

    records = match_lines(lines, stream)
    has_inter = a.inter_start is not None
    sec_bounds = {'A': (a.vocal_start, a.inter_start if has_inter else a.vocal_end),
                  'B': (a.inter_end if has_inter else a.vocal_end, a.vocal_end),
                  'inter': (a.inter_start if has_inter else float('inf'),
                            a.inter_end if has_inter else float('inf'))}
    out = align(records, sec_bounds, has_inter)

    json.dump(out, open(a.out_json, 'w'), ensure_ascii=False, indent=1)
    runs = []
    for o in out:
        if runs and runs[-1]['block'] == o['block']:
            runs[-1]['end'] = o['end']
        else:
            runs.append({'block': o['block'], 'section': o['section'], 'start': o['start'], 'end': o['end']})

    hits = sum(1 for r in records if r['hit'])
    print(f'命中 {hits}/{len(records)} 行')
    for o, r in zip(out, records):
        print(f"  {'OK ' if r['hit'] else 'ext'} {o['start']:7.2f}-{o['end']:7.2f} {o['text']}")

    if a.out_dir:
        write_ts(out, runs, a.out_dir,
                 {'vocal_start': a.vocal_start, 'vocal_end': a.vocal_end,
                  'inter_start': a.inter_start, 'inter_end': a.inter_end})
        print(f'TS 常量已写 {a.out_dir}/')


if __name__ == '__main__':
    main()
