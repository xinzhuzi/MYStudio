# Hermes plugin-catalog 记忆插件安装与加载实测报告(隔离沙盒)

- 日期:2026-10-27 | 执行:插件实测员(动态工作流子代理)
- 引擎 checkout:`~/.hermes/hermes-agent` @ `aa910ca036`(2026-10-26),CLI venv:`hermes-agent/.venv`(Python 3.12.11)
- 沙盒:`HERMES_HOME=/tmp/hermes-pluginlab`(一切写入仅落沙盒)
- 安全铁律执行:真实数据家 `~/.hermes` 全程只读;零 API key 外发;除本报告文件外未改本仓库任何文件

## 0. 一句话结论

71 个 `category: memory` 目录插件,**70 个成功装进沙盒且 SHA 钉死全部对齐**(32 个带 .git 树 HEAD==pin,38 个无 .git 树由安装器 metadata 记录 pin==revision==目录 SHA),唯一装不上的是 limbic(darwin 平台门拒绝);按 `--no-deps` 安装下 52 个通过 doctor 注册加载,18 个注册失败(9 个缺 pip 依赖、9 个 provides_hooks 声明了运行时不识别的钩子);2 个零依赖本地插件(chronicle、cognition)完成端到端功能深测,全链路 PASS。

## 1. 范围与清单(步骤 1)

- 真源:`~/.hermes/hermes-agent/plugin-catalog/`(859 个 yaml;read-only)
- 判定口径:目录 yaml 自带 `category:` 字段,**`category: memory` 共 71 个**——这是 Hermes 自己的分类学,以此为准
- 全量分类分布:`tools` 290 / `desktop` 188 / `models` 81 / **`memory` 71** / `general` 58 / `automation` 51 / `web` 47 / `platform` 44 / `voice` 23
- 边界注记:一批"名字带 memory"的插件不在 memory 类——hermes-memory-pane / hermes-memory-ui / obsidian-memory / mnemosyne-dashboard(desktop 类),kumiho-memory / superlocalmemory / wicked-memory(tools 类),memory-review / memory-rewind / memory-shield(general 类),hermes-memory-wiki(official,无 category 字段)。按任务"记忆插件"口径不计入实测
- 71 件的逐插件档案(名称/仓库/SHA/版本/tier/requires_env/能力声明)已解析落盘:`/tmp/hermes-pluginlab/memory_catalog_inventory.json`
- requires_env 分布:**51 个无环境变量要求**,**20 个声明需要第三方 API key/服务**(supermemory、mem0 系云端、honcho、memobase、sgme 等)

## 2. 隔离机制与代码路径(步骤 2 前置)

- 家目录环境变量名:**`HERMES_HOME`**。源码证据:`hermes_constants.py:130`(读 `names.get("HERMES_HOME")`)与 `hermes_constants.py:194-195`("Hermes home: context-local override → HERMES_HOME env var → platform default")
- CLI 安装入口:`hermes plugins install <name> --no-deps --no-enable`(解析器:`hermes_cli/subcommands/plugins.py:18-48`;实现:`hermes_cli/plugins_cmd_install.py:578` cmd_install)
- 安装落点:`_plugins_dir() = get_hermes_home()/"plugins"`(`hermes_cli/plugins_cmd.py:255-257`)→ 沙盒隔离成立
- `--no-deps` 的取舍:依赖同意路径(`_install_plugin_python_deps`,plugins_cmd_install.py:69)会把插件 pip 依赖装进运行时环境;为绝不触碰真实环境,全部安装走 `--no-deps`(插件装成但保持 disabled),代价见 §5 缺依赖族
- 首启坑:全新 HERMES_HOME 首次跑 CLI 会触发 PM 全量 `uv sync`(receipt:`installs/<id>/pm-runtime`,14 个 extras,耗时 19:35:02→19:39:57 约 5 分钟)——首轮 300s 看门狗误判"卡死",实为环境首次构建;之后全部安装秒级完成

## 3. 安装实测(步骤 2)

- **attempted = 71**(探针 chronicle + 后台批量 70),命令统一:
  `HERMES_HOME=/tmp/hermes-pluginlab hermes-agent/.venv/bin/hermes plugins install <name> --no-deps --no-enable`(stdin=/dev/null,每发 ≤240s 看门狗,excel_line 重试放宽 900s)
- **installed = 70**;**limbic 装不上**:安装器平台门 `Error: Plugin 'limbic' is unavailable on darwin; supported platforms: linux, windows`(0.8s 即拒,记录于 `/tmp/hermes-pluginlab/install-logs/limbic.log`)
- excel_line 首发在 GitHub clone 阶段 240s 超时(瞬时卡顿),**原样重试 5.7s 即装成**——超时≠装不上
- cognee / hermes-pubky / hyatlas / lancedb / mindgraph 5 件 stdout 无"✓ Installed"横幅但 rc=0,以安装器 metadata 为准判定装成(教训:安装结果判据用 `plugins/.install-metadata.json`,不用横幅)

## 4. 安装校验证据(步骤 3a:SHA 钉死 / provenance)

对全部 70 个装成件做 ground-truth 核对(脚本结果:`/tmp/hermes-pluginlab/ground_truth.json`):

- **provenance 两处落盘**(均在沙盒):①树内目录 sidecar `plugins/<name>/.hermes-catalog.json`(catalog_name/repo/sha/tier/installed_at);②安装器权威记录 `plugins/.install-metadata.json`(pinned:true + revision + catalog.pin)。设计上以②为准,①仅在两者一致时被采纳(`hermes_cli/plugins_cmd_catalog.py:121-134` `_adopt_legacy_sidecar` 的镜像逻辑)
- **32 个带 .git 树**:`git rev-parse HEAD` == 目录 yaml `sha` == metadata pin,三方全对齐(chronicle 例:HEAD `92e4351a8521…c3f1a` == `plugin-catalog/chronicle.yaml:sha`)
- **38 个无 .git 树**(pip 风格导出安装):metadata `catalog.pin == revision == 目录 SHA` 38/38 全对齐(HEAD 无从比对,安装器记录即钉)
- 3 件用 `plugin.json`(可移植 Agent Plugins v1 包,CLI help 明示此类"install disabled"):hermes-dreaming、jev-memory-selector、mem-os——照常装入、按设计保持 disabled
- 加载器侧证据:`hermes plugins list --user` 在沙盒逐件显示 `catalog:community@<sha8>` 溯源行(70 件全数可见;chronicle 为唯一 enabled)

## 5. 注册加载矩阵(步骤 3b)

对 70 件跑 `hermes plugins doctor <name> --ci`(真运行时契约校验,入口 `hermes_cli/plugins_cmd.py:1124`):

- **52 通过**("runtime discovery, manifest parsing, import, and registration passed");其中声明式注册工具/钩子的 8 件:icarus(16 工具/4 钩子)、chronicle(4 钩子)、hermes-lcm-x(4)、xmemo(3 工具)、qdrant(1 工具)、gbrain-retrieval-reflex / nexus / stack(各 1 钩子);其余为纯 memory-provider 插件(0 工具 0 钩子,走 provider 槽注册,doctor 计数不含 provider)
- **18 失败,两族**:
  - **缺 pip 依赖族(9)**:betterdb/birkin-mnemosyne/cortexlayer/lancedb/lancedb-suite/lumberroom/memory-zvec/mnemostack/mnemosyne——`--no-deps` 下 `No module named 'xxx'`(如 `mnemosyne_hermes`);装上树但 import 不动,属"装得上,注册前需补依赖"(enable 走 PM 即装)
  - **未知钩子族(9)**:cashew/cognee/compartment/entropicmem/excel_line/intelligent_memory/memanto/memex8/yantrikdb——manifest `provides_hooks` 声明了 `on_pre_compress` / `on_memory_write` / `on_session_switch`,而这些名字不在本 checkout 的 `VALID_HOOKS`(`hermes_cli/plugins.py:109`;它们其实是 `agent.memory_provider.MemoryProvider` 的方法名,不是插件钩子)
  - **交叉发现:**对 cashew 再跑目录准入门 `hermes plugins validate` 却 PASS——**doctor(真运行时)与 validate(准入)对钩子面的裁决不一致**,这 9 件在当前 checkout 上"准入过、doctor 不过",疑似目录清单与本 checkout 钩子注册表的契约漂移,值得上游跟进
- limbic 未装,doctor 记 skipped

## 6. 可测性分类(步骤 4,71 件全量)

口径:①本地可深测 = requires_env 空 + doctor 注册通过 + 无外部服务依赖;②需第三方 API key/服务 = requires_env 非空(任务禁发 key,装得上测不了);③装不上 = 安装器拒绝;另有两中间档如实单列。逐插件总表(装=落盘+metadata / doctor=注册加载 / 工具/钩子=声明式注册数):

| 插件 | 版本 | 装 | doctor | 工具/钩子 | 分类 |
|---|---|---|---|---|---|
| brethof-brain | 1.0.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| chronicle | 5.8.35 | ✅ | ✅ | 0/4 | local-deep-testable |
| cognition | 0.1.1 | ✅ | ✅ | 0/0 | local-deep-testable |
| ctx_checkpoint | 0.4.4 | ✅ | ✅ | 0/0 | local-deep-testable |
| deja-memory | 0.1.0 | ✅ | ✅ | 0/0 | local-deep-testable +external-binary(deja, brew deja-vu) not present |
| gbrain-plugin | 1.2.1 | ✅ | ✅ | 0/0 | local-deep-testable |
| gbrain-retrieval-reflex | 0.6.1 | ✅ | ✅ | 0/1 | local-deep-testable |
| hermes-dreaming | 3.3.4 | ✅ | ✅ | 0/0 | local-deep-testable |
| hermes-lcm-x | 0.28.1 | ✅ | ✅ | 0/4 | local-deep-testable |
| hermes-pubky | 0.2.3 | ✅ | ✅ | 0/0 | local-deep-testable |
| hermes-snapcompact | None | ✅ | ✅ | 0/0 | local-deep-testable |
| hindsight | 1.2.3 | ✅ | ✅ | 0/0 | local-deep-testable |
| holographic | 0.18.3 | ✅ | ✅ | 0/0 | local-deep-testable |
| hwiki | 1.0.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| hyatlas | 5.0.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| icarus | None | ✅ | ✅ | 16/4 | local-deep-testable |
| jev-memory-selector | None | ✅ | ✅ | 0/0 | local-deep-testable |
| mem-os | None | ✅ | ✅ | 0/0 | local-deep-testable |
| mem0 | 1.3.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| metronix | None | ✅ | ✅ | 0/0 | local-deep-testable |
| nachos | 0.5.4 | ✅ | ✅ | 0/0 | local-deep-testable |
| nexus | 0.22.32 | ✅ | ✅ | 0/1 | local-deep-testable |
| openltm | 2.19.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| openviking | 2.1.2 | ✅ | ✅ | 0/0 | local-deep-testable |
| optchat | 0.1.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| optmem-hermes | 0.3.3 | ✅ | ✅ | 0/0 | local-deep-testable |
| pastdotdev | 0.2.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| penny | 0.1.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| post-cortex | 0.2.0 | ✅ | ✅ | 0/0 | local-deep-testable |
| qdrant | 0.1.8 | ✅ | ✅ | 1/0 | local-deep-testable |
| qdrant-memory | 0.2.2 | ✅ | ✅ | 0/0 | local-deep-testable |
| reme | None | ✅ | ✅ | 0/0 | local-deep-testable |
| stack | 0.2.0 | ✅ | ✅ | 0/1 | local-deep-testable |
| sugar | None | ✅ | ✅ | 0/0 | local-deep-testable |
| tam | 0.1.1 | ✅ | ✅ | 0/0 | local-deep-testable |
| betterdb | 0.1.0 | ✅ | ❌ | Plugin registration failed: No module named 'betterdb_hermes | installed;registration-needs-pip-deps |
| birkin-mnemosyne | 0.2.3 | ✅ | ❌ | Plugin registration failed: No module named 'birkin_mnemosyn | installed;registration-needs-pip-deps |
| lancedb | None | ✅ | ❌ | Plugin registration failed: No module named 'yaml' | installed;registration-needs-pip-deps |
| lancedb-suite | 1.5.3 | ✅ | ❌ | Plugin registration failed: No module named 'numpy' | installed;registration-needs-pip-deps |
| lumberroom | 1.0.2 | ✅ | ❌ | Plugin registration failed: No module named 'filelock' | installed;registration-needs-pip-deps |
| memory-zvec | 1.3.2 | ✅ | ❌ | Plugin registration failed: No module named 'numpy' | installed;registration-needs-pip-deps |
| mnemostack | 1.0.3 | ✅ | ❌ | Plugin registration failed: No module named 'hermes_mnemosta | installed;registration-needs-pip-deps |
| mnemosyne | 0.7.3 | ✅ | ❌ | Plugin registration failed: No module named 'mnemosyne_herme | installed;registration-needs-pip-deps |
| agent_memory_es | 0.1.0 | ✅ | ✅ | 0/0 | needs-api-key/service:AMES_SERVICE_URL,AMES_SERVICE_KEY |
| agentplaybooks-memory | 0.3.0 | ✅ | ✅ | 0/0 | needs-api-key/service:AGENTPLAYBOOKS_MEMORY_API_KEY |
| bilinc | 1.0.0 | ✅ | ✅ | 0/0 | needs-api-key/service:BILINC_API_KEY |
| cashew | None | ✅ | ❌ | unknown hook 'on_pre_compress' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |
| cognee | 1.3.2 | ✅ | ❌ | unknown hook 'on_pre_compress' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |
| compartment | 4.10.0 | ✅ | ❌ | unknown hook 'on_session_switch' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |
| conxt | 0.1.1 | ✅ | ✅ | 0/0 | needs-api-key/service:CONXT_API_KEY |
| cortexlayer | 0.1.1 | ✅ | ❌ | Plugin registration failed: No module named 'cortexlayer' | needs-api-key/service:CORTEX_API_KEY |
| dexio | 0.1.0 | ✅ | ✅ | 0/0 | needs-api-key/service:DEXIO_API_KEY |
| entropicmem | 2.8.1 | ✅ | ❌ | unknown hook 'on_memory_write' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |
| excel_line | None | ✅ | ❌ | unknown hook 'on_memory_write' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |
| gbrain-pointer | 0.1.0 | ✅ | ✅ | 0/0 | needs-api-key/service:GBRAIN_MCP_CLIENT_ID,GBRAIN_MCP_CLIENT_SECRET |
| hicortex | 0.7.10 | ✅ | ✅ | 0/0 | needs-api-key/service:HICORTEX_URL,HICORTEX_AUTH_TOKEN |
| honcho | 1.0.0 | ✅ | ✅ | 0/0 | needs-api-key/service:HONCHO_API_KEY |
| hydradb | 1.0.1 | ✅ | ✅ | 0/0 | needs-api-key/service:HYDRADB_API_KEY,HYDRADB_DATABASE |
| intelligent_memory | None | ✅ | ❌ | unknown hook 'on_pre_compress' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |
| limbic | 0.9.1 | ❌ | — | skipped-not-installed | cannot-install:platform-gate-darwin |
| loreconvo | 0.10.19 | ✅ | ✅ | 0/0 | needs-api-key/service:LORECONVO_HERMES_PROJECT |
| memanto | 0.1.1 | ✅ | ❌ | unknown hook 'on_memory_write' in provides_hooks | needs-api-key/service:MOORCHEH_API_KEY |
| memex8 | 1.1.0 | ✅ | ❌ | unknown hook 'on_pre_compress' in provides_hooks | needs-api-key/service:MEMEX8_API_KEY |
| memobase | None | ✅ | ✅ | 0/0 | needs-api-key/service:MEMOBASE_API_KEY,MEMOBASE_BASE_URL |
| memoria | 0.1.1 | ✅ | ✅ | 0/0 | needs-api-key/service:MEMORIA_API_KEY |
| mindgraph | None | ✅ | ✅ | 0/0 | needs-api-key/service:name |
| sgme | 1.10.6 | ✅ | ✅ | 0/0 | needs-api-key/service:SGME_BASE_URL,SGME_AGENT_KEY,SGME_ADMIN_KEY,SGME_INJECT_MODE,SGME_INJECT_MAX_TOKENS,SGME_CAPTURE_ENABLED,SGME_REFINE_ON_END,SGME_HERMES_AGENT_ID,SGME_HTTP_TIMEOUT |
| supermemory | 1.0.1 | ✅ | ✅ | 0/0 | needs-api-key/service:SUPERMEMORY_API_KEY |
| unibaseio-membase | 0.1.0 | ✅ | ✅ | 0/0 | needs-api-key/service:MEMBASE_API_KEY |
| xmemo | 1.2.1 | ✅ | ✅ | 3/0 | needs-api-key/service:XMEMO_KEY |
| yantrikdb | 0.27.0 | ✅ | ❌ | unknown hook 'on_pre_compress' in provides_hooks | installed;doctor-fails-unknown-hooks(manifest drift) |

分类小计:**本地可深测 35**(其中 deja-memory 需本机装 `deja` 二进制,brew deja-vu,当前未装)、**需第三方 key/服务 20**、**装得上但注册需补 pip 依赖 8**、**装得上但 doctor 钩子漂移 7**、**装不上 1(limbic 平台门)**。注:cognee 目录 requires_env 为空但本地模式设置时要 LLM key(交互后置),归入钩子漂移档并加此注;qdrant/qdrant-memory/betterdb 等运行期需自备本地服务(qdrant/valkey 端点),归可深测档但深测需起服务。

## 7. 最小功能深测(步骤 5,2 例,全 PASS)

### 7.1 chronicle 5.8.35(零 pip 依赖,SQLite 本地优先)

驱动脚本 `/tmp/hermes-pluginlab/deeptest_chronicle.py`,沙盒内以插件包方式加载(`HERMES_HOME` 先设,真基类 `agent.memory_provider.MemoryProvider`):

1. 包加载 provider:OK,MRO 确认挂在真 MemoryProvider 基类下
2. 实例化 + is_available=True
3. `initialize("deeptest-session-001", hermes_home=/tmp/hermes-pluginlab)`:ChronicleCore/Scope 就绪
4. `sync_turn` 写入哨兵句("amber crane…77f3"):OK(文档承诺本地追加零网络;LLM 搭车抽取默认 OFF)
5. SQLite 落地核验:`/tmp/hermes-pluginlab/commons/db/chronicle/chronicle.db` 中 events.payload(2)/episodes.title/summary/curation_jobs/observed_fts 全文索引等 10 处命中哨兵 → **PASS**
6. 诚实注记:初始化时它探测了 localhost:1234/11434/8080 三个本机 embedding 端点(全部失败,自动进 DEGRADED 模式"不写向量")——仅本机回环探测、无外网模型调用、无 key;其清单亦披露默认拒绝 off-host embedding

另:chronicle 是本次唯一走完 enable 全链路的件(`hermes plugins enable chronicle --no-allow-tool-override` → "✓ Plugin chronicle enabled",依赖解析/安装步骤由 PM 在沙盒环境内完成)。

### 7.2 cognition 0.1.1(零 pip 依赖,正则抽取 + SQLite 队列)

驱动脚本 `/tmp/hermes-pluginlab/deeptest_cognition.py`:

1. 包加载 provider:OK(真基类同上)
2. `initialize`:DurablePushQueue(`<沙盒>/cognition/queue.db`)+ CommitLog 就绪
3. `extract_facts`:5 条正则模式(如 `I prefer…`/`remember that`)对哨兵句命中 1 条,原文完整
4. `on_session_end`:带 provenance 校验入队 OK
5. `_drain_due`(fetch-first merge)→ committed log 回读命中(1 条)
6. `cognition_search` 工具(声明式 schema 之一)以 "indigo thread" 查询,精确召回该事实 JSON → **PASS**

## 8. 泄漏与安全核验(全测程三关)

- 真实家 `~/.hermes`:全程只读。判定方法:前后快照 diff + **空转基线对照**——bot_relay/cron/gateway_state.json/kanban.db-*/state.db-wal 的持续 mtime 变动在我不跑任何命令的 60 秒里同样发生(归因:用户常驻 Hermes 网关守护进程 PID 28309 `hermes gateway run --external-supervisor` + Hermes.app,自 3:48AM 常驻),非本测写入
- 真实 venv/hermes-agent 源码树:`find -newer` 标记法核验 **零文件新增/改动**(排除 \_\_pycache\_\_)
- 网络面:仅 GitHub git clone(安装机制必需)与 hermes 官方源 uv sync(PM 首启);零模型 API 调用、零 key 外发

## 9. 复现

```bash
export H=~/.hermes/hermes-agent
mkdir -p /tmp/hermes-pluginlab
HERMES_HOME=/tmp/hermes-pluginlab /.venv/bin/hermes plugins install <name> --no-deps --no-enable   # 首发含 PM uv sync ~5min
HERMES_HOME=/tmp/hermes-pluginlab /.venv/bin/hermes plugins list --user --plain
HERMES_HOME=/tmp/hermes-pluginlab /.venv/bin/hermes plugins doctor <name> --ci
/.venv/bin/python /tmp/hermes-pluginlab/deeptest_chronicle.py   # 深测例 1
/.venv/bin/python /tmp/hermes-pluginlab/deeptest_cognition.py   # 深测例 2
```

全部原始证据存 `/tmp/hermes-pluginlab/`:`install_results.jsonl`(逐发安装记录)、`install-logs/`(70+ 发完整输出)、`ground_truth.json`(SHA 对齐矩阵)、`doctor_results.json`(注册矩阵)、`classification.json`(分类)、两深测脚本与 `commons/db/chronicle/`、`cognition/` 落地数据。
