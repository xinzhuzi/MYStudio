# MiniMax-Music3 音乐生成技能资产(minimax/music)

本目录是本地歌曲生成的**完整技能资产包**:官方 music-caption-rewriter 技能全文库 + 08-19《道劫》片头曲四代迭代实证的问题集合与配方。来源:~/.agents/skills/music-caption-rewriter(vendor 全量,SKILL.md/references/templates 原文)+ 项目实证沉淀。

## 目录结构

| 路径 | 内容 |
|---|---|
| `SKILL.md` | 官方技能全文(原文 vendor):三段式 caption 规范/渐进式路由/参考卡选择/校验清单 |
| `references/` | genre-router.md 路由器 + 19 个风格族索引(渐进式披露第一二层) |
| `templates/` | **1000 张完整 caption 参考模板**(第三层,按索引卡片按需读取) |
| `lessons.md` | **问题集合**(必读):时长工程学三定律/风格锁铁律/间奏技巧/六工程坑 |
| `recipes/` | 实证配方(可直接参数化使用):`guofeng-yanyu-xingzhou.md`=《劫火燃天·终品》199.8s 一发命中配方 |
| `README.md` | 本文件 |

## 代码消费(运行时)

- 渲染层模块:`apps/frontend/lib/studio/music-caption.ts`
- 确定性路径(已接线):配方经 `?raw` 内联,`buildStructuredCaption()` 在生成前把一句话描述增强为结构化 caption(风格锁/意图注入/BGM 器乐主奏/校准表算器乐填充);调用点=工作台「音乐」面板(MusicTab)
- 代理路径(未来):应用内接 LLM 时,以本目录 SKILL.md+references+templates 为提示词与语料,按官方流程路由选卡合成——库已全量在包内,无需外部依赖

## 维护

- 新增配方:`recipes/` 加 md(含 {{BRIEF}}/{{INTERLUDE}}/{{OUTRO}} 占位,注释头会被 recipeBody() 剥离)+ music-caption.ts RECIPES 注册
- 升级技能库:从 ~/.agents/skills/music-caption-rewriter 整目录覆盖 SKILL.md/references/templates
