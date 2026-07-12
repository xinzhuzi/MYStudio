# 第一章自动成片与固定角色音色口播

## Goal

把 MYStudio 第一章制作推进为可重复执行的真实自动成片闭环：分镜数量由当前导演分镜表源片段决定，每镜都有明确口播与 speaker，每个 speaker 使用项目内持久化的固定音色，产品一键路径与 CLI 使用同一组生产契约并输出可核验证据。

## Background and confirmed facts

- 任务依据为 `docs/计划/第一章自动成片与多角色口播Trellis计划.md`；其中的默认 Grill 答案均视为已批准产品决策。
- 当前真实生成已能输出 43 镜、真实 qwen-mlx TTS 和最终 MP4，但这只证明既有 fixture 链通过，不证明本任务要求已完成。
- `Library/build_daojie_chapter001_workflow.py:1293` 仍以静态 `CHAPTER_001_SHOTS` 作为分镜规格，`source_segment_units()` 与 `build_shots_from_script()` 都回读该静态规格（`:1369-1370`、`:1425-1426`），尚未由项目中的导演分镜表决定数量。
- `apps/frontend/components/panels/assets/role-audio-auto-assign.ts:169-243` 会对传入的全部角色重新选音频；`StudioAssetLibrary.tsx:311-318` 与 `useScriptAssetGenerationActions.ts:240-247` 都会新建 profile 并重新 bind，尚未保护已有固定 binding。
- `apps/frontend/stores/tts-store.ts:357-363` 仍把 TTS 状态保存在 `mystudio-tts-store` 浏览器存储，真实 CLI 无法从项目目录读取该 binding。
- 当前 CLI 已检查音色文件、`missingVoiceProfiles`、真实 TTS、最终音视频流和 SHA-256；仍缺逐镜口播契约、speaker 全覆盖、固定 binding 重跑不变和真实音频数量等门禁。

## Requirements

### R1. Dynamic storyboard source

- 第一章生成必须读取项目当前最新的导演分镜表源片段；fixture 中的 43 只允许作为当前数据事实和首次引导数据，不得作为 runner、UI 或测试中的固定生产规则。
- 生产不变量为 `storyboards > 0`、`storyboardSourceSegments > 0`、`storyboards === storyboardSourceSegments`。

### R2. Voiceover plan contract

- 新增项目级 skill `.agents/skills/mystudio-voiceover-writer/SKILL.md`，负责指导生成与校验逐镜口播。
- 每镜必须具有非空 `speaker`、`line`、`ttsSpokenText`、正数 `durationTarget`、非空 `voiceStyle` 和 `requiresFixedVoice=true`。
- 无对白镜头必须生成短旁白；口播只服务 TTS/成片，不修改小说正文，也不得要求画面生成字幕、水印、标题卡或 UI 文本。

### R3. Canonical speaker identity

- 旁白统一使用 `speakerId=narrator`。
- 角色必须通过项目实体的 `characterId` 或明确 alias 解析为 `speakerId=character:{characterId}`；不得按模糊文本猜测或把角色显示名当稳定 ID。
- 无法唯一解析的角色必须阻断成片并报告具体镜头、speaker 和原因。

### R4. Fixed voice binding

- TTS profiles 与项目 bindings 必须持久化到当前项目目录，并可同时被产品运行时与真实 CLI 读取。
- 已有 binding 只能复用：不得由 AI、本地规则或重跑覆盖。
- 未绑定 speaker 才允许从资产库音频中自动匹配；首次成功后立即写入固定 binding，报告 `match=ai-selected`，后续报告 `match=fixed`。
- 旁白也必须有独立固定音色；不得借用角色或以旁白替代角色。
- binding 指向的 profile、参考音频或参考文本缺失时必须失败；不得静默改绑。

### R5. Product one-click path

- 工作流产品界面提供“一键第一章成片”入口和运行状态。
- 主路径依序完成或复用：导演计划、动态分镜、逐镜口播、缺失音色绑定、真实 TTS、分镜媒体、轨道候选、最终 MP4 与项目写回。
- 产品入口与 CLI 必须调用同一套逐镜口播、speaker identity、fixed voice 和最终证据契约，不能维护两套相互漂移的判断。

### R6. Final media policy

- 最终片禁止 mock TTS、`fallback-system-voice` 和 `silent-visual-preview`。
- 任一固定音色不可读、任一镜头缺口播/音频、任一 speaker 无 binding 时均阻断最终导出。
- 最终 MP4 必须包含音视频流、时长不超过 180 秒并记录 SHA-256。

### R7. Verification layers

- 报告必须分别列出单元/类型检查、桌面与安装 smoke、真实 chapter-001 媒体生成，不得用前一层替代后一层。
- 真实验收必须核对逐镜字段、speakerVoiceMap 全覆盖、`audio_count === storyboards`、binding 重跑不变与最终 MP4 证据。

### R8. Safety and data boundary

- 默认不启用 NoizAI 或其他云端 TTS，不上传小说文本或参考音频。
- 不执行 git/worktree，不删除生产资料，不自动归档 Trellis task。
- 不把《道劫》正文或 fixture 内容打包进 MYStudio 应用；项目数据继续存放在项目目录。

## Acceptance Criteria

- [ ] AC1: 用 2 镜和 43 镜两个源分镜表 fixture 证明生成数量随源片段变化，且无生产代码固定判断 43。
- [ ] AC2: `mystudio-voiceover-writer` 通过 skill frontmatter/结构验证，并明确 R2/R6/R8 的边界。
- [ ] AC3: 单元测试证明已绑定角色重跑 profile/path 不变，未绑定角色只创建一次 binding，缺 profile/文件时失败且不改绑。
- [ ] AC4: 单元测试证明旁白和角色 speakerId 均按 R3 解析，未知或冲突 alias 被阻断。
- [ ] AC5: 单元/集成测试证明每镜口播契约完整，`speakerVoiceMap` 覆盖所有 speaker，真实音频数等于分镜数。
- [ ] AC6: 产品界面存在可执行的一键入口；运行状态、失败原因和最终 MP4 路径可见，且调用共享生产契约。
- [ ] AC7: `cd apps && npm run typecheck && npm run lint && npm test` 全部通过。
- [ ] AC8: `cd apps && npm run build:mac && npm run smoke:desktop && npm run smoke:installed` 全部通过。
- [ ] AC9: 连续两次真实 `npm run video:daojie:chapter001` 均成功，第二次所有固定 `profileId`/参考音频路径与第一次一致。
- [ ] AC10: 最终报告满足动态分镜等式、逐镜口播/音频、`ttsMocked=false`、禁止 fallback、时长上限和 `finalVideoEvidence.sha256`。

## Out of scope

- 不默认接入 NoizAI/HeyGen 云端服务。
- 不修改小说正文，不给画面烧录字幕。
- 不扩展到第二章或其他项目的内容 fixture；共享契约本身保持可复用。
