---
name: h3-prompt-writing
description: Write MiniMax H3 video generation prompts for T2VA, I2VA, FL2VA, L2VA, and Ref2VA (local ref2va weights deleted 2026-10-04 — Ref2VA not runnable locally for now, see LOCAL NOTE below), including fight and action choreography. Use when rewriting multimodal requests into H3 prompt structures, composing integrated_multimodal_description, overall_soundscape, and non_diegetic_music, aligning keyframes, or defining reference labels for images, videos, and audio. Also use when a hand-fed Chinese direct draft is needed for manual, non-API generation.
compatibility: Portable to any agent that can read local files — no external API calls, MiniMax Hub tools, or proprietary runtime required. The agents/openai.yaml file only adds optional ChatGPT/Codex UI metadata; it does not restrict the skill to OpenAI agents.
---

> **LOCAL NOTE (2026-10-04, this machine)**: 本地 ref2va 权重 2026-10-04 已删(详见 `../comfyui/machine.md`),
> Ref2VA 路径暂不可本地跑;本文提示词写法知识对云端渠道/未来恢复权重仍有效。

# H3 Prompt Writing

## Workflow

1. Identify the input mode: T2VA, I2VA, FL2VA, L2VA, or full-reference Ref2VA.
2. For base text/keyframe modes, read `references/base-en.txt` and follow its final prompt structure.
3. For full-reference mode, read `references/ref-en.txt` and follow its six-section rewrite format.
4. Preserve the exact field names, section order, labels, and timing notation from the selected guide.
5. For a hand-fed Chinese direct draft (manual web/client generation or a non-API quick draft), read `references/direct-zh.md` and follow its five-element order and anaphora blacklist. The official English structure from steps 2-4 stays the default and remains the pipeline source of truth.
6. Controlled marks and numbering — `<d>[Language] ...</d>` dialogue tags, `<scenetrans>`/`<cutoff>` cut-crossing marks, `(S1)`-style global speaker IDs, and retention enums (`fully_preserved`/`partially_preserved`/`attribute_transfer`/`weak_reference`; audio: `fully_copy`/`partially_copy`/`reference`/`weak_reference`) — are fixed vocabularies defined in `references/base-en.txt` (§4.4–4.5) and `references/ref-en.txt` (§4.1–4.2, §5.2); look them up there instead of improvising marks.
7. For fight or action shots (duels, chases, standoffs, stunts), read `references/action-en.txt` before writing the action passages, and apply its choreography rules on top of the guide selected in steps 2-5.

## Base Modes

- T2VA: build the full audiovisual timeline from text.
- I2VA: start from the first frame and develop forward from it.
- FL2VA: describe the continuous path between the first and last frames.
- L2VA: infer a plausible opening and converge to the supplied last frame.

Use `integrated_multimodal_description`, `overall_soundscape`, and `non_diegetic_music` in the order shown in `references/base-en.txt`.
Fight and action scenes follow the choreography rules in `references/action-en.txt` for their actions, camera, and sound.

## Full-Reference Mode

Ref2VA rewrites use `subject_definitions`, `summary`, `retention_analysis`, `detailed_description`, `overall_soundscape`, and `non_diegetic_music` in that order. Reference labels stay consistent across all sections.

Read `references/ref-en.txt` for label rules, retention analysis, and complete examples.

## Output Rules

- Write rewrite sections in English; preserve dialogue, lyrics, and visible scene text in their original language.
- Describe each shot by composition, subjects, environment, actions, camera, sound, and the exact point where referenced content appears.
- Avoid plot summaries, unresolved reference labels, and timing that does not match the requested duration.
- Every final prompt must stand alone without its surrounding context: never rely on words like "the previous shot", "continues", "same as above", "still", or "as before"; expand every physical state into a complete, self-contained description.

## Manying Pipeline Audio Policy (2026-10-11 division of labour)

When the app assembles the prompt (`apps/frontend/lib/assist/image-studio/h3-shot-prompt.ts`), the audio policy is derived per shot instead of hand-picked:

- **Policy:** `dialogueAudioPolicy(lines)` — at least one character line → `full`; narrator-only or no lines → `ambient` (sound bed, "lips stay closed"). Dispatch (`ComfyCanvasStudio`) injects it per shot.
- **Character/narrator split, one source:** `splitDialogueLines(lines)` — narrator = broad label set (旁白/vo/画外音/解说 via `chapter-voiceover.isNarratorSpeaker`) plus any colon-less whole line; everything else with a colon is a character line.
- **Character lines only under `full`:** the dialogue passage injects character `says` lines only; narrator lines go to the external TTS narrator track and never enter the H3 prompt (the off-screen voiceover phrasing is retired on this pipeline). The verbatim self-check gate's planned list = character-line texts only (see `docs/comfyui-kb/参考_文案逐字自检门.md`).
- **Voice-timbre anchor (D1):** a character line renders `says in a <voiceMood> tone:` with `voiceMood` passed straight from `storyboard.emotion` at dispatch; omit the phrase when the mood is empty. Hand-written prompts may use the same anchor for cross-shot voice consistency.
- **External narrator text:** TTS synthesis text for a shot = `externalNarratorSpokenText(lines, ttsSpokenText ?? "")` — mixed-line shots yield the normalized narrator body (pure-dialogue shots yield `""` and skip TTS entirely); non-`full` shots keep the full text unchanged.

## Segmented Long-Form Writing (AutoContext, 2026-10-25 调研)

> **状态:调研·未装** — 以下规则来自 GitHub `supElement/ComfyUI_MinimaxH3_AutoContext` 调研(README 全文归档于 `apps/output/bili_h3_unlimited_segments_1025/autocontext_README.md`),本仓未装该套件;**仅在分段长视频模式下适用**,单镜管线不涉及。产线侧完整落档见 `docs/comfyui-kb/分镜H3视频产线.md` §九.五。

- **帧数网格(分段仍守网格)**:H3 合法帧数恒落 17k+5 网格(5/22/39/56/73/90/107/**124**/141/158/175/192…),节点自动对齐。两层概念分开:网格**数学值**从 5 起;本仓训练区**实用值**下限=124(5–15s,见产线§二)。分段模式每一段仍须落在训练区网格上(README 默认段长 chunk_frames=90 帧=3.75s,低于本仓下限,本仓不跟随),总长靠多段拼接绕开 15s 封顶——以量补长,不是超训练区生成。
- **8s 核对例**:8s×24fps=192=17×11+5,恰好合法;任意秒数**直乘 fps 会踩非法值**(如 7s×24=168,168 mod 17=15 不在网格)——网格合法性与 fps 无关,fps 只用于音频同步/排轨换算。完整吸附档位表见产线§二与 `references/direct-zh.md` 帧数表。
- **铁律一·时序排他性**:段 N 提示词**禁止回叙段 N-1 已完成的动作**——上一段末尾是结果,下段只写结果之后的新动作;违反=指令冲突出鬼畜。
  - ✗ 段2开头:"She draws her sword and slashes the rider."(段1结尾剑已出鞘;回叙拔剑=让模型重演已完成的动作)
  - ✓ 段2开头:"Sword in hand, she lunges at the rider."(把结果当既定状态,只写新动作)
  - 与 Output Rules 的单镜自包含规则同族不同层:自包含管**段内**不依赖上下文代词,排他性管**段间**不复述已发生动作;两者叠加生效。
- **铁律二·逐段引用声明**:参考图/视频引用**无全局记忆**,每段提示词必须显式重写引用(标签+身份),漏写=角色不一致。
  - ✗ 段3只写:"The girl rides north."(未重挂引用,角色漂移)
  - ✓ 段3重写:"<Picture 1> the white-robed girl rides north."(引用随段重新声明,标签与身份描述照第一段重写)
- **显存经济学(为什么必须分段)**:H3 显存随时长指数增长,分段后峰值显存只取决于**单段**长度(量级数字见产线§九.五)——写法上每段按一条独立的 5–15s 提示词对待,不因总长改变单段规格。
- **语义桥警示**:AutoContext 生态的语义桥组件上游仅验证 FL2VA/文本路径,Ref2VA 参考路径实测**可能**劣化口型与演唱表现——数字人/口型场景禁开(本仓强化外推,细节见产线§九.五风险④)。

## Tips for Better Results
- Always match the total duration of the description to the requested video length (5–15 seconds; matches the trained range, see `docs/comfyui-kb/参数速查.md` H3 section and `references/direct-zh.md`). Frame counts always land on the 17k+5 grid (the workflow auto-snaps them; see `docs/comfyui-kb/分镜H3视频产线.md` §二).
- Keep reference labels consistent (e.g. `<Picture 1>`, `<Video 1>`, `<Audio 1>`) across every section.
- Prefer concrete visual and audio details over abstract words like "cinematic" or "beautiful".
- When using keyframes (I2VA / FL2VA / L2VA), clearly state how the first and/or last frame connects to the timeline.
