# 第一章自动成片与固定角色音色口播：技术设计

## 1. Architecture boundary

本任务复用现有 Studio store、导演规划、分镜表、TTS、图片工作流、FFmpeg renderer 和真实 chapter-001 runner，不新建第二套媒体系统。

```text
导演分镜表
  -> 动态分镜解析
  -> voiceover plan / speaker identity
  -> 项目 tts.json fixed bindings
  -> real TTS + storyboard audioRef
  -> existing mediaRef + FFmpeg tracks
  -> final MP4 + evidence
```

产品一键路径与 CLI 实现可以分别位于 TypeScript 和 Python，但以下契约只有一个定义口径并由交叉测试约束：

- 动态分镜数量不变量
- 逐镜 voiceover 字段
- canonical speakerId
- fixed voice binding 读写与不可覆盖规则
- 最终媒体证据字段和失败条件

## 2. Source-of-truth contracts

### 2.1 Storyboard source

生产源为当前项目 `studio-workflow-store.json` 中目标 episode 最新的 `agentWorkData[key=storyboardTable]`。解析协议与 `apps/frontend/lib/studio/storyboard-table.ts` 一致，兼容 14 列旧表和 7 列分组表。

`CHAPTER_001_SHOTS` 只保留为当前《道劫》首次引导 fixture；只有项目没有任何导演分镜表时才能用于显式 bootstrap。真实 runner 一旦进入验收，必须报告实际 source kind、source work id 和动态 source segment count。

### 2.2 Voiceover item

```ts
interface StoryboardVoiceoverItem {
  storyboardId: string;
  index: number;
  speaker: string;
  speakerId: "narrator" | `character:${string}`;
  line: string;
  ttsSpokenText: string;
  durationTarget: number;
  voiceStyle: string;
  requiresFixedVoice: true;
}
```

已有 `角色：台词` 直接转成结构；无对白时由 voiceover planner 用镜头描述生成短旁白。planner 不写回小说正文，也不改变画面 prompt。

### 2.3 Canonical identity

- `旁白`、`VO`、`画外音`、`解说` -> `narrator`。
- 角色显示名先与目标 episode 的 `EntityExtractionResult.characters[].name` 精确匹配，再与明确 aliases 精确匹配。
- 命中一个角色 -> `character:{characterId}`；零命中或多命中 -> hard error。
- 资产库 role UUID 只能作为音频资产来源，不替代项目 characterId。

### 2.4 Project TTS state

把 Zustand TTS 持久化切换到 `createProjectScopedStorage("tts")`，磁盘文件为当前项目 `_p/{projectId}/tts.json`。沿用现有结构：

```json
{
  "state": {
    "activeProjectId": "project-id",
    "projects": {
      "project-id": {
        "voiceLines": {},
        "bindings": {
          "character:char-id": { "speakerId": "character:char-id", "profileId": "voice-profile-id" }
        }
      }
    },
    "voiceProfiles": {
      "voice-profile-id": {
        "referenceAudioPath": "/absolute/audio.wav"
      }
    }
  }
}
```

`fileStorage` 现有 legacy localStorage/IndexedDB 迁移能力继续负责首次读取；新增测试确保迁移后写入项目文件而非全局覆盖。

## 3. Fixed voice resolution

固定音色解析分两阶段，且不允许走回头路：

1. `fixed`：binding 和 profile 都存在，参考音频可读。直接使用并保留原 `profileId`、路径和时间戳。
2. `ai-selected`：仅对无 binding 的 speaker，从资产库音频中按身份、性别、年龄、气质、名称、描述和参考文本匹配，创建 profile + binding 后立即持久化。

以下状态直接失败，不进入重新选择：

- binding 存在但 profile 不存在
- profile 没有 `referenceAudioPath`
- 固定文件不存在或不可读
- speaker identity 无法唯一解析
- 旁白未绑定且没有可用旁白音频

TypeScript 的两处自动分配入口共用一个 planner，planner 返回 `fixed`、`created`、`errors`；调用方只为 `created` 写入 profile。Python runner 读取同一 `tts.json`，缺 binding 时使用同一字段口径补齐，已有 binding 绝不覆盖。

## 4. Product one-click orchestration

新增 `useChapterAutoVideoActions`，挂载到工作流画布工具栏，展示运行阶段、失败原因和最终路径。流程：

1. 锁定当前项目与第一章 episodeId，禁止执行中切换项目。
2. 复用现有导演计划；缺失时调用现有 director-plan action 并确认写回成功。
3. 复用/生成最新分镜表，按动态源片段替换该 episode 的 storyboards。
4. 生成并校验 voiceover plan，写回逐镜 voiceover 字段。
5. 执行 fixed voice planner，只补无 binding 的 speaker。
6. 复用已有合格 audioRef；缺失项使用现有本地 TTS runtime 逐镜生成并写回，禁止 mock/fallback。
7. 要求每镜存在可读 `mediaRef`；图片工作流缺失时停止并列出镜头，不伪造静态画面。
8. 调用现有 FFmpeg track render，选择成功候选，合并最终 MP4。
9. 写回 productionPlan、media task evidence 与最终路径，运行共享完成审计。

步骤 7 保持现有图片工作流边界：本任务不复制 `ImageWorkflowCanvas` 的图片生成实现；第一章自动成片负责从已完成分镜图开始完成口播和视频闭环。真实 CLI 仍可按当前 real-ai-reference-image-workflow 生成/复用分镜图。

## 5. CLI changes

`Library/build_daojie_chapter001_workflow.py`：

- 从最新 storyboardTable 解析动态 shots，并报告 source 证据。
- 生成逐镜 voiceover 字段与 canonical speakerId。
- 读取/补齐项目 `tts.json`，固定绑定存在时只读。
- 输出 `audioCount`、`voiceBindingFingerprint`、`fixedVoiceBindings`、`aiSelectedVoiceBindings` 和逐镜 voiceover manifest。

`apps/build/automate-daojie-chapter001-video.mjs`：

- 对每个 storyboard 校验 voiceover 字段、audioRef 和固定 profile。
- 校验 `speakerVoiceMap` 的 key 集合覆盖全部 canonical speakerId。
- 校验 `audioCount === storyboards`、`missingVoiceProfiles=[]`、无 mock/fallback/silent。
- 报告 source work id、binding fingerprint 与最终 MP4 证据。

## 6. Skill design

用 `skill-creator` 的 `init_skill.py` 在 `.agents/skills/` 初始化 `mystudio-voiceover-writer`。skill 保持单一 `SKILL.md` 为主，只包含：输入证据、逐镜输出契约、speaker 解析、旁白补齐、固定音色规则、画面文本禁令和验证清单；不附加 README 或无关资源。

## 7. Compatibility and migration

- 首次启动新版应用时，旧 `mystudio-tts-store` 通过现有 `fileStorage` fallback 读取；下一次持久化写入当前项目 `tts.json`。
- Python 首次运行若 `tts.json` 缺失，可从现有 storyboard 的 `voiceProfile` 字段导入固定绑定，再只为真正缺失者自动选择。
- 旧 storyboard 只有 `lines` 时由兼容转换补齐新字段；新写回必须包含完整契约。
- 不迁移或删除旧 localStorage/IndexedDB 数据，不执行破坏性清理。

## 8. Failure, rollback, and observability

- 自动运行每个阶段记录明确 state：planning、voiceover、binding、tts、render、merge、completed/failed。
- 失败保留已完成媒体与 binding；重试复用成功项，不重新选择固定音色。
- 修改生产项目数据前记录相关 JSON 路径、mtime 和 SHA-256；首次真实运行前备份即将写入的 `tts.json`（若存在）。
- 报告严格区分 unit/type/lint、desktop smoke、installed smoke、real generation。
