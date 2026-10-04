# 漫影工作室 · MYStudio

本地优先的 AI 漫剧 / 短剧 / 小说影视化创作桌面工作台 —— 从小说到成片。

- **类型**:Electron 桌面应用(AI 漫剧/短剧制作工作台)
- **技术栈**:Electron + React 18 + TypeScript + Zustand + Tailwind v4 + electron-vite/Vite + Vercel AI SDK(多 provider:anthropic/openai/google/deepseek/xai/qwen/zhipu/minimax)+ 本地 FFmpeg + Python TTS sidecar(`tts`)
- **主代码**:`apps/frontend`(renderer:`components/` `stores/` `lib/` `hooks/` `types/` + electron:`main/main.ts`/`preload/preload.ts`/`ipc/`/`rendering/timeline-ffmpeg-command.ts`)、`apps/backend`(Python 域:TTS sidecar + `engines/` 底层模型引擎层,含 ComfyUI 托管引擎与 my_nodes 自研节点包(原 manying_nodes,10-03 改名))、`apps/build`(构建执行器:`chapter_video/` `timeline/` `smoke/` `packaging/`)
- **关键约定**:**没有根 `package.json`**,所有 npm 命令从 `apps/` 执行(`cd apps && npm run dev`)。`apps/out/` `apps/release/` `apps/output/` 是构建产物,禁止 import。
- **打包约定**:桌面打包统一从 `apps/` 执行;macOS 标准入口 `npm run build:mac` 必须经由 `sh ./build/packaging/build-mac.sh` 完成构建、覆盖安装、installed smoke 和关闭应用,不能只停在安装包。正常打包只校验并复用 `apps/.cache/remotion-bundle`,不得隐式运行 `npm run remotion:bundle`。Remotion 版本、composition 或 bundle 内容变化后,先显式运行 `cd apps && npm run remotion:bundle`,再运行 `cd apps && npm run remotion:versions` 和目标打包命令;固定 bundle 缺失或漂移时应让打包在 electron-vite 前失败。
- **根目录产物约定**:根目录不得生成 `node_modules/`、`output/` 或 `backups/`;依赖使用 `apps/node_modules`,导出使用 `apps/output`,任务备份使用 `.trellis/tasks/<task>/backups/`。
- **注意**:不要在根目录随意新增文件夹以及文件
- **必须**:渐进式,分段式,少量,多次输出,每次编辑/写入只修改一点,逐次完毕

---

## 🚨 铁律 0(最高优先级):先查找定位,验证假设,再动手

> 惨痛教训:因「信息不足就动手」反复返工。**此条优先级高于一切。**

**任何仓库/仓库外/网络搜索前,必须先完整读取 [`.claude/knowledge/search-sop.md`](knowledge/search-sop.md)**(仓库内热路径 + 仓库外本地五源 + 网络搜索路由)。

**核心流程**:找文件 `fd` / 找内容 `rg` → `Read` 验证原文与行号 → `Edit` 精确替换 / `Bash` 执行;新建文件无需查找,直接写。绝不凭记忆猜路径,绝不经 Read 就 Edit。

**两大陷阱**:
1. **中文路径空格**:部分模型在中英文交界处自动插入 U+0020 空格!永不手工拼接中文路径,用 `fd -a` 或 `os.listdir()` 动态获取(APP 数据目录 `~/Library/Application Support/漫影工作室` 常驻中文路径,同样适用;`apps/out/` ≠ `apps/output/` ≠ `apps/release/`、`.config` ≠ `.claude`);`find` 仅用于已知路径的字节精确核验。
2. **未经 Read 就 Edit**:old_string 不匹配报错只是表象,根因是没验证原文。

**开发前验证清单**(任何写代码/改文件/审查/修复前;信息不全、假设未证实,绝对禁止动手):
① 运行时约束先写最小探针(模块能否 import?vitest 能否跑?),绝不假设能力存在;② CLI/函数参数先 `--help` 或读源码,绝不猜参数;③ 依赖完整性按 Search SOP 最小范围确认;④ 要解析的 JSON/字段先 dump 真实样本,绝不猜字段;⑤ 服务先探测(Python TTS sidecar `127.0.0.1:17593`、FFmpeg),不可要有兜底;⑥ 特殊路径先 `fd` 定位;⑦ 改任何值/常量/配置前全树 `rg` 引用面(Pre-Modification Rule,`.trellis/spec/guides/index.md`)。
执行纪律:接到任务先列全部假设与未知 → 逐一最小探针验证 → 全部确认后才写第一行;出现「我以为/应该是/大概」立即停下查证。以动手实践/打印日志/单元测试/代码重用/读源码/渐进分段/最小改动/复用接口/守范围边界/诚实求证/保留可追溯脚本为荣,以其反面(只看不练、单步跟踪、手工测试、复制粘贴、猜测臆断、一次性巨量操作、越界重构、重复造轮子、牵连修改、编造业务、破坏性删除)为耻。

**下结论三关**:声称「已完成/没问题/不存在」前必过——① 回原位核实不信二手坐标,「没找到」≠「不存在」,必须全树搜同类标识符;② 行为改动全量核验,不用采样代表全局,关键数字换脚本/换范围交叉复跑;③ 证据不全时回答带不确定性(✅「查了 X,还没核验 Y」)。自检三问:我只在指定位置查过还是全树查过?我找过能推翻结论的反例吗?说「没问题」最可能在哪里被打脸?——去查那里。

---

## 🚨 铁律 1:渐进式分段 + 大量内容脚本化

渐进、分段,读/写/改/接收每次少量(避免速率限制)。长内容(>200 行)用 Bash heredoc 写盘,避免工具参数截断;大文件分段 `Read`(每次 200–300 行),每段读完立即总结再决定是否继续;大修改(>300 行)分多次 Edit,每段验证后再继续。

**大量内容防上下文爆炸**:>1 万字的读取/转换/插入必须用 Python/Node 脚本本地处理,**禁止通过 AI 上下文传递大文本;脚本统一放 `apps/build/scripts/`,不需要删除**。批量数据插入、大文件格式转换、跨文件汇总一律「脚本做重活,AI 做决策」;子代理大结果写入已授权的 task `research/`,只回摘要和出处。核心原则:AI 上下文只传**元数据和指令**,不传**大量原始内容**。

**长任务监控铁律(09-15)**:跑打包/E2E/渲染/引擎级长任务,一律「后台任务 + `命令 > log 2>&1; echo $? > exit文件` + 完成通知」,**禁止 sleep 轮询**(任务完成后仍白等整个睡眠周期,实测白等 10+ 分钟;读结果认 exit 文件,不信外层回显);重活前查 `uptime`,负载 ≥6 时新起 Electron 会被 SIGTERM 触发整链重跑——先降负载再跑 smoke。

---

## 🚨 铁律 2:子代理使用铁律(探索探子)

子代理只用于「宽而重」的读取探子:跨文件/跨目录检索、可并行的独立探索或核验、会产生大量日志/搜索结果/外围材料的阅读、长任务中重确认模块现状。**直接处理**的场景:已知位置的小文件/少量代码/单一事实;派发等待成本高于直读;奠础性文档无论多长主代理亲读。

**派发契约**:prompt 必须自包含——active Trellis task(如有)、唯一问题、精确检索范围、**禁止编辑/禁止 git/禁止破坏性操作**、验收标准、输出格式;精度重要时必须返回 `file:line` + 符号名 + 必要关键原文;缺信息只报阻塞点不扩大范围;批次轻量;默认只读 Explore subagent;每个子代理只用一轮,不复用不追派。子代理默认只探索/检索/核验,不改代码文档、不做方案取舍、不承担最终验证。

**等待、超时、阻塞诊断、失败处理的完整协议**:见 [`.claude/knowledge/subagent-waiting-protocol.md`](knowledge/subagent-waiting-protocol.md)。要点:派发后立即阻塞等待;超时先读一次状态/输出再决定,连续两次无变化停止再等、报告诊断;`context too long` 缩范围拆批;结果只是压缩线索,重要/可疑必点验出处。

**唯二必须主代理亲读原文**:即将修改的确切代码、奠基性文档;最终验证由主代理基于当前磁盘与可复现命令完成。

---

## 🚨 铁律 3:行为准则 + 禁止破坏性操作

| 规则 | 说明 |
|------|------|
| **指令边界铁律** | **绝对服从用户指定的范围边界!**指定在某模块/文件干活,禁止越界、牵连、顺手修改无关内容;每行改动都须能直接追溯到用户请求 |
| 先读后改 | 未读取的文件禁止修改 |
| 最小改动 | 只做必要改动,不顺手重构 |
| 诚实无知 | 不确定时寻求确认,不臆想业务 |
| 复用优先 | 复用现有接口和组件,不创造新的 |
| **高星参考铁律** | 相关的代码内容必须参考 GitHub 高星项目——别人已经做好的,就直接参考使用,而不是按自己的想法自己写代码 ,必须 多方对比 + 可行性路线分析 + 现有走通的例子|
| **漫影工作流只读铁律(09-14 用户裁定)** | 漫影固定工作流(仓库静态自研+桥模板同库真源 `apps/backend/engines/comfyui/workflows/**`,旧 `image_engine/workflows/**` 独立目录已不存在;H3 单镜模板 `MY-h3-shot-template*.json` 实住 `apps/frontend/lib/assist/image-studio/`,为前端随包资产,不属工作流库命名铁律范围——豁免属灰区,候用户正式裁定)一律只读,AI 会话禁止改动本体;要改=复制副本后改副本;固定本体的源码/JSON 改造权**仅限用户本人**。详见 `docs/comfyui-kb/漫影工作流清单.md` 修改铁律条 |
| 简洁回复 | ≤4 行(不含代码),不加前言后语 |
| 代码引用 | 格式 `file_path:line_number` |

**Git 边界**:workflow Phase 3.4 required——本仓惯例 per-task pathspec 提交(提交只圈本任务文件路径,禁全量 add),禁 amend/push;分支/删除/越任务范围操作先获用户同意。

**禁止破坏性操作(保护生产资料)**:
- **绝对禁止(即使用户同意也不执行)**:`git checkout .`、`git reset --hard`、`git clean -f`、`rm -rf`、批量删除文件、`git push --force`、`git branch -D`、删除已有正文/代码内容、清空文件
- 删除任何已有内容(代码、文档)前必须先告知用户;Edit 的 new_string 不得为空字符串(除非用户明确要求删除该内容)
- 无关死代码/重复代码/废弃文件只报告不顺手删;大范围修改前先用 `cp` 备份(禁止自行 `git stash`),确认无误再清理备份
- 子代理 prompt 必须包含本禁令;**禁止任何形式 worktree**(主/子代理),禁止在 `.claude/worktrees` 下写内容

---

## 🚨 铁律 4:严禁猜测(精确表述优先)

1. 严禁「candidate」等不确定表述;严禁对任何标识符(键名、变量名、路径、字段)做大小写/格式/结构匹配猜测。
2. 不确定请求、配置、数据结构、变量名、JSON 路径时,必须先读相关文件(测试、日志、配置、源码)提取精确表述。
3. 无法从现有文件找到精确信息时,必须问用户,由用户手动执行测试/抓包/检查获取;除非用户明确允许,绝对不得自行猜测任何内容。

---

## 🚨 铁律 5:文件命名铁律(2026-09-22 立,任务 09-22-repo-dated-filename-reorg)

1. 文件名=身份,日期=历史;版本与时间一律交给 git;
2. 新脚本默认稳定名;确认一次性战役脚本直接落 `campaigns/`(名含日期合法);
3. 活文档稳定名,头部维护 `最后核账:YYYY-MM-DD` 字段,更新即改;
4. 活文档文件名禁带日期;时点裁定类内容落 `档案/`;
5. 豁免清单:被测试/代码硬路径锚定的契约文档(现仅 `道劫_新提示词包_0917.md`),改名须连锚一起改,否则冻结。

---

## 🚨 铁律 6:先报量再动手(2026-09-29 用户裁定)

**凡是预估超过 30 分钟的活,动手前必须先向用户报「规模预估 + 步骤清单」,取得明确批准后才执行。** 这是 Trellis「先记录后执行」(新任务建档停等「开始」)向一切执行类工作的推广;商讨/疑问类消息仍止于评估,不因本条变成执行令。

1. **两档门禁**:战役(默认)= 全门禁(impact → TDD → 四门禁 → detect_changes → 打包);快改 = 仅当用户明示豁免时走轻门禁,**豁免只能用户给,AI 不得自判降档**。
2. **规模预估要素**:改哪些文件、大致行量、要跑哪些门禁、预计耗时、并行度与 token 预算;清单发出后停等批准,不抢跑。
3. ≤30 分钟的小活可直接干;执行中若发现实际规模超档,立即停下重新报量。
4. **查改分家**:批准门只管「改」不管「查」——只读的审计/探查/摸底不受本门约束,可直接干;查完要动手修(任何写操作)才触发报量。与 09-17「主动全量审计」裁定各管各的:审计照旧主动做,动手前才报批。铁律 0 要求的最小探针、审计/排查报告的落盘,属于「查」的伴生产物,不算动手修——报告一律落新文件,不覆写既有文档;但借「审计产物」之名行改代码或既有生产正文之实,仍按「改」论处。
5. **战役中途检查点**:已批准的战役,每跑到阶段边界(过一道门禁/完成一个阶段)主动给用户一行进度,让用户随时能踩刹车;禁止闷头连续几小时无汇报。
6. **快改收尾报豁免清单**:走了轻门禁的快改,收尾报告必须列明「这次哪些门禁没跑」,防止「没跑」被误当「跑了且过了」。
7. **报量限成本**:出规模清单本身只做快扫(文件数/大致行量/要跑哪些门禁/预计耗时),拿不准的直接标「未知」,不得先深挖半天再报量。

---

## 🚨 铁律 7:并行并发多 agent 执行(2026-09-29 用户裁定)

**可并行必并行——多 subagent 并发执行是主要核心规范。** 接任务第一问「哪些单元互相独立」→ 全部同时发出;无真实数据依赖时,禁止串行排队干等。

1. **工作流强制扇出**:dynamic workflow 里凡可并行的阶段一律 fan-out——独立单元各自新建 agent 并发,下游阶段在各自回调内链式衔接,只在「后步需要全部前步结果」处 join 一次;不得为整洁把共享 agent 提出去、把扇出变成 FIFO 队列。
2. **真依赖才串行**:后步确实消费前步结果(起草→复审、改动→门禁)才顺序执行。
3. 边界:本条管「一个会话内多 agent 并发」;跨会话共享真源的冲突等待另按既有裁定(mtime 静默门)。跨会话共享真源,动手前查目标文件 mtime,30 分钟内有变动则先静默等待并重验,不抢写;单行级手术编辑(索引行/记忆条目的追加、改写、去重)豁免静默等待,但必须写前重读并以精确原文锚定,整段重写与批量改动不豁免。
4. **扇出不推翻铁律 2 的经济律**——并行只管「本就要多 agent 干的活」的编排形态;已知位置的小文件/少量代码/单一事实仍按铁律 2 的小事直读原则直接处理,派发成本高于直读就不派。
5. **并行写守卫**——并行单元的写盘不得共享同一文件;共享真源(如 MEMORY.md)的写入收敛到单点或串行化,写前必重读最新内容。当日实证:2026-09-29 本项目两次并发撞写全靠编辑器过期检查兜底,纯属运气,故立此守卫。
6. **扇出成本预算**——扇出是 token 放大器:并行度与 token 预算必须写进规模清单(铁律 6 第 2 条);执行中超预算,到阶段边界主动向用户明示理由;连续超耗早停早摊牌,不自续。

---

## 工具优先级

| 优先级 | 工具 | 用途 |
|-------|------|------|
| 1 | **Trellis** | 重要、复杂、长线、多步骤任务的默认工作流:task、PRD、计划、执行、检查、收口 |
| 2 | **本地只读工具** | `Read` / `Grep` / `Glob` / `rg` / `fd` / `--help` / 最小探针,先查清事实再动手 |
| 3 | **精确编辑工具** | `Edit` 优先;大文本和批处理用 `apps/build/scripts/` 下脚本 |
| 4 | **Task 子代理** | 宽而重的探索、跨目录检索、独立核验;必须精简 prompt 并限制范围 |
| 5 | **Trellis channel** | 多 worker 协作实施/检查(implement/check agent) |

**GitNexus 索引保鲜(0928 立)**:索引落后 = AGENTS.md 强制的 impact/detect_changes 门禁对最新代码失明(绿灯假象)。收尾/打包前跑 `python3 apps/build/scripts/gitnexus_freshness_check.py --strict`,落后或报「中断的增量标记」时执行 `node .gitnexus/run.cjs analyze --embeddings` 刷新(增量,本地 onnx 免 key);多会话并行时 analyze 可能撞并发墙 exit 1,重跑直至标记清除。pre-commit 已挂警告位(不拦截)。

---

## Trellis

**用户问「还有什么任务 / 还剩什么 / 任务列表」** → 运行 `python3 ./.trellis/scripts/open_task_board.py`,只列未完成 + 有歧义项(不列已归档/无需再做/统计债),原样贴脚本输出不自造简表;规范 `.trellis/spec/guides/trellis-open-task-board-guide.md`。

**任务入口与硬约束**:重要、复杂、长线、多步骤、跨系统、批量治理、工作流/规则/提示词改造,或需持续验证收口的任务进 Trellis(用户点名必须进;简单边界清楚的一次性问答/只读查询可不建)。入口 `python3 ./.trellis/scripts/task.py`(create/start/current/finish/archive/list);开始前读 `.trellis/workflow.md`(任务生命周期、阶段门禁、状态路由、Channel-Driven 运行模式的**唯一权威**)+ 当前 task + 适用 spec/index 与目标文件。

**需求理解与澄清**:先评估真实目标、场景、关键要求与验收标准;能从仓库/文档/任务核验的事实先核验,**用 Search SOP 全面了解后再判断下一步**。边界不清优先用访谈技能(如 `trellis-brainstorm`)问用户,AI 判断不了的必须问并给建议;只问最能消除不确定性的一个问题(必要时 2–4 选项),不重复提问;需求清楚直接推进,给最终方案前简要复述理解;**可验证目标优先**(「修 bug」→「先写复现测试再修」;弱成功标准只会来回澄清)。

---

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
| **搜索 SOP(权威版)** | `.claude/knowledge/search-sop.md` | 搜索范围/工具/排噪/热路径 + 仓库外五源 + 网络路由(先读后搜) |
| **节点图知识(权威版)** | `.claude/knowledge/node-graph-architecture.md` | 节点图通用原理 + 本项目画布架构/任务地图/裁定(画布任务先读) |
| **UI 截图审计 SOP(权威版)** | `.claude/knowledge/ui-audit-sop.md` | 保温会话铁律:禁每轮 pkill 冷启动/多状态连拍/非引擎页不等引擎 + `cdp-ui-audit-shot.mjs` 用法(截图审计前先读) |
| 子代理等待协议 | `.claude/knowledge/subagent-waiting-protocol.md` | 铁律 2 派发后的等待/超时/阻塞诊断/失败处理 |
| GitNexus 强制流程 | 根 `AGENTS.md`(gitnexus 管理块) | impact/detect_changes 必做与禁止清单(改动前必读) |
| Python TTS sidecar | `apps/backend/README.md` | TTS API、环境变量、运行时目录 |
| 自动化测试 skill | `.agents/skills/mystudio-automation-testing/` | typecheck / Vitest / 打包 / smoke 自验证 |
| 工作流完整性 skill | `.agents/skills/mystudio-workflow-integrity-testing/` | 节点图 / Toonflow parity / 资产链接验证 |
| 口播文案 skill | `.agents/skills/mystudio-voiceover-writer/` | 分镜口播规划与校验 |
