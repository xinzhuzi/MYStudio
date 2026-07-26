# 漫影工作室 · MYStudio

本地优先的 AI 漫剧 / 短剧 / 小说影视化创作桌面工作台 —— 从小说到成片。

- **类型**:Electron 桌面应用(AI 漫剧/短剧制作工作台)
- **技术栈**:Electron + React 18 + TypeScript + Zustand + Tailwind v4 + electron-vite/Vite + Vercel AI SDK(多 provider:anthropic/openai/google/deepseek/xai/qwen/zhipu/minimax)+ 本地 FFmpeg + Python TTS sidecar(`tts`)
- **主代码**:`apps/frontend`(renderer:`components/` `stores/` `lib/` `hooks/` `types/` + electron:`main/main.ts`/`preload/preload.ts`/`ipc/`/`rendering/timeline-ffmpeg-command.ts`)、`apps/backend`(Python TTS)、`apps/build`(构建执行器:`daojie/` `timeline/` `smoke/` `packaging/`)
- **关键约定**:**没有根 `package.json`**,所有 npm 命令从 `apps/` 执行(`cd apps && npm run dev`)。`apps/out/` `apps/release/` `apps/output/` 是构建产物,禁止 import。
- **注意**:不要在根目录随意新增文件夹和文件
- **必须**:渐进式,分段式,少量,多次输出,每次编辑/写入只改一点,逐次完毕

## Trellis 开放任务列表(用户问「还有什么任务」)

用户问「还有什么任务 / Trellis 任务 / 还剩什么 / 任务列表」时:

```bash
python3 ./.trellis/scripts/open_task_board.py
```

- 只列未完成 + 有歧义(内容齐但未归档、暂缓归档等)
- 不列已归档、无需再做、统计债
- 原样贴脚本输出,不自造简表
- 规范:`.trellis/spec/guides/trellis-open-task-board-guide.md`

## Trellis 任务入口

详细 Trellis 流程:[`.trellis/workflow.md`](../.trellis/workflow.md)。它是任务生命周期、阶段门禁、状态路由和运行模式(Channel-Driven Sub-Agent Dispatch)的唯一权威来源;本节只保留 MYStudio 项目级入口与不可省略的约束。

- 重要、复杂、长线、多步骤、跨系统、批量治理、工作流/规则/提示词改造,或需持续验证与收口的任务,进入 Trellis;用户明确要求使用 Trellis 时同样必须进入。简单且边界清楚的一次性问答或只读查询可不建 task。
- 任务入口脚本:`python3 ./.trellis/scripts/task.py`(子命令:`create` / `start` / `current` / `finish` / `archive` / `list` 等)。
- **MYStudio 默认允许 git commit**(workflow Phase 3.4 为 required commit 步骤,但禁 amend/push);实际项目按 per-task 惯例常走 no-git/no-worktree。无论哪种,**所有 git 操作(commit/push/branch/删除)必须先获用户明确同意**(见全局铁律与下方「禁止破坏性操作」)。
- 开始前先读 `.trellis/workflow.md`、当前 task、适用 spec/index 与目标文件;Phase 1/2/3 的详细步骤以该工作流为准。

### 需求理解与澄清(Trellis 任务必加载)

- 先评估真实目标、使用场景、关键要求和最终验收标准;能从仓库、文档或现有任务核验的事实必须先核验。
- 只有关键不确定性会影响最终结果时,才一次询问一个最能消除不确定性的问题;必要时给出 2–4 个选项,并依据回答继续收敛。不得重复提问或为追问而追问。
- 需求已经清楚时直接推进;进入实施或给出最终方案前,简要复述理解,确认不存在关键偏差后交付可直接执行的结果。

## 铁律0(最高优先级):先充分了解信息,验证所有假设,再动手

**任何「写代码 / 改文件 / 审查 / 生成 / 修复」动作开始前,必须先把相关信息全部查清、把所有假设逐一验证。信息不全、假设未证实,绝对禁止动手。**

### 动手前必须先验证的(开发类任务)
1. **运行时约束** — 先写最小探针测(模块能否 import?electron-vite 配置是否生效?vitest 能否跑?)。**绝不假设能力存在**。
2. **接口/参数** — 要调的 CLI/函数,先 `--help` 或读源码确认,**绝不猜参数**。
3. **依赖完整性** — 在最小范围确认要用的模块/文件;**绝不假设依赖齐全**。
4. **数据结构** — 要解析的 JSON/字段,先 dump 真实样本确认字段名,**绝不猜字段**。
5. **环境** — 要用的服务(Python TTS sidecar `127.0.0.1:17593`、FFmpeg)先探测,不可用要有兜底。
6. **路径** — 特殊路径先用 `fd` 定位;`find` 仅用于已知路径的字节精确核验,**绝不手敲拼接**(`apps/out/` ≠ `apps/output/` ≠ `apps/release/` 等坑)。

### 执行纪律
接到任务先**列出所有假设和未知 → 逐一用最小探针/只读命令验证 → 全部确认后才写第一行**。出现「我以为/应该是/大概」立即停下查证。

- 以动手实践为荣,以只看不练为耻
- 以打印日志为荣,以单步跟踪为耻
- 以单元测试为荣,以手工测试为耻
- 以代码重用为荣,以复制粘贴为耻
- 以读源码/读文件为荣,以猜测臆断为耻
- 以渐进分段为荣,以一次性巨量操作为耻
- 以最小改动为荣,以顺手重构越界为耻
- 以复用现有接口为荣,以重复造轮子为耻
- 以遵守范围边界为荣,以牵连越界修改为耻
- 以诚实求证为荣,以编造业务为耻
- 以保留可追溯脚本为荣,以破坏性删除为耻

---

### 下结论

**在证据充分之前,禁止下闭合式结论(「已修/没问题/不存在」)。拿到第一个支持性证据就停 = 返工。正确姿态:先找「哪里可能错」,再下「没问题」的判断。**

- 声称「已完成/没问题/不存在」前,必过三关:
  1. **回原位核实,不信二手坐标** — 清单/issue/注释的文件名行号可能笔误或过时;「没找到」≠「不存在」,必须全树搜同类标识符(不同文件、不同命名)确认。
  2. **行为改动必须全量核验** — 不用采样代表全局;关键数字二次复跑(不同脚本/范围交叉验证)。
  3. **证据不全时回答带不确定性** — ✅「我查了 X,但还没核验 Y」;❌「已修/没问题」(除非过了上两关)。
- 下结论前自检三问:
  1. 我是只在指定位置查过,还是全树/全量查过?
  2. 我有没有主动找「能推翻我结论」的证据(反例、边界、更大范围)?
  3. 如果现在说「没问题」,最可能在哪里被打脸?—— 去查那个地方。

---

## 铁律1:渐进式,分段式,发送、读、写、修改、接收,每次不要太多内容,每分钟不要超过 60 次请求频率

**发送**(长内容分段):
- 长内容(>200 行)使用 Bash heredoc,避免工具参数被截断
- 示例:`cat > file << 'EOF' ... EOF`
- 避免在工具调用前写过多文字,防止响应被中断

**读取**(分段,总结):
- 先了解文件夹关系、文件映射关系,再了解文件内容,而不是一次性全部读取
- 大文件先用 `Read` 工具分段读取(每次 200–300 行)
- 每段读取后立即总结关键信息,根据总结决定是否需要读取更多

**写入**(Write 工具要求先 Read 才能使用):
- 新建文件 → 用 Bash heredoc
- 覆写已有文件 → 先 Read 该文件,再 Write
- 局部修改 → 直接用 Edit 工具(不受 Read 限制)
- 大内容(>300 行)分多次 Edit,每次修改后验证再继续

**修改**:
- 优先使用 Edit 工具精确替换
- 大范围修改时分段进行,每段验证后再继续

**接收**:
- 工具返回结果过长时,关注关键信息
- 必要时请求用户确认理解是否正确

## 大量内容处理铁律(防止上下文爆炸)

- 先读摘要/结构,按需读取具体段落;如果必须读取所有内容,采用子代理读取、返回摘要的模式。当需要处理大量文本(>1 万字)的读取/转换/插入时,**必须用 Python/Node 脚本在本地处理,禁止通过 AI 上下文传递大文本**。**脚本统一放在 `apps/build/scripts/` 下,不需要删除。**

| 场景 | 错误做法 | 正确做法 |
|------|---------|---------|
| 批量数据插入 | 通过工具参数逐条传递 | 写脚本从源文件提取 → 写入目标文件 |
| 大文件格式转换 | Read 全文 → 在 AI 中处理 → Write | 脚本直接在磁盘上读写处理 |
| 跨文件数据汇总 | 逐个 Read → AI 汇总 → Write | 脚本批量读取 → 处理 → 写入 |
| 子代理返回大量结果 | 让子代理将结果返回主上下文 | 写入已授权的 task `research/`,只返回摘要和出处 |

**核心原则**:AI 上下文只传递**元数据和指令**,不传递**大量原始内容**。用脚本做重活,AI 做决策。

## 子代理使用铁律(探索探子)

子代理是主代理用于「宽而重」读取的探子。只在它能减少主线程上下文污染、提高并行度或提供独立核验时使用;工作的任何阶段只要命中条件即可派发,不限于对话开头。主代理负责分解、编排、方案取舍、修改和最终裁决。

### 何时直接处理
- 已知位置的小文件、少量代码或单一事实。
- 即将修改的确切代码;子代理至多帮助定位,原文必须由主代理亲读。
- 派发、等待和复核成本不低于主代理直接读取的任务。
- 奠基性文档(架构、设计、交接备忘录),无论多长都由主代理完整阅读。

### 何时派发探索
- 巨型非奠基文件、跨文件或跨目录检索。
- 相互独立、可并行的探索或核验。
- 长任务中重新确认模块现状。
- 会产生大量日志、搜索结果或外围材料的阅读。
- 多个独立问题必须在同一轮并发派发。

### 派发契约(MYStudio 运行时)
- MYStudio 默认运行时是 **Trellis channel-driven**(`trellis channel spawn --agent implement|check`)与 **Task subagent**(Explore / Plan / general-purpose 等)。派发探索优先用只读 **Explore subagent**。
- prompt 必须自包含:写明 active Trellis task(如有)、唯一问题、精确检索范围、允许读取范围、**禁止编辑、禁止 git/worktree、禁止破坏性操作**、验收标准和输出格式。
- 精度重要时,必须返回 `file:line`、符号名和必要关键原文;缺少信息时只报告阻塞点,不自行扩大范围。
- 探索批次保持轻量,避免把完整参考文件或大段原文塞进 prompt。

### 等待、回收与验证
- 派发之后主代理**停止其余分析、检索、命令和文件修改**,等子代理返回。
- **超时后的正确处理(按序)**:① 读一次子代理状态与最近输出;② 有新输出/状态推进才再等一次;③ **连续两次状态与输出均无变化 → 停止再等**,向用户报告阻塞诊断(写清:每个子代理 id/状态/最近输出时间与摘要、是否 hook/tool 失败、是否有已完成却未回收者),**不得盲目连打等待**。
- **现象三分(下结论前必区分)**:① 正常超时轮询(随后做了状态检查);② 父代理忙轮询(超时后无检查立刻再等);③ 子代理/后端卡住(状态 running 但输出长时间不变)。
- 每个子代理只用一轮,不复用、不追派。
- 子代理默认只做探索、检索和核验,不修改代码或文档,不承担最终验证。
- 子代理结果只是压缩后的线索。主代理顺着其 `file:line` 定点抽查,不重新通读已外包材料。**唯二必须由主代理亲自完整读原文的是:即将修改的确切代码、奠基性文档。最终验证必须由主代理基于当前磁盘和可复现命令完成。**

### 失败处理
1. `context too long`:立即缩小范围或拆批,不重复同一宽 prompt。
2. 超时且无人完成:先做状态/输出检查与连续无变化判定;确认卡住后再缩范围、改 prompt 或改由主代理直做。
3. 输出截断:要求只返回摘要和出处;大量结果写入已授权的 task `research/`,仍只回报摘要。

## 禁止破坏性操作铁律(保护生产资料)

> **🔒 Git 边界**:MYStudio 默认允许 commit(workflow Phase 3.4),但**所有 git 操作必须先获用户明确同意**。不得自行 `git push`、`git push --force`、`git commit --amend`、`git rebase`、`git reset --hard`、`git clean -f`、`git stash`。commit 前向用户说明范围。

- **绝对禁止(即使用户同意也不执行)**:`git checkout .`、`git reset --hard`、`git clean -f`、`rm -rf`、批量删除文件、`git push --force`、`git branch -D`、删除已有正文/代码内容、清空文件
- **删除需确认**:删除任何已有内容(代码、文档)前必须先告知用户(见全局铁律:禁止删除文件)
- **Edit 不删内容**:Edit 的 new_string 不得为空字符串(除非用户明确要求删除该内容)
- **备份优先**:大范围修改前先用 `cp` 备份,确认无误后再清理备份
- **禁止 worktree**:禁止任何形式的 worktree 功能(主代理/子代理),禁止在 `.claude/worktrees` 下写内容
- **子代理同受约束**:子代理 prompt 必须包含本破坏性操作禁令

## 行为准则

| 规则 | 说明 |
|------|------|
| **指令边界铁律** | **绝对服从用户指定的范围边界!** 指定在某个模块/文件干活,**绝对禁止**越界、牵连或顺手修改其它不相关内容。不臆想,不接受任何理由的越界修改。 |
| 先读后改 | 未读取的文件禁止修改 |
| 最小改动 | 只做必要的改动,不顺手重构 |
| 诚实无知 | 不确定时寻求确认,不臆想业务 |
| 复用优先 | 复用现有接口和组件,不创造新的 |
| 简洁回复 | ≤4 行(不含代码),不加前言后语 |
| 代码引用 | 格式 `file_path:line_number` |

---

## 严禁猜测铁律(精确表述优先)

1. 严禁使用「candidate」等不确定表述。
2. 严禁对任何标识符(键名、变量名、路径、字段)进行大小写/格式/结构匹配猜测。
3. 不确定某个请求、配置、数据结构、变量名、JSON 路径时,必须先读相关文件(测试、日志、配置、源码)提取精确表述。
4. 无法从现有文件找到精确信息时,必须向用户询问,由用户手动执行测试/抓包/检查获取。
5. 除非用户明确允许,绝对不得自行猜测任何内容。

## 工具优先级

| 优先级 | 工具 | 用途 |
|-------|------|------|
| 1 | **Trellis** | 重要、复杂、长线、多步骤任务的默认工作流:task、PRD、计划、执行、检查、收口 |
| 2 | **本地只读工具** | `Read` / `Grep` / `Glob` / `rg` / `fd` / `--help` / 最小探针,先查清事实再动手 |
| 3 | **精确编辑工具** | `Edit` 优先;大文本和批处理用 `apps/build/scripts/` 下脚本 |
| 4 | **Task 子代理** | 宽而重的探索、跨目录检索、独立核验;必须精简 prompt 并限制范围 |
| 5 | **Trellis channel** | 多 worker 协作实施/检查(implement/check agent) |

---

## 搜索标准操作(Search SOP)

> **先读后搜(强制)**:任何仓库搜索前,先完整读取 [`.trellis/spec/guides/search-sop-guide.md`](../.trellis/spec/guides/search-sop-guide.md),再按其中的范围、工具与排噪规则执行。

- 文件名用 `fd`;内容用 `rg`;TypeScript 符号用 LSP(`smart_search` / `smart_outline`)或 `tsserver`。
- **默认范围**:`apps/frontend`(renderer 主体)、`apps/backend`(Python TTS)、`apps/build`(构建执行器);**不要**在 `apps/out`、`apps/release`、`apps/output`、`node_modules`、`.vite` 里搜源码。
- **改任何值前先 `grep -r`**:确认没有其它引用(见 `.trellis/spec/guides/index.md` 的 Pre-Modification Rule)。
- 完整热路径表、可执行配方与排除规则维护在 SOP;禁止全树无路径 `rg` / `grep`。

## 文档索引

| 类别 | 路径 | 用途 |
|------|------|------|
| 架构总览(开发者必读) | `docs/engineering/DEVELOPER_ARCHITECTURE.md` | 仓库主线、模块地图、数据边界、代码入口 |
| 故障排查 | `docs/engineering/TROUBLESHOOTING.md` | 白屏 / Python / TTS / API / 图床 / 存储 / 打包排障 |
| 打包与 smoke | `docs/engineering/PACKAGING_AND_SMOKE_TESTING.md` | 打包安装与 smoke 测试 |
| 存储与数据 | `docs/engineering/STORAGE_AND_DATA.md` | 存储结构与数据迁移 |
| 文档中心 | `docs/README.md` | 全部用户/开发者文档索引 |
| Trellis 工作流 | `.trellis/workflow.md` | 任务生命周期、阶段门禁、channel 运行模式 |
| Trellis spec 索引 | `.trellis/spec/guides/index.md` | guides 索引 + Pre-Modification Rule |
| 代码复用思考 | `.trellis/spec/guides/code-reuse-thinking-guide.md` | 重复代码识别 |
| 跨层思考 | `.trellis/spec/guides/cross-layer-thinking-guide.md` | 跨层数据流 |
| 图片外发安全 | `.trellis/spec/guides/image-transfer-safety-guide.md` | 图片外发缩略图/字节门 |
| 开放任务看板规范 | `.trellis/spec/guides/trellis-open-task-board-guide.md` | 「还有什么任务」输出规则 |
| 搜索 SOP | `.trellis/spec/guides/search-sop-guide.md` | 搜索范围/工具/排噪/热路径(先读后搜) |
| Python TTS sidecar | `apps/backend/README.md` | TTS API、环境变量、运行时目录 |
| 自动化测试 skill | `.agents/skills/mystudio-automation-testing/` | typecheck / Vitest / 打包 / smoke 自验证 |
| 工作流完整性 skill | `.agents/skills/mystudio-workflow-integrity-testing/` | 节点图 / Toonflow parity / 资产链接验证 |
| 口播文案 skill | `.agents/skills/mystudio-voiceover-writer/` | 分镜口播规划与校验 |
