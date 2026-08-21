# musical-dna — 辅助分析音乐技能

参照曲风格 DNA 解构技能,与 `assets/minimax/music/`(caption 生成)互补:先用本技能把参照曲拆成
六维度技法描述(节奏根基/和声架构/乐器技法/制作美学/流派融合/能量架构),产出 prompt-ready 风格短语,
再喂给 music-caption-rewriter 锁定风格身份。核心原则「说怎么做,不说像谁」——描述技法特征而非点名艺术家,
天然规避风格锁里的艺术家名依赖。

- 来源:[jwynia/agent-skills](https://github.com/jwynia/agent-skills) `musical-dna`(MIT,作者 jwynia,437 installs)
- 收录:2026-08-20,原样入仓未改动;仓库代理侧副本在 `.agents/skills/musical-dna/`(skills CLI 安装,锁定见 `skills-lock.json`)
- 纯文本指令包:无外部 API、无运行时依赖、无模型权重
- 打包:`config/electron-builder.yml` 整树收录 `frontend/assets/minimax` → `minimax/`,本目录随 `**/*` 过滤器自动进包
- 消费路径:渲染层 `lib/studio/music-analysis.ts` 以 `?raw` 单源导入 SKILL.md 全文,嵌进
  AI 参照曲解析的系统消息(音乐面板「AI 解析参照曲」折叠区;本地实测特征 + 云端 LLM 六维度出风格 DNA)
