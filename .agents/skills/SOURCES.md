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
| `frontend-ui-engineering` | [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) `skills/` | 生产级 UI 工程技能(组件架构/WCAG 可访问性/响应式/反 AI 审美);93.7K★;commit `be4e44a9f`(2026-09-12),MIT |
| `modern-javascript-patterns` | [wshobson/agents](https://github.com/wshobson/agents) `skills/` | ES6+ 纯 JS 手艺(async/await/解构/迭代器/函数式模式),对口 manying.js 这类无构建裸 JS;39.6K★;commit `a30778f8c`(2026-09-01),MIT |
| `qwen-image-2-1-prompter` | [iamyoki/qwen-image-2.1-skill](https://github.com/iamyoki/qwen-image-2.1-skill) `skills/` | Qwen-Image-2.1 提示词优化器:官方 PE 宪法的工程化封装(T2I 八步法/Edit 双语言决策与属性解缠/交互三段式 vs 严格 JSON 双模式/中文口语触发"帮我优化通义生图提示词");0★ 模型 09-20 才发布;09-22 push,Apache-2.0;**内容与官方 system_prompt.txt 逐条对账无冲突(09-23,真源=.trellis/tasks/09-23-qwen-image-21-research/research/)**;含离线校验脚本 scripts/validate_prompt.py(仅显式要求时执行) |
| `qwen-image-prompt-en` | [kjranyone/qwen-image-2.1-prompt-guide](https://github.com/kjranyone/qwen-image-2.1-prompt-guide) `skills/` | Qwen-Image-2.1 实操指南:核心规则(禁 SD 标签/主体前置/画内文字双引号逐字/编辑保留句)+ 分路由参考(text-to-image/image-editing/text-rendering/capabilities/examples);**独有价值=capabilities.md 的故障模式表**(文字乱码/主体错/脸漂移→改法);1★;09-21 push,MIT |

**本地自建**(非第三方,无上游):
- `comfyui/tools/find_orphan_nodes.py` — UI 格式工作流孤儿节点检测(从输出节点反向可达性判定;兼容 cg-use-everywhere 广播、SetGet、rgthree 组旁路器/查看器、UUID 子图节点;`--prune` 生成 .cleaned.json 不动原文件)。2026-09-04 经合成样例 + K2图像/、H3视频/ 真实工作流验证。

- **Agent-Kit commit**: `74f5b0bbd87b1c4ca0cd95dea169cdcae4b9af9d`(2026-08-20,main 分支),Apache-2.0(仓库根 LICENSE/NOTICE,未随目录拷贝;本地使用无附加义务,引用内容请保留上游署名)
- **MiniMax-H3 commit**: `d21241f`(2026-08-15,main 分支),**MiniMax H3 Community License**(免版税可使用/复制/修改;地域排除欧盟/英/韩/美;商用门槛=年收入 2000 万美元;本地个人使用无附加义务)。官方明确支持以 skills CLI 安装本目录
- **安装方式**(2026-09-04):sparse/浅克隆后拷贝;`comfyui/machine.md` 已按本机改写(原模板被覆盖,上游更新不会自动合并)
- **安装方式**(2026-09-12,frontend-ui-engineering / modern-javascript-patterns):`npx skills add <owner/repo@skill> -y` 直装;更新走 `npx skills check` / `npx skills update`
- **安装方式**(2026-09-23,qwen-image-2-1-prompter / qwen-image-prompt-en):同上 `npx skills add` 直装(npx 自动落 `.agents/skills/` 真源,`.claude/skills/` 侧为同一份链接);挑拣依据=find-skills 三路搜索(skills.sh/GitHub code search/精选目录)后逐条与官方 PE 原文对账;云端 API 向的 qianwen-ai(96★)/qwencloud/alicloud 系**刻意未装**(与本地 ComfyUI 路线错位)
- **comfy-mcp commit**: `6aa136a`(main 分支),MIT。**只装了知识型 skill,未装 MCP 服务器本体**(文档中引用的 `panel_run`/`get_history` 等工具需 MCP 层,装法:workspace `.zcode/config.json` 或 `.agents/mcp.json` 配 `mcpServers`,见 ZCode 配置指南)
- **刻意未装**: Agent-Kit 的 `seedance` skill、其 `install.sh`(会装 comfyui-mcp 服务/in-graph Claude 节点等)、官方 workflow_templates 模板库(machine.md 中有说明)、MiniMax 官方 8 个风格模板 skill(一次性模板,个人已有固定提示词风格)、krea-ai/skills 官方库(纯 Krea.ai 托管 API/MCP 向,本地 K2 线用不上)、comfyui-node-registry/model-compatibility(写插件向/SD-Flux 系兼容矩阵,不对口)
- **更新方式**: 重新浅克隆 → 对比同名目录 → 手动同步(保留本机 `comfyui/machine.md`)
