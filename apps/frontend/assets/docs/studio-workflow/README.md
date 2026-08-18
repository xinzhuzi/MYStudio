# studio-workflow/ —— 工作流数据分片目录

这是当前项目的**工作流主数据**：小说章节、剧本计划、分镜、生成任务等，
按「一章一文件夹」分片存放，每个 JSON 不超过 512KB。

> **本文件由应用自动管理**：创建项目时写入，每次保存时做 md5 校验，
> 缺失或被改动都会自动用应用内置模板覆盖修复。请勿手改。

## 怎么看这个目录

- **`manifest.json` 是唯一权威清单**——当前哪些文件有效，以它列出的为准。
- 文件名尾部的 8 位十六进制字符是**内容指纹**（版本标记）：每次保存内容
  变了文件名就变，旧文件在全部新文件写完、清单切换之前原样保留——保存
  中途断电时上一代完整数据仍在，这是数据不丢的关键机制。人不需要读它。
- 所有 JSON 都是格式化多行存储，可直接打开查看。

## 目录结构（固定布局）

本目录位于项目的 `store/` 下（应用状态统一收口；小说正文、导出成片等用户
内容在项目根的 novel/、exports/ 等目录，与这里互不相干）：

```
store/
├── _store-layout-v1.json         ← store 布局标记
├── script.json / tts.json / …    ← 其他域的单文件 store
└── studio-workflow/              ← 本目录（工作流主数据，分片）
    ├── manifest.json             ← 有效文件清单（唯一权威）
    ├── README.md                 ← 本说明（应用自动维护）
    ├── core-*.json               ← 全局配置与小数据
    ├── materials-*.json          ← 项目素材索引
    ├── assets-versions-*.json    ← 连续性资产版本
    ├── agent-runs-*.json         ← Agent 运行记录
    ├── <域>-shared-*.json        ← 无法归入具体章节的数据
    └── chapters/
        └── <章节ID>/             ← 每章一个文件夹
            ├── novel-chapters-*.json
            ├── storyboards-*.json
            └── ...
```

## 文件与工作流阶段对照

| 文件（模式） | 工作流阶段 | 内容说明 |
|---|---|---|
| `chapters/<章>/novel-chapters-*.json` | 小说导入 | 章节正文与事件摘要 |
| `chapters/<章>/entity-extractions-*.json` | 小说导入 | 实体提取结果（人物/地点/物品） |
| `chapters/<章>/script-plans-*.json` | 剧本生产 | 剧本计划（场次与情节结构） |
| `chapters/<章>/agent-work-data-*.json` | 剧本生产 | AI 阶段产物留档（事件分析/故事骨架/改编策略） |
| `assets-versions-*.json` | 剧本资产管理 | 连续性资产版本（角色/场景/道具基准图与审批链） |
| `chapters/<章>/storyboards-*.json` | 分镜视频生成 | 分镜表（逐镜提示词/音频绑定/审查状态） |
| `chapters/<章>/media-tasks-*.json` | 分镜视频生成 | 生图/TTS/视频任务台账 |
| `chapters/<章>/image-workflows-*.json` | 图像节点图 | 图像生成工作流（分镜图/资产图） |
| `chapters/<章>/video-candidates-*.json` | 视频工作台 | 候选视频记录 |
| `chapters/<章>/production-tracks-*.json` | 视频工作台 | 制片轨道（章节成片进度） |
| `materials-*.json` | 素材库 | 导入素材索引 |
| `agent-runs-*.json` | 全局 | Agent 运行记录 |
| `core-*.json` | 全局配置 | 原著圣经/系列设定/事件图/记忆/工作流配置等小域合并 |
| `*-shared-*.json` | （视所属域） | 无法归入具体章节的条目 |

## 其他说明

- 同一域切多个文件时按 `-001 / -002 / -003` 顺序编号，合并时按清单顺序还原。
- 旧布局（store/ 出现之前，分片目录与各域 json 平铺在项目根）照常可读，
  下一次保存时自动迁移为新布局；`studio-workflow-store.json.bak-sharded-*`
  是分片化之前旧单文件的改名备份，仅供追溯，可手动清理。
- 目录结构升级是自动的：旧布局照常可读，下一次保存时自动迁移为新布局。
