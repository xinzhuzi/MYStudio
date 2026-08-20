---
name: lyric-sync-alignment
description: Align known-lyrics text to a song audio via whisper word timestamps for karaoke-style per-character highlighting in Remotion. Use when building music MVs, lyric videos, or per-word/per-char caption timing — especially when lyrics text is already authoritative and only timing is needed. Covers the RMS-energy pitfall (instrumental intro has energy but no vocals) and the anchor-interpolation alignment pipeline.
metadata:
  tags: lyrics, karaoke, whisper, alignment, audio, captions, mv, remotion
---

# Lyric Sync Alignment(已知歌词 ↔ whisper 时间戳对齐)

## Overview

歌词文本已知、只缺时间信息的场景(音乐 MV 逐字跟唱/歌词视频)。**不要**用音频能量(RMS)估算人声段落——**器乐前奏/间奏同样有能量**,实证案例中 RMS 把人声起点判早了 10 秒(估 6.0s,whisper 实测 16.2s),导致全片歌词系统性错位。正确路线:whisper 词级时间戳为唯一时间真源,歌词文本为唯一内容真源,两者做**单调模糊对齐**。

## 核心结论(先读)

1. **whisper 对唱腔的「字」经常听错,但时间戳可信**。对齐必须模糊匹配(difflib),不能要求逐字相等;只要一行有 ≥1/3 字连续命中即可锚定该行。
2. **人声起止与间奏从词流间隙读出**,不从能量读:全曲最长词间隙=间奏(案例 13.3s 词隙=歌词标注的「~12s 竹笛间奏」);次长的头部间隙=器乐前奏(14.2s→人声 16.2s 起)。
3. **重复副歌靠单调游标防串段**:逐行匹配时游标只前进,第 N 遍副歌就落不到第 N-1 遍的重复词上(五遍「一剑万劫」分别锚在 47.8/79.6/141.5/154.2/170.0s)。
4. 未命中的行(唱腔模糊/气声)在**同声部相邻锚点间按字数摊分**,并用间奏/人声边界做硬约束,禁止跨间奏插值。
5. 汉语字≈音节:whisper 多字词的时长均分到字,即可得到字级(而非词级)跟唱粒度。

## Pipeline(可复跑五步)

前置:`pip install openai-whisper`(或任何能输出 word timestamps 的 ASR;模型 small 即够,blob 存于 `~/.cache/whisper/`)。

1. **转写**:`model.transcribe(wav, language='zh', word_timestamps=True, beam_size=5)`,`initial_prompt` 喂入歌词首句片段可显著减少开头幻听。输出词流 `[{t0,t1,w}]`。
2. **字流展开**:滤非汉字、滤人声起点前的幻听 token(案例:前奏段被转成「y-y-y」);多字词均分时长。
3. **逐行单调匹配**(核心,见 assets/align_lyrics_whisper.py):
   - 每行歌词在 `[cursor, cursor+160字]` 窗口内滑窗,`SequenceMatcher.find_longest_match` 取最长连续命中;
   - 命中行:`get_opcodes()` 的 equal 块给出**锚点字时间**;行内未锚字在锚点间线性插值,行首/行尾向外按 0.22s/字外推;
   - 未命中行:与后续连续未命中行一起,按字数瓜分「上一行 end → 下一锚点行 start」的间隙。
4. **硬约束与单调化**:间奏 `[INTER.start, INTER.end]`、人声 `[VOCAL.start, VOCAL.end]` 从词流间隙算出后写死;插值不得跨界;行间重叠取中点劈开。
5. **产出两份数据**(生成 TS 常量,渲染端零解码):
   - `lyrics-chars.ts`:`LYRICS_CHARS: {section, block, text, start, end, chars: CharTime[]}[]`,`CharTime={ch,s,e}`;
   - `runs.ts`:`RUNS`(块级起止,驱动画面轨道/调色分段)+ `INTERLUDE/VOCAL/CHORUS_STARTS` 锚点。

## 渲染端要点(Remotion)

- **Sequence 本地帧 ≠ 歌曲时间**:`<Sequence from={(line.start-LEAD)*fps}>` 内,歌曲时间 = `line.start - LEAD + frame/fps`。案例教训:先想清楚再写,这里错过一次(+0.22 当成了 -0.22)。
- 字点亮用 `interpolate(songT, [ct.s, ct.s+0.15], …)`:已唱=金色,唱中 0.15s 内 `scale 1+0.055·sin(p·π)` 微放大回落,未唱=45% 白。空格渲染为 `width: 0.5em` 的 span,不占时间。
- 波形/辉光等能量可视化用**离线预计算峰值 JSON**(Python 扫 wav → 数组常量),不要在渲染时解码全曲(`useWindowedAudioData` 对 6000 帧量级明显更慢)。
- 字↔时间对位用 `charAt(line, idx)`:按「text 中第 idx 个汉字 ↔ chars[k]」的出现次序映射,不能用 `chars.find(c=>c.ch===ch)`(同字重复会串位)。

## 验证方法(交付前必做)

- **锚点双时刻抽帧**:取某锚定行的第 2 字与倒数第 2 字的 `s` 时刻各渲一帧,金亮字数应恰好在那些字附近(这是「卡点准」的直接证据;普通均匀抽帧验不出)。
- **间奏帧**:词间隙中点抽帧,应无任何歌词。
- 抽帧拼图后逐格目检(模型视觉或人眼),重点看同行推进而非单帧美观。

## Reference implementation

- 对齐脚本(参数化、可复跑):本技能 `assets/align_lyrics_whisper.py`。
- 完整落地案例(2026-08,《劫火燃天》OP MV v3):`/Users/zhengbingjin/Project/temp/劫火燃天/` 下 `_research/steps/06_align_whisper.py`(原始版)+ `mv/src/`(渲染组件)。注意 temp 目录可能被清理,以本技能内脚本为准。

## Anti-patterns

- ❌ 用 RMS/能量阈值判定「人声开始」——器乐有能量;只可信词间隙。
- ❌ 要求 whisper 转写字与歌词逐字相等再取时间——唱腔必然听错字。
- ❌ 未命中行沿用旧估算时间——会与锚点行互相挤压、越错越多。
- ❌ 全局一次性匹配 45 行——重复副歌会串到前面的重复段;必须带游标逐行。
