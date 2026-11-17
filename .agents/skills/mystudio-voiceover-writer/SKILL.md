---
name: mystudio-voiceover-writer
description: Plan and validate MYStudio storyboard voiceover with canonical speaker IDs, fixed character and narrator voice bindings, TTS-ready spoken text, duration targets, and final-video gates. Use when generating or repairing per-shot narration/dialogue, preparing a chapter for automatic video production, checking speaker-to-voice coverage, or preventing fixed voices from changing across reruns.
---

# MYStudio Voiceover Writer

## Overview

Produce one TTS-ready voiceover item for every storyboard while keeping character identity and voice bindings stable. Treat novel text as read-only source evidence and keep spoken copy separate from image-generation prompts.

## Required inputs

- Load the target episode's latest director plan and storyboard table.
- Load target-episode character entities with exact `characterId`, `name`, and `aliases`.
- Load current project voice bindings, voice profiles, and available audio assets.
- Load the target chapter text only as read-only context; never write voiceover edits back into it.

Stop and report missing inputs before producing output. Do not infer field names, IDs, or paths.

## Output contract

Return one item per source storyboard, in source order:

```json
{
  "storyboardId": "sb-chapter-001-001",
  "index": 1,
  "speaker": "旁白",
  "speakerId": "narrator",
  "line": "傍晚，金水河码头被太一宗火印压醒。",
  "ttsSpokenText": "傍晚，金水河码头被太一宗火印压醒。",
  "durationTarget": 4.2,
  "voiceStyle": "中文旁白配音，沉郁基调，音量克制，语速沉稳，句间停顿自然。",
  "requiresFixedVoice": true
}
```

Require every field above. Keep `durationTarget` positive and keep `requiresFixedVoice` exactly `true`.

## Workflow

1. Preserve the source storyboard count and order. Never add a fixed expected count such as 43.
2. Parse `角色名：内容` or `角色名:内容` into `speaker` and `line`.
3. For an empty/no-dialogue shot, set `speaker=旁白` and write one short narration line grounded in the visual action. Do not use `无台词`, `—`, or empty text.
4. Resolve narrator labels `旁白`, `VO`, `画外音`, and `解说` to `speakerId=narrator`.
5. Resolve a character by exact entity `name` first, then exact declared alias. Emit `speakerId=character:{characterId}` only when exactly one entity matches.
6. Fail on zero or multiple character matches. Never use fuzzy display-name guessing as identity.
7. Normalize `ttsSpokenText` for speech without changing meaning. Remove stage directions, Markdown, speaker prefixes, and visual-only annotations.
8. Set `voiceStyle` from the fixed voice profile and the scene emotion; do not replace the profile.
9. Validate voice binding coverage before approving the plan.

## Fixed voice rules

- Reuse an existing binding and profile without changing `profileId`, reference audio path, or profile timestamps.
- Select an audio asset only when the canonical speaker has no binding. Persist the new binding immediately; all later runs treat it as fixed.
- Give narrator its own fixed binding. Never substitute narrator audio for a character or a character voice for narrator.
- Fail if a binding points to a missing profile, lacks reference text, or references a missing/unreadable audio file.
- Fail if any speaker lacks a fixed profile after the missing-binding selection step.
- Never use mock TTS, system-voice fallback, or silent preview for a final video.

## Text boundaries

- Do not modify the novel chapter, source script, director plan, or storyboard visual description while planning voiceover.
- Do not insert subtitles, captions, watermarks, title cards, typography, UI text, or readable words into an image prompt.
- Keep `line` and `ttsSpokenText` in the audio contract only.
- Default to local processing. Do not upload text or reference audio to a cloud TTS service without explicit authorization.

## Final validation

- Assert output count equals the source storyboard count and both are greater than zero.
- Assert every item has non-empty `speaker`, `speakerId`, `line`, `ttsSpokenText`, and `voiceStyle`.
- Assert every item has positive `durationTarget` and `requiresFixedVoice=true`.
- Assert every unique `speakerId` exists in the fixed voice map.
- Assert every storyboard has a real audio path before final rendering.
- Report exact storyboard IDs and reasons for all failures; do not approve a partial plan as complete.

---

## 配音落链事实（2026-08-14 起）

本技能产出的 speaker/ttsSpokenText 经 TTS 生成 `exports/<chapterId>/voice-audio/shot-XXX.wav` 后，需按序执行（CLI，工作目录 `apps/`）：

```bash
npx vite-node --config build/timeline/vite-node.config.ts build/timeline/bind-voice-audio.ts          # wav → chapter manifest voice bindings
npx vite-node --config build/timeline/vite-node.config.ts build/timeline/update-storyboards-voice.ts  # storyboard store 绑定 + audioRef 镜像 + ttsJob + subtitleAuthority + 清 stale（自动备份，拒绝重复绑定）
MYSTUDIO_REQUIRE_HUMAN_APPROVAL=0 MYSTUDIO_CONTINUITY_POLICY=skip npm run remotion:chapter001:shots   # 重渲 43 镜，配音烘进 MP4
```

时长语义：每镜 durationUs = max(视觉时长, 配音时长 + 400ms 尾垫)；配音长于画面的镜头由 video-use `pad-video-to-audio` 自动补齐。回滚：store 备份文件 `studio-workflow-store.json.bak-voice-<ts>`。

---

## 1115 superi 吸收（台词声音控制三法）

> 来源：刺猬星球super-i 声音体系（P4 两分法：域内条目+真源引用，不复制全文；审计台账件#10 三缺之源）。详解真源：`docs/comfyui-kb/参考_提示词工程/刺猬星球super-i/帧内提示词原文.md` #37（参考音色生成模板）/#38（台词状态标注格式），声音公式与标点节奏另见同夹 `知识库.md` 声音条（BV1qieF67ENv）。帧内件#39（环境音提示词）归 H3 声床域，非本技能域。只加不改：三法叠加在既有契约之上，Output contract、净化规则、固定声线规则一概不动。

### 台词状态标注法（帧内件#38）

每句台词前用【】标注状态与语气变化，标注内容写过程参数、不写情绪结论。例（引帧内件#38 原文）：

【看到对方终于出现，原本有些担心，发现对方没事后，轻轻松了一口气】"你可算来了…"
【停顿0.5秒，看着对方走近，语气逐渐轻松下来】"我刚才甚至已经开始怀疑，是不是自己把时间记错了。"

与 voiceMood 锚的关系——两档按镜选一：

- **档A·全局锚（默认）**：单镜情绪单一时不逐句加注。角色台词经 `apps/frontend/lib/assist/image-studio/h3-shot-prompt.ts` 注入 H3 prompt 时自带每镜全局锚 `says in a <voiceMood> tone:`（voiceMood=storyboard.emotion，口径见 `.agents/skills/h3-prompt-writing/SKILL.md` Manying Pipeline Audio Policy）；旁白/TTS 侧的全局语气由 `voiceStyle` 承担。
- **档B·逐句标注**：镜内情绪有转折或递进（见「多句台词时间递进」）时逐句加注。标注只住台本/配音指导层：`ttsSpokenText` 恒为净文本（Workflow 第 7 步净化规则不动，普通 TTS 会照读括号）；注入 H3 的角色台词文本同样不带【】，语气仍归 voiceMood 锚。仅当明确走指令跟随型 TTS（Seed Audio 类，帧内件#37）时，才把带标注全文直喂该 TTS。

### 声音公式（写过程参数，禁情绪结果词）

不写「愤怒地说/悲伤的讲」这类情绪结果词——AI 不理解情绪，只理解结构。替换写法：

| 目标 | 过程参数 |
|---|---|
| 愤怒 | 音量提高+语速加快+句尾收紧 |
| 悲伤 | 音量下降+语速缓慢+气息变轻 |
| 冷静 | 语速稳定+语气平和+咬字清晰 |
| 压迫感 | 停顿+尾音下沉 |
| 轻松调侃 | 语速变化+含微笑感+短暂停顿 |
| 压抑愤怒 | 停顿+语气变冷+音量增加 |
| 担忧委屈 | 呼吸不稳定+语速变慢+声音降低 |

标点=节奏器：语速控制不靠提示词，靠标点——逗号减速/省略号停顿/感叹号爆发。

落点：写 `voiceStyle` 与两档语气描述时按上表替换情绪词。例：✗「愤怒地质问」→ ✓「音量提高、语速加快、句尾收紧，停顿与重音带出质问感」。

### 多句台词时间递进

一镜多句且情绪有弧线时，把台词按时间顺序逐句罗列，每句标注相对上一句的声音变化量，写清整体弧线（如 平静→递进→爆发→消解）。例：

【语速平稳，咬字清晰，音量中等】"你们跟了一路。"
【停顿0.4秒，音量略提，语速开始加快】"还真敢找过来。"
【音量最高，语速最快，句尾收紧】"现在，把东西交出来！"
【停顿1秒，音量落回低位，气息变轻，语速放缓】"……我不想说第二遍。"

递进只写变化量（略提/最高/落回），不每句重写全套参数；弧线走向服从剧情事实，不为起伏而起伏。
