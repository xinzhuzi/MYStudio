# 第一章自动成片与固定角色音色口播：实施计划

## Execution rules

- Active task: `07-10-mystudio-chapter001-auto-video-fixed-voiceover`。
- Codex inline 模式：主线程直接实施和检查；不派 implement/check 子代理，不要求 JSONL context gate。
- 每批只完成一个可复验目标，修改后立即回读并跑 focused tests。
- 禁止 git/worktree、删除、清空、强制覆盖和自动归档。
- 真实项目写回前先记录/备份目标 JSON；不修改小说正文。

## Batch 1: Project skill

1. 用 `skill-creator/scripts/init_skill.py` 在 `.agents/skills/` 初始化 `mystudio-voiceover-writer`。
2. 只保留必要的 `SKILL.md` 与生成的 skill metadata；不创建 README/示例垃圾文件。
3. 写入 voiceover input/output、旁白补齐、canonical speaker、fixed voice、禁止字幕/正文修改和 final gate。
4. 运行 `skill-creator/scripts/quick_validate.py` 与项目 `skill-files` focused test。

## Batch 2: Shared voiceover and speaker contract

1. 在 `apps/frontend/lib/studio/` 新增最小共享 voiceover contract/validator。
2. 扩展 `storyboard-table.ts`：从目标 episode 的实体 name/aliases 精确解析 canonical speakerId；歧义/缺失返回结构化错误。
3. `toStoryboardItems` 写入 `speaker`、`line`、`ttsSpokenText`、`durationTarget`、`voiceStyle`、`requiresFixedVoice`。
4. 补 2 镜动态表、旁白、角色 ID、未知/冲突 alias、空口播测试。

Focused validation:

```bash
cd apps
npm test -- frontend/lib/studio/storyboard-table.test.ts frontend/lib/studio/chapter-voiceover.test.ts
npm run typecheck
```

## Batch 3: Project-scoped fixed voice state

1. 将 `tts-store` 持久化接入 `createProjectScopedStorage("tts")`，保留无持久化测试模式和 legacy fallback。
2. 扩展 fixed binding planner：已绑定只读、只为 unassigned 选择、missing-profile/missing-audio hard error。
3. 两处 UI 自动分配入口调用共享 planner；项目工作流使用 entity characterId，不再用资产库 UUID 作为 canonical speakerId。
4. 增加旁白固定 profile 选择和覆盖全部 voiceover speakers 的校验。

Focused validation:

```bash
cd apps
npm test -- frontend/stores/tts-store.test.ts frontend/components/panels/assets/role-audio-auto-assign.test.ts frontend/components/panels/studio/workflow-stage-actions.test.tsx
npm run typecheck
```

## Batch 4: Dynamic Python runner and CLI gates

1. 给 `build_daojie_chapter001_workflow.py` 增加 storyboardTable parser，并优先使用项目最新源 work；fixture 只作显式 bootstrap。
2. 增加 Python canonical speaker resolver 与 voiceover manifest。
3. 读取/导入/写入项目 `tts.json`；固定 binding 不变，缺失者只创建一次。
4. Storyboard 写回新增完整 voiceover 字段；speakerVoiceMap 以 canonical speakerId 为 key。
5. Node wrapper 增加 source、逐镜、音频计数、map 覆盖和 binding fingerprint 门禁。
6. 扩展 `build-scripts.test.ts` 的 Python probes，证明 2 镜/43 镜动态计数、固定 binding 重跑和缺失文件失败。

Focused validation:

```bash
python3 -m py_compile Library/build_daojie_chapter001_workflow.py
cd apps
node --check build/automate-daojie-chapter001-video.mjs
npm test -- frontend/config/build-scripts.test.ts
```

## Batch 5: Product one-click path

1. 抽取可组合的本地 TTS 单镜 runner 与 FFmpeg track/final merge runner，现有手动按钮继续复用。
2. 新增 `useChapterAutoVideoActions`，按 design 的九步流程执行/复用第一章数据并记录状态。
3. 工作流画布工具栏新增“一键第一章成片”按钮、进行中状态、失败摘要和最终路径入口。
4. 一键路径在缺失分镜图、binding、真实 TTS 或输出证据时明确失败，不制造 smoke 成功。
5. 添加 hook/component 集成测试，证明调用顺序、fixed binding 不覆盖、失败停止和最终写回。

Focused validation:

```bash
cd apps
npm test -- frontend/components/panels/studio/chapter-auto-video.test.tsx frontend/components/panels/studio/workflow-stage-actions.test.tsx frontend/lib/studio/workflow-readiness.test.ts
npm run typecheck
```

## Batch 6: Full quality gate

```bash
cd apps
npm run typecheck
npm run lint
npm test
npm run build:mac
npm run smoke:desktop
npm run smoke:installed
```

每条命令必须单独记录退出码与当前时间；失败立即修复并重跑该层，不能用后续层掩盖。

## Batch 7: Real two-run acceptance

1. 记录当前 `studio-workflow-store.json`、`script.json`、`tts.json`（若有）路径、mtime、SHA-256；对将被修改的已有 `tts.json` 创建时间戳备份。
2. 第一次运行 `cd apps && npm run video:daojie:chapter001`，等待进程真实退出。
3. 保存第一轮 `speakerVoiceMap`、`voiceBindingFingerprint`、逐镜 voiceover/audio 和最终 MP4 证据摘要。
4. 第二次运行同一命令；比较全部 canonical speaker 的 `profileId` 与参考音频路径完全不变，且第二轮均为 fixed。
5. 运行 `npm run smoke:workflow:run:daojie`，确认真实项目 UI 路径仍完整。
6. 按 PRD AC1-AC10 逐项审计；证据不全则继续修复，不做闭合结论。

## Risky files and rollback points

- `apps/frontend/stores/tts-store.ts`: persistence migration；必须保留 legacy test，禁止删除旧存储。
- `apps/frontend/lib/studio/storyboard-table.ts`: data contract；必须覆盖旧 14 列和新 7 列格式。
- `Library/build_daojie_chapter001_workflow.py`: 真实生产数据写回；每个新增函数先用临时 fixture probe，不直接以生产项目试错。
- `apps/build/automate-daojie-chapter001-video.mjs`: final gate；门禁只能收紧且必须有失败 probe。
- UI orchestrator: 只复用现有 store/renderer/TTS 接口，不复制媒体实现。

## Phase 3 boundary

完成后运行 `trellis-check` 与 `trellis-update-spec` 判断；由于项目 no-git，跳过 Trellis 默认 commit。只向用户给 human-review 摘要，不自动 archive/record session。

## Current verification status (2026-07-14)

- Batch 1-5 已由 focused gate 复验：skill validation 通过，8 个相关测试文件共 136 个测试通过。
- Batch 6 已完成：typecheck、lint、全量 114 文件 / 672 测试、`build:mac`、packaged smoke、installed smoke 均通过。
- Batch 7 已完成：复用现有 43 张真实分镜图，连续两次运行当前代码的 `npm run video:daojie:chapter001` 均成功，未重新请求分镜图片。
- 两轮 12 个 canonical speaker 的 `profileId`、参考音频路径、resolved 路径及 binding fingerprint 完全一致；第二轮全部 `match=fixed`，无 AI-selected binding。
- AC10 机器断言通过：43 镜等于 43 源片段、43 份完整口播、43 份真实音频、local qwen-mlx TTS、无 mock/fallback、音视频流完整、172.291016 秒、SHA-256 存在。
- 用户提供的临时服务已用 `agnes-image-2.1-flash` 通过模型列表和单图兼容测试；密钥与 provider 配置未持久化。
- AC1-AC10 已齐全，下一步进入 Phase 3 spec 判断和 human review；按 no-git 规则不执行 commit，归档只走 `--no-commit`。
