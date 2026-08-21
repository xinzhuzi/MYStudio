# 搜索标准操作手册(Search SOP)

> **项目根目录**: `/Users/zhengbingjin/Project/Github/MYStudio`
>
> **本文件为权威版**(2026-08-21 起):由 MA 项目 search-sop 融合 MYStudio 实际结构而成,并新增「仓库外本地热路径」与「网络搜索路由」两节;`.trellis/spec/guides/search-sop-guide.md` 为历史版本,内容以本文件为准。
>
> ## 🚨 两大铁律 (执行搜索前必读)
>
> ### 铁律 1: 中文路径陷阱
> 部分模型在中英文交界处会自动插入 U+0020 空格!
> - ❌ 错误：`.trellis/tasks/08-21 任务`(有空格)
> - ✅ 正确：`.trellis/tasks/08-21任务`(无空格)
> - 🔧 解决：**永远不要手工拼接中文路径**,用 `fd` 或 Python `os.listdir()` 动态获取。本仓库源码路径以 ASCII 为主,但 `.trellis/tasks/`、`docs/` 下可能有中文命名;**APP 数据目录 `~/Library/Application Support/漫影工作室` 是常驻中文路径**,同样适用。
>
> ### 铁律 2: 先 Read 再操作
> 任何 `Bash/Edit/Write` 命令前**必须先 Read**相关文件找准确位置!
> - ❌ 错误：没看文件就乱改/乱查
> - ✅ 正确：`Read` → 找到行号 → `Edit/Bash`
>
> ---

**先读后搜**(强制):任何仓库内容、文件名、符号、仓库外本地数据或网络内容搜索前,先完整读取本文件;随后仅按本文的范围、工具与排噪规则搜索。

本项目是 Electron + React + Python 的 monorepo,产物与依赖目录很大(`node_modules/`、`apps/out|release|output/`、`.vite/`)。统一使用 `rg` / `fd` / `fzf` / LSP / `gitnexus`,**禁止**全树 `grep` / `find`。入口提示位于 `.claude/CLAUDE.md` 与 `.trellis/workflow.md`。

---

## 🛠️ 核心工具速查

| 工具 | 用途 | 示例命令 |
|------|------|----------|
| `fd` | 文件名搜索 (推荐) | `fd tts apps/frontend/components` |
| `rg` | 文件内容搜索 (正则/精准匹配) | `rg 'useStore' apps/frontend/stores` |
| `gitnexus` | 语义搜索 + 代码知识图谱 + 影响分析 | `gitnexus query -r MYStudio 'tts model lifecycle'` |
| `fzf` | 交互模糊筛选 | `fzf` |
| LSP | TypeScript 符号索引 | `smart_search` / `smart_outline` / `smart_unfold` 或 `tsserver` |

> **ripgrep vs GitNexus 分工**: `rg` 做精准文本/正则匹配(快、轻、无需索引);`gitnexus` 做语义搜索、调用链追踪、影响分析(深、需索引、知识图谱)。两者互补,不替代。

---

## 30 秒决策

1. **先定范围**:选择下方已验证的最小目录;未知范围时先用目录/文件名定位,**禁止**从仓库根开始内容搜索。目标在仓库外(APP 数据/IP 项目/设定集/记忆)→ 用「仓库外本地热路径」表;目标是网络内容 → 用「网络搜索路由」表。
2. **再选工具**:
   - **文件名** → `fd`
   - **精准文本/正则匹配**(已知关键词、类名、字符串字面量) → `rg`
   - **TypeScript 符号**(定义/引用/outline) → LSP(`smart_search` / `smart_outline` / `smart_unfold`)或 `tsserver`
   - **语义搜索**("哪里实现了 TTS 模型生命周期"、"哪些地方涉及时间轴渲染") → `gitnexus query`
   - **调用链/影响分析**("谁调用了 startTts()、改这个函数会影响哪些文件") → `gitnexus impact` / `gitnexus context`
   - **交互模糊筛选** → `fzf`
3. **最后控结果**:大结果用 `-l`、`-c`、`--max-count` 或落盘;**不要**把大量原始命中传入 AI 上下文。

## 已验证热路径(仓库内)

| 目标 | 首选范围 | 关键约束 |
|------|----------|----------|
| 前端组件 | `apps/frontend/components` | 含 `panels/`(分域面板)、`ui/`(基础组件) |
| 状态管理 | `apps/frontend/stores` | Zustand store,按域子目录(ai/app/director/editing/library/studio/tts 等) |
| 领域逻辑/工具 | `apps/frontend/lib` | ai/scene/script/storage/studio/tts/utils 等子目录 |
| Electron 主进程/IPC | `apps/frontend/electron`、`apps/frontend/electron/ipc` | FFmpeg 在 `apps/frontend/electron/rendering/timeline-ffmpeg-command.ts` |
| 类型契约 | `apps/frontend/types` | 共享 TS 类型(project/script/timeline/studio/editing/tts 等) |
| 自定义 hooks | `apps/frontend/hooks` | use-* hooks |
| Python TTS sidecar | `apps/backend/tts` | 本地 TTS/STT 引擎(监听 127.0.0.1:17593) |
| Python 业务逻辑 | `apps/backend/video_use` | 视频处理逻辑 |
| 构建工具 | `apps/build` | daojie/、timeline/、smoke/、packaging/ |
| 大文本/辅助脚本 | `apps/build/scripts` | 见 `.claude/CLAUDE.md`「大量内容处理铁律」 |
| 文档 | `docs` | 7 个分区;工程文档在 `docs/engineering` |

**没有根 `package.json`**;所有 npm 命令从 `apps/` 执行。`apps/out/`、`apps/release/`、`apps/output/` 是构建产物(被 `.gitignore` 忽略、每次 build 重写),**不得作为源码搜索路径**。`rg` 自动跳过二进制;静态资源文件名仍可由 `fd` 搜索。

## 仓库外本地热路径(五源)

> 三位置模型:源码仓(Github/MYStudio)/ APP 数据(Application Support/漫影工作室)/ 本地项目(IP/MA)。找数据先查注册表 `location` 字段,它是项目位置的唯一权威。

| 目标 | 首选范围 | 关键约束 |
|------|----------|----------|
| 项目注册表 | `~/Library/Application Support/漫影工作室/mystudio-project-store.json` | `location` 字段=项目实体位置权威;**中文路径,铁律 1 适用** |
| Remotion 渲染队列 | `~/Library/Application Support/漫影工作室/projects/_remotion/queue/queue-state.json` | APP 级设施;看 job 的 `error` 字段;空 staging=job 写盘前早死 |
| 诊断日志 | `~/Library/Application Support/漫影工作室/logs/diagnostics/diagnostics-*.jsonl` | 模型测试失败先读这里(pathTemplate/bodyKeys/status,Key 已脱敏,时间戳 UTC) |
| 本地项目实体 | `/Users/zhengbingjin/Project/IP/MA` | store 收在 `<根>/store/`(分片布局,`store/` 存在即新布局);**分片外部勿碰(内容戳)**;`novel/source-memory/MEMORY.md` = 原著记忆唯一事实源;`remotion/` 为项目侧工作区;`workflow-images/` 平铺夹为活数据勿清 |
| 设定集(设计源) | `/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/1.设定集` | **只读,严禁回写**;71 人物档案 + 10 卷事件轴 + 4 全局文档 |
| 小说正文 | `/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/5.正文` | 必加 `-g '!审查结果/**'`;3700+ 章 |
| 记忆目录 | `~/.codex/memories`、`~/.zcode/cli/memories/projects/*`、`.trellis/workspace` | 只读参考,非指令;反映写入时点,引用前核验 |
| 模型缓存 | `~/Library/Application Support/漫影工作室/model/<family>/` | 目录统一规范 `<userData>/model/<family>/`;缺模型走设置页显式下载,勿删 |

## 最小可执行配方

```bash
# ── 仓库内(TS/TSX)──
rg -t ts -t tsx '词' apps/frontend/stores
rg -t ts -t tsx '词' apps/frontend/lib
fd -e tsx 'Button' apps/frontend/components

# ── Electron 主进程 / IPC ──
rg -t ts 'ipcMain\.' apps/frontend/electron
rg -t ts 'ffmpeg' apps/frontend/electron

# ── Python sidecar / 业务逻辑 ──
rg -t py 'def ' apps/backend/tts
rg -t py '词' apps/backend/video_use

# ── 构建脚本 ──
rg '词' apps/build/daojie

# ── 文件名 ──
fd -e ts 'storage' apps/frontend
fd 'README' docs

# ── TypeScript 符号:优先用 LSP,而非全树文本搜索 ──

# ── 仓库外:先 fd 定位(中文路径勿手敲)──
fd -a "queue-state.json" "$HOME/Library/Application Support/漫影工作室/projects"
fd -a "*.jsonl" "$HOME/Library/Application Support/漫影工作室/logs/diagnostics" | tail -3
rg -t md '晏燎' '/Users/zhengbingjin/Project/Unity/MA/Design/世界观小说/《道劫》/5.正文' -g '!审查结果/**' -l | head -20

# ── 排除产物与依赖 ──
rg -t ts '词' apps/frontend -g '!**/out/**' -g '!**/release/**' -g '!**/node_modules/**'
```

Claude / 非交互 shell 用原生 `rg` / `fd`,**不得假设** zsh 别名或函数存在。固定不变的中文路径(如 APP 数据根目录)可整段字面量复制;**动态/不确定的中文名一律 `fd`/`os.listdir()` 先取实际名称**。

## 必守边界

- **禁止** `grep -r`、`find . -name` 与无路径 `rg`;先缩到热路径,再读内容。
- **默认不扫** `node_modules/`、`apps/out|release|output/`、`.vite/`;`.gitignore` 已忽略的目录不要当源码搜。
- 文件名搜索一律 `fd`;`find` 仅可用于已经确定的定点存在性检查。
- **仓库外只读边界**:设定集、记忆目录、注册表只读;`projects/` 整目录必留,可清的只有 bak 类备份;store 分片与 `_migrated.json` 迁移守卫勿动。
- `gitnexus` 是重工具(需先 `analyze` 索引),不适合"找一个字符串"这类轻量任务;轻量搜索优先 `rg`。
- 检测命中不等于可以修改;先读上下文并验证语义。批量结果、JSON 台账和扫描脚本留在磁盘(`apps/build/scripts/`),AI 只接收摘要与路径。
- **排查规则文件/配置引用时必须加 `--hidden --no-ignore`**:`.trellis/`、`.claude/` 是隐藏的本地目录,`rg` 默认跳过隐藏文件并尊重 `.gitignore`,不加会假阴性(2026-08-21 实证:全仓扫旧 SOP 引用,漏掉 `.trellis/spec/guides/index.md` 里的活链接)。

---

## 🌐 网络搜索路由

> 工具名以 ZCode + MCP 环境为准;Codex / Claude Code 环境用各自等价工具,**路由原则不变**。

| 场景 | 工具 | 要点 |
|------|------|------|
| 通用 / 英文网络搜索 | `WebSearch` | 仅美源;回答末尾必须附 Sources 链接列表 |
| 中文区内容、时效性、域名限定 | `web_search_prime`(MCP) | `location=cn`;`search_recency_filter`(oneDay/oneWeek/oneMonth…);`search_domain_filter`;查询 ≤70 字符;要深入材料用 `content_size=high` |
| 读单个网页 | `webReader`(MCP,主)/ `WebFetch`(备) | `WebFetch` 有 15min 缓存、跨域重定向需手动跟一次;HTTP 自动升 HTTPS |
| GitHub 仓库代码/文档/issue | `zread`(MCP) | `get_repo_structure` / `read_file` / `search_doc`(免 clone);PR/issue 操作配 `gh` CLI |
| B 站视频 / UP 主 | `bilibili-analyzer` skill | 垂直解析,优于通用搜索 |
| JS 重交互 / 需登录站点 | browser-use / chrome-devtools | 搜索兜底,非首选 |

**坑清单(在档实证)**:
- **`WebFetch` 直连 `github.com` 超时** → 一律改走 `zread` 或 `webReader`。
- 中文内容用 `WebSearch` 搜不到/搜偏 → `web_search_prime` + `location=cn`。
- 模型权重查源:先 ModelScope(`modelscope.cn`)后 HuggingFace;本机网络对 HF 不稳时直接用 ModelScope 源。
- 网络结论与本地事实冲突时,以本地文件为准;网络信息须带 URL 出处。

---

## 🔗 GitNexus — 代码知识图谱引擎

> **定位**: 零服务器代码智能引擎。将代码库索引为知识图谱(依赖、调用链、集群、执行流),通过 MCP 工具暴露给 AI 代理。
> **支持语言**: 14 种,含 **TypeScript/JavaScript**、Python、Java、Go、Rust 等(本项目实际索引 TS + Python + JS)。
> **索引状态**: 运行 `gitnexus status` 查看实时新鲜度(符号/关系/执行流数量以该命令为准)。

### 使用规则(强制)

> 索引过时时运行 `node .gitnexus/run.cjs analyze`(自动选择 runner);无 `run.cjs` 则 `gitnexus analyze`。
> ⚠️ **多仓库消歧**: 全局索引了 **MYStudio + MA** 两个仓库,CLI 查询命令(`query`/`impact`/`context`/`detect-changes`)**必须带 `-r MYStudio`**——`status` 在仓库目录下能自动识别,但 `query` 不行,不带会报 "Multiple repositories indexed"。MCP 工具带 `repo: "MYStudio"` 参数。

**必做 (Always Do)**

- **改任何符号前必须先跑 impact 分析。** 修改函数/类/方法/导出前,运行 `gitnexus impact <symbol>`(或 MCP `impact({target, direction: "upstream"})`),向用户报告爆炸半径(直接调用者、受影响执行流、风险等级)。
- **提交前必须跑 `gitnexus detect-changes`** 验证改动只影响预期符号和执行流。回归审查时对比默认分支:`gitnexus detect-changes --scope compare --base-ref main`。
- **impact 返回 HIGH 或 CRITICAL 风险时必须先警告用户**,再继续编辑。
- 探索陌生代码时用 `gitnexus query '<概念>'` 按执行流搜索,而非 grep。
- 需要某符号完整上下文(调用者、被调用者、参与哪些执行流)时,用 `gitnexus context -r MYStudio <symbol>`(符号是**位置参数**,不是 `--name`)。

**禁止 (Never Do)**

- 禁止未先跑 `impact` 就编辑函数/类/方法/导出符号。
- 禁止忽略 impact 的 HIGH/CRITICAL 风险警告。
- 禁止用 find-and-replace 重命名符号 — 必须用 `rename` **MCP 工具**(理解调用图,无 CLI 等价命令)。
- 禁止未跑 `detect-changes` 检查影响范围就提交改动。

### 技能路由

| 任务 | 读取 skill 文件 |
|------|----------------|
| 理解架构 / "X 是怎么工作的?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| 爆炸半径 / "改 X 会破坏什么?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| 追踪 bug / "为什么 X 失败?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| 重命名 / 提取 / 拆分 / 重构 | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| 工具、资源、schema 参考 | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| 索引、状态、清理、wiki CLI 命令 | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

> `gitnexus analyze --skills` 会在 `.claude/skills/gitnexus/` 下安装上述 6 个 SKILL.md;若缺失说明未跑过 analyze。

### 核心命令

| 命令 | 用途 | 示例 |
|------|------|------|
| `gitnexus query` | 语义搜索(BM25 + 向量 + RRF 混合) | `gitnexus query -r MYStudio 'tts model cache lifecycle'` |
| `gitnexus impact` | 影响分析("改 X 会影响谁") | `gitnexus impact -r MYStudio startTtsRuntime --depth 3` |
| `gitnexus context` | 符号 360° 视图(入站+出站调用) | `gitnexus context -r MYStudio startTtsRuntime` |
| `gitnexus rename` | 多文件协调重命名(**仅 MCP**) | MCP: `rename({symbol_name:"Old", new_name:"New", dryRun:true, repo:"MYStudio"})` |
| `gitnexus wiki` | 从知识图谱生成 LLM 文档 | `gitnexus wiki` |
| `gitnexus status` | 查看索引状态 | `gitnexus status` |
| `gitnexus detect-changes` | Git diff 影响分析(提交前) | `gitnexus detect-changes -r MYStudio --scope staged` |

### MCP 工具接口(AI 代理专用)

> GitNexus 有两套接口:**CLI**(终端命令,见上表)和 **MCP**(AI 代理通过 MCP 协议直接调用)。MCP 返回结构化 JSON,更适合 AI 代理在对话中直接使用。
> **ZCode 已手动注册**: gitnexus MCP server 已写入 `~/.zcode/cli/config.json`(`mcp.servers.gitnexus`)。`gitnexus setup` CLI 不支持 ZCode,须手动编辑 config.json。未注册时 CLI 方式仍可用。

**MCP 工具**

| 工具 | 用途 | 参数示例 |
|------|------|----------|
| `query` | 语义搜索(按执行流分组) | `query({query: "tts model lifecycle", repo: "MYStudio"})` |
| `context` | 符号 360° 视图 | `context({name: "LocalTtsPanel", repo: "MYStudio"})` |
| `impact` | 影响分析(爆炸半径 + 风险等级) | `impact({target: "startTtsRuntime", direction: "upstream", repo: "MYStudio"})` |
| `detect_changes` | Git diff 影响分析(提交前检查) | `detect_changes({scope: "staged", repo: "MYStudio"})` |
| `rename` | 多文件协调重命名(图搜索) | `rename({symbol_name: "X", new_name: "Y", dryRun: true, repo: "MYStudio"})` |
| `cypher` | 原始图查询(先读 schema) | `cypher({query: "MATCH (n:Function {name:'X'}) RETURN n"})` |
| `list_repos` | 列出已索引仓库 | `list_repos()` |

**MCP 资源**(轻量读取,用于导航)

| 资源 URI | 内容 |
|----------|------|
| `gitnexus://repo/MYStudio/context` | 仓库概览 + 索引新鲜度检查 |
| `gitnexus://repo/MYStudio/clusters` | 所有功能区域 |
| `gitnexus://repo/MYStudio/processes` | 所有执行流 |
| `gitnexus://repo/MYStudio/process/{name}` | 逐步执行追踪 |

**impact 风险等级**

| 深度 | 风险 | 含义 |
|------|------|------|
| d=1 | **WILL BREAK** | 直接调用者/导入者 |
| d=2 | LIKELY AFFECTED | 间接依赖 |
| d=3 | MAY NEED TESTING | 传递影响 |

> **改代码前强制流程**:
> 1. `impact({target, direction: "upstream"})` → 查爆炸半径
> 2. 报告风险等级给用户,HIGH/CRITICAL 须先警告
> 3. 改完后 `detect_changes()` 验证影响范围

**图 schema**

节点:File, Function, Class, Interface, Method, Community, Process
边(CodeRelation.type):CALLS, IMPORTS, EXTENDS, IMPLEMENTS, DEFINES, MEMBER_OF, STEP_IN_PROCESS

```cypher
-- 例:查找所有调用 startTtsRuntime 的函数
MATCH (caller)-[:CodeRelation {type: 'CALLS'}]->(f:Function {name: "startTtsRuntime"})
RETURN caller.name, caller.filePath
```

### MYStudio 典型用法

```bash
# 1. 语义搜索:"本地 TTS 模型缓存逻辑在哪里"
gitnexus query -r MYStudio 'local tts model cache download'

# 2. 影响分析:"改 startTtsRuntime 会影响哪些文件"
gitnexus impact -r MYStudio startTtsRuntime --depth 3

# 3. 符号上下文:"LocalTtsPanel 的完整调用关系"
gitnexus context -r MYStudio LocalTtsPanel

# 4. 跨层语义搜索(Electron ↔ renderer ↔ Python sidecar)
gitnexus query -r MYStudio 'tts ipc handler registration'

# 5. 提交前影响检查
gitnexus detect-changes -r MYStudio --scope staged
```

### 配合 ripgrep 使用策略

| 场景 | 用 rg | 用 gitnexus CLI | 用 gitnexus MCP |
|------|-------|-----------------|-----------------|
| 找一个已知字符串 | ✅ `rg 'startTtsRuntime' apps/frontend` | ❌ 杀鸡用牛刀 | ❌ |
| 找一个已知文件名 | ✅ `fd 'LocalTtsPanel' apps/frontend` | ❌ | ❌ |
| 语义搜索(不知道确切关键词) | ❌ | ✅ `gitnexus query '...'` | ✅ `query({query: "..."})` |
| 谁调用了 X | ❌(grep 无法区分定义和调用) | ✅ `gitnexus impact X` | ✅ `impact({target: "X", direction: "upstream"})` |
| 改名影响范围 | ❌ | ❌(rename 无 CLI) | ✅ `rename({..., dryRun: true})` |
| 提交前影响检查 | ❌ | ❌ | ✅ `detect_changes({scope: "staged"})` |
| 正则匹配大量文件 | ✅ `rg -t ts 'export.*Tts' apps/frontend` | ❌ | ❌ |
| 快速验证(<1秒) | ✅ | ❌(需先索引) | ❌(需索引 + MCP setup) |

> **默认流程**: 先 `rg` 做精准搜索(秒级),找不到或需要语义理解时升级到 `gitnexus`。

## 提速与维护

- 结果过大时优先 `-l`、`-c`、`--max-count`;需要全量统计时用脚本写 JSON(`apps/build/scripts/`),不在对话中搬运全文。
- `.gitignore` 管 `rg`/`fd` 默认排除;新增产物目录时同步更新。
- GitNexus 索引数据库在项目根目录生成(`.gitnexus/`,已 gitignore);`.gitnexusrc` 可配置分析选项。索引过时时运行 `gitnexus analyze` 增量更新。
- ⚠️ **永远不要中断 `gitnexus analyze`**:增量 analyze 被 kill 会损坏 LadybugDB 的 WAL(`lbug.wal`);删 WAL 虽能恢复 query 但会**静默丢失部分文件**。若 analyze 被中断,必须 `gitnexus analyze --force` 全量重建,不要只删 WAL。
- ✅ **语义向量检索已启用(2026-08-21)**:`gitnexus analyze --embeddings` 生成 embeddings(本地 ONNX,cpu 设备),VECTOR 与 fts 扩展均已安装,`query` 现在是 **BM25+向量 RRF 混合**;首次查询会加载嵌入模型(首查 ~400ms 级,之后更快)。日常增量 analyze 不带 `--embeddings` 也会**保留**已有 embeddings(默认不丢)。
- ⚠️ **DB 单写者锁排障**:报 `Could not set lock on file` / `WAL checkpoint rotation failed` / `LOAD fts failed` 时,先 `ps aux | rg gitnexus` 查残留 analyze 进程——`--repair-fts` 失败会拉起孤儿 `analyze --force` sidecar 长期持锁(2026-08-21 实证:8 分钟重建期间一切写操作都撞锁)。**等它跑完,勿杀**——杀了会 WAL 毒化,任何写打开都 SIGSEGV;毒化后的征兆还包括**其它会话的 gitnexus 查询进程连环 SIGSEGV**(`~/Library/Logs/DiagnosticReports/` .ips 风暴,~30s 一个);处方 = 改名隔离 `.gitnexus/lbug*` 后 `GITNEXUS_LBUG_EXTENSION_INSTALL=auto analyze --embeddings --force --wal-checkpoint-threshold 67108864` 全量重建。
- WAL 轮转报错时可用 `--wal-checkpoint-threshold 67108864`(64MB)降低 checkpoint 频率重试。
- ⚠️ **别用管道接 analyze 的退出码**:`analyze | tail` 会吞真实 exit code(2026-08-21 实证:原生崩溃被 tail 的 exit 0 掩盖,留下脏 WAL)。
- 热路径、排除规则、仓库外路径或网络路由变更时,同步本 SOP 与 `.claude/CLAUDE.md` 铁律 0 的入口摘要;**不要**复制完整配方到其它规则文件。

---

## 🔧 工具使用流程铁律 (强制)

**核心原则: 先查找 → 再 Read → 最后操作**

```bash
# Step 1: 查找定位 (不知道文件在哪？用 fd/rg)
fd "文件名" [目录]          # 找文件路径
rg "关键词" [范围]           # 找内容位置

# Step 2: 读取验证 (找到路径后,读内容确认)
Read <找到的文件路径>        # 看内容 + 找准行号

# Step 3: 执行操作 (知道准确位置后才修改)
Edit <文件路径>:old=... new=...  # Edit 必须精确匹配原文
Bash <命令>                       # Bash 确保路径正确
```

| 场景 | 正确流程 | 说明 |
|------|---------|------|
| **已知文件路径** | Read → Edit/Bash | 直接读内容,然后操作 |
| **未知文件路径** | fd/rg → Read → Edit/Bash | 先搜索定位,再读再改 |
| **新建文件** | Bash heredoc / Write | 无需 Read,直接写 |
| **中文路径** | fd -a / os.listdir() | 不要手工拼接字符串 |

**❌ 错误顺序 (会被批评):**

```bash
# 没查找就瞎改
Edit "apps/frontend/lib/工件树.ts" ...      # 路径可能错(还是猜的中文名)!
Bash "ls .trellis/tasks/08-21 任务"          # 空格导致 FileNotFoundError!

# 没 Read 就 Edit
Edit "file.md":old="xxx" new="yyy"           # old_string 不匹配报错!
```

---

## 🇨🇳 中文路径处理方案

**⚠️ Unicode tokenization 陷阱**: 部分模型在中英文交界处会自动插入 U+0020 空格!

```python
# ❌ 会出错(模型插入空格)
path = ".trellis/tasks/08-21 任务"

# ✅ 正确方式(动态获取实际名称)
import os
for d in os.listdir(".trellis/tasks"):
    if "08-21" in d:  # 得到实际目录名而非手工拼接
        print(d)
```

**四种获取路径的方式:**

1. **命令行用 `fd` (推荐)**:
```bash
fd -a "文件名" [搜索目录]
fd -a "*.md" .trellis/tasks
fd -a "search-sop.md" .claude/knowledge
```

2. **Python `os.listdir()` (动态目录名)**:
```python
import os
for item in os.listdir(".trellis/tasks"):
    if "关键词" in item:
        print(item)
```

3. **Python `glob.glob()` (按模式匹配)**:
```python
import glob
files = glob.glob(".trellis/tasks/*/prd.md")
```

4. **Python `subprocess` (调用 fd)**:
```python
import subprocess
result = subprocess.run(["fd", "-a", "trellis", ".trellis"],
                       capture_output=True, text=True)
print(result.stdout.strip().split('\n'))
```

**核心原则**:
1. **永远相信磁盘实际路径,不信任手工拼写的中文路径**
2. **优先使用 `fd` 或 Python 标准库动态获取**
3. **避免任何中英混拼的字符串字面量**
4. **验证性检查直接 `ls -la` 看目录内容**
