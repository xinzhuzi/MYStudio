# backups/ —— 项目备份统一目录

项目里**所有备份**都收拢在这里，按来源分类存放。

> **本文件由应用自动管理**：创建项目时写入，每次保存时做 md5 校验，
> 缺失或被改动都会自动用应用内置模板覆盖修复。请勿手改。

## 目录规划（固定分类）

| 子目录 | 来源 | 内容 |
|---|---|---|
| `continuity/` | 连续性锁定流程 | 章节视觉连续性圣经快照（`chapter-*-continuity-bible`） |
| `storyboard-flow/` | 分镜流迁移 | 分镜流整库快照（`storyboard-flow-flat-*`） |
| `visual-continuity/` | 分镜晋升管线（promote） | 晋升/人工审修关键手术前的整库快照（`storyboard-promotion-*` / `storyboard-human-review-*`，内含当时完整 studio-workflow store） |
| `store/` | store 手术脚本 | 工作流 store 的手术备份：分片化改名（`*.bak-sharded-*`）、TTS 再生（`*.bak-scoped-tts-*`）、语音回写（`*.bak-voice-*`）等 |
| `remotion/` | 渲染工作区 | 渲染侧文件级备份（章节 manifest 的 `*.bak-*` 等） |
| `video-use/` | video-use 审修 | 修订工件备份，按 `章节/修订` 保留原层级 |
| `legacy-pipeline/` | 旧试点管线归档 | 08-15 前旧 chapter_video 管线产物（如 `exports/` 整目录：分镜帧/配音/片段），当前工作流已不读写项目根 exports/，历史产物归档于此 |

## 说明

- 备份仅供追溯与回滚，**不参与应用运行**；确认稳定后可手动清理（建议保留最近一两份）。
- 历史项目中的旧位置（项目根 `visual-continuity-backups/`、散落在源目录旁的 `*.bak-*`）仍可被应用识别为备份；新备份一律写入本目录。
- 各备份内如有 `studio-workflow-store.json`，是当时的整库快照，可用文本编辑器直接查看。
