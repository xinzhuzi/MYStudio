# Skill sources

本目录下的 skill 来自第三方仓库,仅做本地知识层安装(未运行其安装脚本)。

| Skill | 来源 | 说明 |
|---|---|---|
| `comfyui` | [SlavaSexton/ComfyUI-Agent-Kit](https://github.com/SlavaSexton/ComfyUI-Agent-Kit) | 主手册:API 客户端、节点库、模型配方 |
| `krea` | 同上 | Krea / Krea 2 专项 |
| `minimax-h3` | 同上 | MiniMax H3 (Hailuo 3) 本地运行专项 |
| `h3-prompt-writing` | [MiniMax-AI/MiniMax-H3](https://github.com/MiniMax-AI/MiniMax-H3) `skills/` | **MiniMax 官方** H3 提示词规范:T2VA/I2VA/FL2VA/L2VA/Ref2VA 五模式 + 官方模板全文(references/base-en.txt, ref-en.txt) |
| `troubleshooting` | [artokun/comfyui-mcp](https://github.com/artokun/comfyui-mcp) `plugin/skills/` | 错误诊断手册:OOM/缺节点/dtype/黑图的模式→原因→修法;文档中的 `get_history`/`list_local_models` 等为 MCP 工具名(未装 MCP 本体),知识部分独立可读 |
| `debug-render` | 同上 | 渲染完成但结果不对(无报错)时的逐节点中间预览定位法;同上,工具名属 MCP 层 |
| `frontend-ui-engineering` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) `skills/` | 生产级 UI 工程技能(组件架构/WCAG 可访问性/响应式/反 AI 审美);93.7K★;commit `9d0c60d40`(2026-10-02,2026-10-03 同步),MIT |
| `modern-javascript-patterns` | [wshobson/agents](https://github.com/wshobson/agents) `skills/` | ES6+ 纯 JS 手艺(async/await/解构/迭代器/函数式模式),对口 manying.js 这类无构建裸 JS;39.6K★;commit `156b7a5e7`(2026-09-29,2026-10-03 同步),MIT |
| `qwen-image-2-1-prompter` | [iamyoki/qwen-image-2.1-skill](https://github.com/iamyoki/qwen-image-2.1-skill) `skills/` | Qwen-Image-2.1 提示词优化器:官方 PE 宪法的工程化封装(T2I 八步法/Edit 双语言决策与属性解缠/交互三段式 vs 严格 JSON 双模式/中文口语触发"帮我优化通义生图提示词");0★ 模型 09-20 才发布;09-22 push,Apache-2.0;**内容与官方 system_prompt.txt 逐条对账无冲突(09-23,真源=.trellis/tasks/09-23-qwen-image-21-research/research/)**;含离线校验脚本 scripts/validate_prompt.py(仅显式要求时执行) |
| `frontend-design` | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` | Anthropic 官方;10-03 核验最新 |
| `webapp-testing` | 同上 `skills/webapp-testing` | Anthropic 官方;10-03 核验最新 |
| `lsp-code-analysis` | [lsp-client/lsp-skill](https://github.com/lsp-client/lsp-skill) `skills/lsp-code-analysis` | MIT;scripts/update.sh 自指认上游;10-03 核验最新 |
| `lsp-setup` | [github/awesome-copilot](https://github.com/github/awesome-copilot) `skills/lsp-setup` | GitHub 官方 Copilot 技能库;10-03 核验最新 |
| `security-review` | 同上 `skills/security-review` | 10-03 核验最新 |
| `web-design-reviewer` | 同上 `skills/web-design-reviewer` | 仓内副本逐字节=上游(用户级同名件已消失,以此为准) |
| `react-vite-best-practices` | [AsyrafHussin/agent-skills](https://github.com/AsyrafHussin/agent-skills) `skills/react-vite-best-practices` | 10-03 同步(+metadata.json) |
| `vercel-react-best-practices` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) `skills/react-best-practices`(上游目录无 vercel- 前缀) | 10-03 同步(AGENTS.md) |
| `vercel-composition-patterns` | 同上 `skills/composition-patterns` | 10-03 核验最新(逐字节同) |
| `tdd` | [mattpocock/skills](https://github.com/mattpocock/skills) `skills/engineering/tdd` | 10-03 误删当日恢复+升最新(误归 superpowers 已纠) |
| `electron` | [full-stack-skills/electron-skills](https://github.com/full-stack-skills/electron-skills) `skills/electron` | 10-03 同步(SKILL.md) |
| `typescript-react-reviewer` | [dotneet/claude-code-marketplace](https://github.com/dotneet/claude-code-marketplace) `review-tool/skills/typescript-react-reviewer` | 10-03 核验最新(5/5 逐字节同) |
| `musical-dna` | [jwynia/agent-skills](https://github.com/jwynia/agent-skills) `skills/creative/music/musical-dna` | 10-03 核验最新(逐字节同) |
| `lyric-diagnostic` | 同上 `skills/creative/music/lyric-diagnostic` | 10-03 核验最新(6/6 逐字节同) |
| `remotion-*`(12件:best-practices/captions/create/docs/interactivity/maps/markup/multimedia/render/saas/studio/upgrade) | [remotion-dev/skills](https://github.com/remotion-dev/skills) `skills/remotion-*` | **Remotion 官方**;10-03 整族 4.0.508→4.0.532(195 文件) |
| `qwen-image-prompt-en` | [kjranyone/qwen-image-2.1-prompt-guide](https://github.com/kjranyone/qwen-image-2.1-prompt-guide) `skills/` | Qwen-Image-2.1 实操指南:核心规则(禁 SD 标签/主体前置/画内文字双引号逐字/编辑保留句)+ 分路由参考(text-to-image/image-editing/text-rendering/capabilities/examples);**独有价值=capabilities.md 的故障模式表**(文字乱码/主体错/脸漂移→改法);1★;09-21 push,MIT |

**本地自建**(非第三方,无上游):
- `comfyui/tools/find_orphan_nodes.py` — UI 格式工作流孤儿节点检测(从输出节点反向可达性判定;兼容 cg-use-everywhere 广播、SetGet、rgthree 组旁路器/查看器、UUID 子图节点;`--prune` 生成 .cleaned.json 不动原文件)。2026-09-04 经合成样例 + K2图像/、H3视频/ 真实工作流验证。
- `generated/` — GitNexus `analyze --skills` 自动生成的按域代码导航地图(**可再生的派生产物,勿手编**;`.gitignore`/`.zcodeignore` 刻意排除不进 git;目录两层深故不进 skill 发现路径,导航请直接用 GitNexus `query()`/`context()` 动态查询——静态地图会滞后,remotion 件内 08-21 刷新注记自证)。09-24 盘点 20 件在档。
- `daojie-charsheet-prompter/` — 本仓自建(道劫角色设定表提示词技能,2026-10-02 建;10-03 自 .zcode 游离真实目录归一真源+symlink);同类自建:`krea2edit-prompts/`(引用本仓 K2 工作流节点与 09-24 K2 退役注记)、`lyric-refiner|reviewer|sync-alignment|writer`(jwynia 无同名件,音乐链自建)、`mystudio-automation-testing|voiceover-writer|workflow-integrity-testing`(漫影域自建)。
- `trellis-*`(12件)— 本仓 Trellis 工作流资产(与 MA 双侧各自演化,勿当第三方同步)。
- `node-graph/` — 节点图与画布布局整合技能(地图+纪律+速查层):单源指路三真源(`.claude/knowledge/node-graph-architecture.md` / `docs/comfyui-kb/画布布局规范-0928.md` / comfyui 技能),布局策略章七块完整自含历次布局裁定系谱。**携带通用代码**(0928 三令,tools/ 两件):`workflow_layout.py`=comfyui 技能同名件归因副本(上游 SlavaSexton/ComfyUI-Agent-Kit,Apache-2.0;文件头归因块,块后与原件逐字节一致;上游更新时以 comfyui 技能原件为准重新拷贝);`layout_check.py`=0928 立宪口径通用布局检查器(本技能自有,无上游;数学逐式移植自生产生成器自查段,三件生产件对拍交叉基线逐值相等;`--selftest` 内嵌合成用例;零 IP 词)。自建 2026-09-28;来源=0928 画布布局立宪+0925 布局战役裁定+comfyui 技能布局工具与章节+思想借鉴 mckruz/comfyui-expert(MIT,意图解析→查清单→选模式→生成→验证流程骨架与八模式选型);三源调研与布局系谱存证 `.trellis/tasks/09-28-node-graph-skill/research/`。

- **Agent-Kit commit**: `74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d`(2026-08-20,**master 分支**——仓库默认分支是 master 非 main),Apache-2.0(仓库根 LICENSE/NOTICE,未随目录拷贝;本地使用无附加义务,引用内容请保留上游署名)
- **MiniMax-H3 commit**: `d21241f`(2026-08-15,main 分支),**MiniMax H3 Community License**(免版税可使用/复制/修改;地域排除欧盟/英/韩/美;商用门槛=年收入 2000 万美元;本地个人使用无附加义务)。官方明确支持以 skills CLI 安装本目录
- **安装方式**(2026-09-04):sparse/浅克隆后拷贝;`comfyui/machine.md` 已按本机改写(原模板被覆盖,上游更新不会自动合并)
- **安装方式**(2026-09-12,frontend-ui-engineering / modern-javascript-patterns):`npx skills add <owner/repo@skill> -y` 直装;更新走 `npx skills check` / `npx skills update`
- **安装方式**(2026-09-23,qwen-image-2-1-prompter / qwen-image-prompt-en):同上 `npx skills add` 直装(npx 自动落 `.agents/skills/` 真源,`.claude/skills/` 侧为同一份链接);挑拣依据=find-skills 三路搜索(skills.sh/GitHub code search/精选目录)后逐条与官方 PE 原文对账;云端 API 向的 qianwen-ai(96★)/qwencloud/alicloud 系**刻意未装**(与本地 ComfyUI 路线错位)
- **comfy-mcp commit**: `6aa136a`(2026-09-03,master 分支),MIT。**上游曾于 2026-09-09 归档,2026-10-03 复核勘误:已复活、未归档、默认分支 master→main、仍在维护**(两 skill 经剥离本机 LOCAL NOTE 注记后与上游 main 逐字节核验一致,零同步需求;未来若要 MCP 层可评估官方件)。**只装了知识型 skill,未装 MCP 服务器本体**(文档中引用的 `panel_run`/`get_history` 等工具需 MCP 层,装法:workspace `.zcode/config.json` 或 `.agents/mcp.json` 配 `mcpServers`,见 ZCode 配置指南)。troubleshooting / debug-render 两 skill 文档的最后上游改动(2026-08-25 unslop 文案修订)均已包含于本快照
- **superpowers 全家禁装(2026-10-03 用户令重申)**:obra/superpowers 的件(brainstorming / dispatching-parallel-agents / executing-plans / finishing-a-development-branch / receiving-code-review / requesting-code-review / systematic-debugging / verification-before-completion / writing-plans / writing-skills)——注:tdd 曾被误归本族删除,经字节级核验实为 mattpocock/skills 件,已于同日恢复+升级(见下表)用户已令全部清除,**任何会话不得再装入/同步/保留**;复发路径存案:dc242c1(08-11 批量迁入)与 e465aad(09-25 comfyui融合 整批刷入)均未经清理令执行即提交。备份仅存 /tmp/skillsync1003/superpowers-removed-backup(临时)。
- **刻意未装**: Agent-Kit 的 `seedance` skill、其 `install.sh`(会装 comfyui-mcp 服务/in-graph Claude 节点等)、官方 workflow_templates 模板库(machine.md 中有说明)、MiniMax 官方 8 个风格模板 skill(一次性模板,个人已有固定提示词风格)、krea-ai/skills 官方库(纯 Krea.ai 托管 API/MCP 向,本地 K2 线用不上)、comfyui-node-registry/model-compatibility(写插件向/SD-Flux 系兼容矩阵,不对口)
- **更新方式**: 重新浅克隆 → 对比同名目录 → 手动同步(保留本机 `comfyui/machine.md`)。**2026-09-24 全量核对**:8 个上游来源 skill 全部与上游最新一致(GitHub compare API 逐仓验),零同步需求;`npx skills check` 在本机卡网络不可用,核查走 API 直查;**2026-10-03 复审计+同步**:26 件可机检 11 件落后当日全同步(仓库侧 2 件钉已刷新;用户侧 5 件 wshobson+4 件 firecrawl 掉锁重入册 `~/.agents/.skill-lock.json`,锁档 subtree-sha 16/16 对齐);**同日盲区收口轮**(40 件无台账全溯源):22 件再同步、锁档扩至 41 条全对齐、find-skills 分叉重套上游六步流、用户级人类台账立 `~/.agents/skills/SOURCES.md`(机器真源=锁档)
