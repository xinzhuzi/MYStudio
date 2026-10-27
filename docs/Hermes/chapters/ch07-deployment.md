# 第 7 章 本机部署实况与使用面

> **本章支撑的支柱**:P12(插件生态信任模型与记忆后端治理——§7.3 的 SHA 钉死/树外 provenance/迁移自愈全在本机落了地)、P11(内置层部署兑现——§7.1 的字符预算键与 §7.2 的 MEMORY.md/USER.md 实体)、P2/P4(库层实况——§7.2 的 WAL state.db 与 FTS 表清单)、P10(多 profile 配置面——§7.1/§7.5 的 profile 作用域键)。支柱编号沿用 `docs/Hermes/hermes-memory-report.md`。

**证据约定**:Hermes 源码引证相对检出门 `~/.hermes/hermes-agent/`(git commit `aa910ca036a9731d16cf51778edbde69230d9725`,2026-10-26,`git log -1` 亲核);配置/库/插件引证绝对路径(`~` = `/Users/zhengbingjin`)。本章全部探测为**只读**:SQLite 一律 `sqlite3 "file:…?mode=ro"` 或 `?immutable=1`(`memory_store.db`/`projects.db`/`shared-state.db`/`verification_evidence.db` 为 WAL+0600 权限,`mode=ro` 仍需建 shm 故报 `unable to open database file (14)`,改 `immutable=1` 成功)——**gateway 正在跑**(PID 28309,`ps -p 28309` 亲核,已运行 5h21m,`~/.hermes/gateway.pid` 记录 `hermes gateway run --external-supervisor`),禁任何写操作。密钥脱敏:凡 `api_key` 字段一律空串(类型 `str`,真实密钥住 `~/.hermes/.env`/钥匙串,本章不写值)。

---

## 7.1 `~/.hermes/config.yaml` 记忆相关配置段逐键解读

### 7.1.1 `memory:` 主块(config.yaml:511-519)

```yaml
memory:
  memory_enabled: true
  user_profile_enabled: true
  write_approval: false
  memory_char_limit: 2200
  user_char_limit: 1375
  nudge_interval: 10
  provider: holographic
  flush_min_turns: 6
```

逐键(读取者/默认值/语义):

| 键 | 本机值 | 读取者与默认 | 语义 |
|---|---|---|---|
| `memory_enabled` | `true` | `tools/memory_tool.py:305-307`(`get_builtin_memory_store_flags` 取 `memory_enabled`/`user_profile_enabled` 二元组,`is_truthy_value` 缺省 `True`);默认 `True`(`hermes_cli/config_defaults.py:1311`) | MEMORY.md 注入与 `memory` 工具 target=memory 的总开关;两个开关**同关**时 `check_memory_requirements()` 返回 False,`memory` 工具从模型面消失(`tools/memory_tool.py:313-319`) |
| `user_profile_enabled` | `true` | 同上;默认 `True`(`config_defaults.py:1312`) | USER.md(用户画像)注入开关 |
| `write_approval` | `false` | `tools/write_approval.py:38`(`CONFIG_KEY = "write_approval"`)+ `:44-45`(`write_approval_enabled` 读 `<subsystem>.write_approval`,**任何未设/非法值=门关**);默认 `False`(`config_defaults.py:1316`) | 记忆写审批门。`config_defaults.py:1313-1315` 注释:true 时前台写内联提示审批、后台 review fork 的写一律 staged(`/memory pending` / `approve <id>` / `reject <id>`)。本机关闭=直接写盘(§7.6 的 `_gate_or_stage` 路径仍会执行,只是 `decision.allow` 恒真) |
| `memory_char_limit` | `2200` | `tools/memory_tool_store.py:188`(MemoryStore 构造默认)与 `tools/memory_tool.py:56` 双处;`load_on_disk_store` 读配置覆盖(`tools/memory_tool.py:57`) | MEMORY.md 硬字符预算,超限拒写返回余量(支柱 P9)。默认注释「~800 tokens at 2.75 chars/token」(`config_defaults.py:1317`) |
| `user_char_limit` | `1375` | 同上;`config_defaults.py:1318` 注释「~500 tokens」 | USER.md 硬字符预算 |
| `nudge_interval` | `10` | `agent/turn_context.py:757-758`(会话启动从历史轮数取模补计数器)+ `:761-767`(`_tick_memory_nudge` 每用户轮 +1,达阈值返回 True 触发后台记忆审查 fork);默认 `10`(`config_defaults.py:1320`) | 每 N 个用户轮 fork 一次后台 review agent 判断「该不该存记忆」;`config_defaults.py:1319-1320` 注释「0 when an external provider auto-extracts」——**本机挂了 holographic 却仍设 10**:holographic 的 `auto_extract` 关着(config.yaml:838),内建 nudge 照跑,两者不冲突 |
| `provider` | `holographic` | 单外部 provider 槽;空串=纯内建(`config_defaults.py:1321-1323` 注释列出 bundled=retaindb/byterover 与 catalog 候选) | 激活的外部记忆 provider 名。装载治理见报告 §3.1;本机兑现见 §7.3 |
| `flush_min_turns` | `6` | **零读取者**——检出门与 holographic 插件全树 `grep -rn flush_min_turns` 均 0 命中;`config_defaults.py` 的 memory 块亦无此键 | 陈留键(历史版本遗留,当前版本静默忽略)。如实记录:配置存在≠生效,本章逐键都核了读取者 |

### 7.1.2 辅助模型块:`auxiliary.monitor` / `auxiliary.flush_memories` / `auxiliary.session_search` / `auxiliary.memory_query_rewrite`(config.yaml:362-380)

`~/.hermes/config.yaml:362-380` 有四个记忆字样的辅助 LLM 任务块,逐个核:

- **`auxiliary.monitor`**(config.yaml:362-367,`provider: auto`/`timeout: 60`):**与 agent 记忆无关**——默认注释写明「important-mail 0-10 scorer; high-volume, small model fine」(`hermes_cli/config_defaults.py:799`),是重要邮件打分器。记忆/技能后台审查 fork 用的键是 `auxiliary.background_review`(`agent/background_review.py:186-196`,`_background_review_task_config` 读 `cfg["auxiliary"]["background_review"]`),本机 config.yaml 未设、吃默认。
- **`auxiliary.flush_memories`**(config.yaml:368-373,`provider: auto`/`timeout: 30`):当前检出门**无默认键、无读取者**(全树 grep 仅 `agent/auxiliary_client.py:1402`/`:1469` 两处历史注释提到 `flush_memories()` 函数名)。陈留块。
- **`auxiliary.session_search`**(config.yaml:374-380,含 `max_concurrency: 3`):默认注释「session_search no longer uses an aux LLM (#27590); leftover auxiliary.session_search is ignored」(`config_defaults.py:775-776`)——`session_search` 现为零 LLM 的纯 FTS5 工具(§7.6),此块被显式忽略。
- **`auxiliary.memory_query_rewrite`**:本机 config.yaml **未设**;默认 `_aux(8, reasoning_effort=False)`(`config_defaults.py:787`,8 秒超时);读取者是 `plugins/memory/query_rewrite.py:16`(`TASK_KEY = "memory_query_rewrite"`)——即报告 §3.5 所述「留给 catalog 第三方 provider 的公共件」,bundled provider 零调用方。

### 7.1.3 其余记忆相关键

- **`display.memory_notifications: true`**(config.yaml:397):记忆更新通知;取值 `"off"|"on"|"verbose"`(`agent/agent_init.py:2168` 注释,默认 `"on"`,`config_defaults.py:861`)。控制「🧠 已召回 N 条」之类指示的用户可见面(召回指示本体在 `agent/turn_context.py:937`)。
- **`logging.memory_monitor:`**(config.yaml:697-699,`enabled: true`/`interval_seconds: 300`):**配置存在但无代码读取者**——全树 grep `memory_monitor` 只命中 `gateway/memory_monitor.py` 自身与测试;`start_memory_monitoring` 默认值恰是 300.0s(`gateway/memory_monitor.py:67`)但无人调用(§7.4 详述)。这是「承诺与实况的差距」项,如实记录。
- **`platform_toolsets.cli`**(config.yaml:782-817):cli 平台工具集白名单,其中 `- memory` 在 config.yaml:796——`memory` 是一个 toolset 名,内建 `memory` 工具注册时挂的就是它(`tools/memory_tool.py:469-477` `registry.register(name="memory", toolset="memory", …)`),外部 provider 工具也靠它放行(`agent/memory_manager_tools.py:27-43`,`memory_provider_tools_enabled` 检查 `"memory" in enabled_toolsets`)。
- **`plugins:` 块**(config.yaml:830-843):

```yaml
plugins:
  enabled:
    - holographic        # config.yaml:832 —— 唯一记忆件
    - homeassistant
    - orca-status
    - rtk-rewrite
    - spotify
  hermes-memory-store:   # config.yaml:837 —— holographic 的配置节(沿用其原包名)
    auto_extract: false
    db_path: $HERMES_HOME/memory_store.db
    default_trust: 0.5
    min_trust_threshold: 0.3
    temporal_decay_half_life: 0
```

`hermes-memory-store` 节的读取者在插件侧:`~/.hermes/plugins/holographic/__init__.py:274`(`cfg_get(load_config_readonly(), "plugins", "hermes-memory-store", default={})`),写回走 `save_config({"plugins": {"hermes-memory-store": values}}, merge_existing=True)`(`__init__.py:445`)。插件头注给出**全量键与出厂默认**(`__init__.py:3-9`):`db_path`($HERMES_HOME/memory_store.db)、`auto_extract`(false)、`default_trust`(0.5)、`min_trust_threshold`(0.3)、`temporal_decay_half_life`(0)、`hrr_dim`(1024)、`hrr_weight`(0.3)、`mirror_memory_writes`(false)、`prefetch_min_coverage`(0.3)、`prefetch_repeat_turns`(6)、`recall_indicator`(true)、`recall_source`("off"|"short")、`cron_writes`(true)、`scope`(profile|user|chat|thread)。本机只显式设了前 5 个,其余吃出厂默认。**注意插件目录名(holographic)≠配置节名(hermes-memory-store)**——插件原是 dusterbloom 的 PR #2351(`__init__.py:2`),目录改名后配置节保留旧包名以免老配置失联。

- **`_left_core_installed:`**(config.yaml:884-886):当前值 `[- homeassistant, - spotify]`。语义:「一个 home 至多自动装一次」的记账(`hermes_cli/left_core_migration.py:16-17`,"A home gets the plugin automatically at most once (`_left_core_installed` in its config.yaml)";`:810` `_INSTALLED_KEY = "_left_core_installed"`),装过即记名、之后 `hermes plugins remove` 是用户自己的选择且生效。**如实记录一处与报告 §3.4 的出入**:报告称 holographic 迁移链「config.yaml:884-885 `_left_core_installed` 记录」,但今日盘上该列表无 holographic——结合 §7.3 的 `installed_at: 2026-10-14T22:52:30Z`,本机的 holographic 经 catalog 正常安装路径落位(名字在 `_LEFT_CORE` 八家名单内,享受无人值守同意),`_left_core_installed` 记账的是另两件;两说不矛盾,但「自动迁移装成」在本机的直接物证是 §7.3 的 `.hermes-catalog.json` 与空 bundled 目录,而非该列表。

### 7.1.4 脱敏面说明(本章口径)

记忆相关配置段**不含任何密钥值**:`auxiliary.monitor`/`auxiliary.flush_memories`/`auxiliary.session_search` 各块的 `api_key` 一律空串(config.yaml:366/371/376,类型 `str`);holographic 配置节(837-842)无任何凭据字段(本机零依赖本地件)。真实密钥按 §7.5.2 的向导路径落 `~/.hermes/.env`(经 `save_env_value` 的 0o600 原子写)或 macOS 钥匙串。本章全文未引用任何密钥值。

---

## 7.2 本机库只读探查(schema/索引/触发器)

`~/.hermes/` 根下与记忆相关的库四个 + 会话主库,逐一 `mode=ro`/`immutable=1` 探查:

### 7.2.1 `~/.hermes/hermes.db` ——空文件(0 字节)

`ls -la`:0 字节,mtime 2026-10-05。`sqlite_master` 查询返回空。**它不是任何记忆载体**——记忆数据在 `memories/*.md`(文件)与 `memory_store.db`(外部 provider);会话在 `state.db`。列此条是为堵住「hermes.db 里存了什么」的想当然。

### 7.2.2 `~/.hermes/state.db` ——会话主库(支柱 P1/P2/P4 的落地面)

`PRAGMA journal_mode` → `wal`(mode=ro 亲查)。体量 724,901,888 字节(≈691 MiB)+ 5,586,752 字节 WAL。计数:**998 sessions / 58,645 messages / 184 条 `api_content` 非空**(P1 边车在本机生产留痕;`messages` 表含 `api_content` 列,schema 见下)。

表清单(`SELECT name FROM sqlite_master WHERE type='table'`,节选记忆相关):`sessions`、`messages`、`messages_fts`、`messages_fts_config/content/data/docsize/idx`、`messages_fts_trigram` 及同套五件、`schema_version`、`runtime_epoch`、`session_admissions`、`session_turn_leases`、`gateway_heartbeats` 等。**没有 `messages_fts_cjk` 表**——CJK 双字分词扩展(P4)在本机按设计降级(unicode61+trigram 仍在,检索三级降级链的 cjk 一级缺失)。

`messages` 表核心列(mode=ro `.schema` 摘录,截选):

```sql
CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT,
    ...
    timestamp REAL NOT NULL,
...
, "api_content" TEXT, "display_kind" TEXT, ... "message_uid" TEXT, ...)
```

`api_content` 即 P1 的注入边车列(写路 `hermes_state_api_content.py:36`/`:65` 的 `UPDATE messages SET api_content`)。两个 FTS 虚表:

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(content)
CREATE VIRTUAL TABLE messages_fts_trigram USING fts5(content, tokenize='trigram')
```

`messages_fts` 行数 58,645(与 messages 等量,触发器同步在位)。

`sessions` 表(同库)是 P10 多 profile 归属的落地面之一——含 `profile_name` 列及 `handoff_state/handoff_platform` 交接三元组(mode=ro `.schema` 截选):

```sql
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    ...
, "handoff_state" TEXT, "handoff_platform" TEXT, "handoff_error" TEXT,
  "cwd" TEXT, ..., "profile_name" TEXT, ..., "pinned" INTEGER NOT NULL DEFAULT 0, ...)
```

### 7.2.3 `~/.hermes/memory_store.db` ——holographic 双时间版本化事实库(支柱 P12 落地的实体)

0600 权限、282,624 字节、mtime 2026-10-27 05:09(**当日仍在写**——gateway 活库,故探查用 `immutable=1`,不碰 shm/wal)。

对象清单:`sqlite_master` 共 9 张普通表 + 2 个 FTS5 虚表 + **6 个触发器** + 8 个具名索引。核心两表 schema(`.schema` 全文摘录,截选):

```sql
CREATE TABLE facts (
    fact_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content         TEXT NOT NULL UNIQUE,
    category        TEXT DEFAULT 'general',
    tags            TEXT DEFAULT '',
    trust_score     REAL DEFAULT 0.5,
    retrieval_count INTEGER DEFAULT 0,
    helpful_count   INTEGER DEFAULT 0,
    ...
    hrr_vector      BLOB
);
```

```sql
CREATE TABLE fact_versions (
    version_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    fact_id        INTEGER NOT NULL,
    seq            INTEGER NOT NULL,
    content        TEXT NOT NULL,
    ...
    valid_from     TEXT,
    valid_to       TEXT,
    valid_to_exact INTEGER NOT NULL DEFAULT 1,
    status         TEXT NOT NULL DEFAULT 'current',
    supersedes     INTEGER,
    superseded_by  INTEGER,
    trust_score    REAL,
    src_via        TEXT,   -- + src_platform/src_chat_id/src_thread_id/
    ...                --   src_session_id/src_user_id/src_user_name 八列来源溯源
    UNIQUE (fact_id, seq)
);
```

**版本链不变量**由部分唯一索引钉死:`CREATE UNIQUE INDEX idx_versions_current ON fact_versions(fact_id) WHERE status = 'current'`——每事实至多一个 current 版本,由索引而非应用层纪律保证。FTS 同步走外部内容表 + 六触发器(`facts_ai/ad/au`、`fact_versions_ai/ad/au`,标准 insert/delete/reinsert 三件套;虚表定义 `USING fts5(content, tags, content=facts, content_rowid=fact_id)` 的**外部内容表**模式,索引不重复存正文)。其余表:`entities`(含 `name_key` 附加列)、`entity_aliases`(alias_key 主键)、`fact_entities`(复合主键 `(fact_id, entity_id)` 二元关联)、`memory_banks`(bank_name 唯一 + `vector BLOB`/`dim`)、`forgotten`(墓碑:`fact_id` 主键 + `digests`,配合 §7.6 的 forget 动作)、`meta`(键值)。

计数与 meta(immutable 亲查):**facts 15 / fact_versions 15 / entities 6 / entity_aliases 0 / fact_entities 7 / memory_banks 2 / forgotten 0**;`meta` 四行:`hrr_dim=1024`、`tombstone_key=aec51ff3…`(截断)、`history_schema=1`、`schema_version=2`。规模小但结构完备——生产运转中的活库。

### 7.2.4 其余库(顺带核明,与记忆无关)

`kanban.db`(114,688 字节,WAL 活库):tasks/task_comments/task_events/task_links/task_runs/task_attachments/kanban_notify_subs。`projects.db`(45,056):projects/project_folders/discovered_repos/project_meta。`shared-state.db`(155,648):hosted_room_* 系列表。`verification_evidence.db`(32,768):verification_events/verification_state/meta。后三者与记忆子系统零表交集。

### 7.2.5 `~/.hermes/memories/` ——内建层实体(支柱 P11)

`MEMORY.md`(3,889 字节,mtime 2026-10-03)+ `MEMORY.md.lock`(0 字节锁文件)+ `USER.md`(2,895 字节)+ `USER.md.lock`。`head` 亲核:两文件均 `§` 分隔条目格式;MEMORY.md 首条即项目坐标「当前项目 > MA: …」,后续条目为审查经验/铁律类高信号笔记;USER.md 为「基本信息/项目上下文/工作偏好」分节条目。3,889 < 2,200?否——**预算是字符数上限,3,889 字节文件含 UTF-8 中文(一字 3 字节),实际字符数在预算内**(store 加载时按字符计;此处如实报文件字节数,不做字符数推断)。

---

## 7.3 `~/.hermes/plugins` 实际装了哪些记忆件、版本与 provenance

目录清单:`holographic`、`homeassistant`、`orca-status`、`spotify`、`hermes-achievements`(后四者与记忆无关)。**唯一记忆件 = holographic**。

三重 provenance 物证(支柱 P12 的「SHA 钉死 + 树外 provenance」在本机的落地):

1. **树内目录级**:`~/.hermes/plugins/holographic/.hermes-catalog.json` 全文:

```json
{
  "catalog_name": "holographic",
  "repo": "https://github.com/itpartypattaya/hermes-plugin-holographic",
  "sha": "a6d009315bc72a7c4e68d6a0e60a6eeed68080fd",
  "tier": "community",
  "installed_at": "2026-10-14T22:52:30Z"
}
```

2. **树外账本**:`~/.hermes/plugins/.install-metadata.json`(装在插件树**外**,插件自身不可伪造——正是 `hermes_cli/plugins_cmd_install.py:376-384` 的「provenance lives OUTSIDE the plugin tree」设计):`holographic` 条目含 `pin`/`sha`/`revision` 同值 `a6d00931…`、`pinned: true`、`tier: community`。对照同文件 `homeassistant`(official,`ba30cb0c…`)与 `spotify`(official,`ad20043d…`)——tier 语义分级清晰。
3. **manifest**:`~/.hermes/plugins/holographic/plugin.yaml`:`name: holographic / version: 0.13.0 / description: "Holographic memory — local SQLite fact store with FTS5 search, trust scoring, and HRR-based compositional retrieval."`;`pyproject.toml` 同版本 `0.13.0`,依赖仅 `numpy>=1.26,<3` 与 `snowballstemmer>=2.2,<4`(注释说明上界是 Hermes 精确钉依赖所致)。

迁移链物证:bundled 侧 `~/.hermes/hermes-agent/plugins/memory/` 现存 `byterover/`、`retaindb/`、`query_rewrite.py`、`config_schema.py` 与**空目录 `holographic/`(0 文件)**——git 删除后残留的空壳,是「holographic 曾住内核、后被拆出」的现场痕迹;`hermes_cli/memory_provider_migration.py:36` 的 `_LEFT_CORE = frozenset({"hindsight","honcho","mem0","supermemory","openviking","retaindb","byterover","holographic"})` 八家名单含 holographic。

**版本与安全面补注**:CHANGELOG 首条即本机版本(`~/.hermes/plugins/holographic/CHANGELOG.md:3-12`,2026-10-13 发布 0.13.0):0.13.0 的主打特性恰是**出口侧复检**——「Recall checks a fact again on the way out」,写入时的过滤器(聊天角色/工具调用标记、指令式措辞、带值凭据、不可见字符、图片)在**召回时再跑一遍**,命中即不注入本轮且每进程记一次日志;`fact_store` 的 search/list/history 仍展示该条(模型被问到就能改/忘)。这与支柱 P8 的「加载侧 _sanitize 占位」是同一威胁模型在插件层的镜像实现——内建层防 MEMORY.md 中毒,holographic 防 facts 表中毒,两层各自守自己的注入面。写动作的权威清单在 `~/.hermes/plugins/holographic/__init__.py:286`:`_WRITE_ACTIONS = frozenset({"add","update","remove","alias","change","end","correct","revert","forget"})`——九个动作过 §7.6.3 的写权限闸,其余十二个 action 只读。

---

## 7.4 gateway/memory_monitor 与 memory_status:指标、阈值与判定

**先正名**(承接报告 §3.4 的「同名陷阱」):这两个模块监控的是**进程/系统 RAM**,不是 agent 记忆。它们与本手册的记忆子系统唯一交集是名字。

### 7.4.1 `gateway/memory_monitor.py`(111 行)——周期性 RSS 日志线程

指标(一条 `[MEMORY]` 日志行,`memory_monitor.py:50-55`):`rss=<MB>`(进程 RSS **高水位**——`resource.getrusage(RUSAGE_SELF).ru_maxrss`,macOS 除以 1MiB、Linux 除以 1024,`memory_monitor.py:40-44`;psutil 为 Windows 兜底)、`gc=`(三元组 `gc.get_count()`)、`threads=`(`threading.active_count()`)、`uptime=<s>`。判定逻辑极简:无阈值、无告警,纯时间序列留给人 grep 趋势。节流参数:`interval_seconds=300.0` 默认(`:67`),daemon 线程名 `gateway-memory-monitor`(`:85-87`),启停各打一条 baseline/shutdown 快照(`:81`/`:99`);RSS 读不出时 warn 一次并拒绝启动(`:74-78`)。**本机实况:`start_memory_monitoring` 全仓无调用者**(grep 仅命中定义与 `tests/gateway/test_memory_monitor.py`),`~/.hermes/logs/gateway.log` 与 `agent.log` 的 `[MEMORY]` 行计数=0(`grep -c` 亲核)——「未接线」而非「坏了」;config.yaml:697-699 的 `logging.memory_monitor.enabled=true` 因此不生效(§7.1.3)。

### 7.4.2 `gateway/memory_status.py`(112 行)——`/api/status` 的 memory 块

读侧设计:**不采样,只读 gateway 已持久化的两个文件**(30s 心跳 `state/gateway.heartbeat` + 生命周期哨兵),零 IPC(`memory_status.py:1-8` docstring);`/api/status` 无鉴权故只出粗粒度 MB 数/枚举/布尔(`:5-6`)。

**压力分级阈值**(`memory_status.py:18-27`,常量原文):

```python
_CRITICAL_AVAILABLE_KIB = 64 * 1024   # < 64 MiB available
_CRITICAL_AVAILABLE_FRACTION = 0.05   # < 5% of MemTotal
_ELEVATED_AVAILABLE_KIB = 128 * 1024  # < 128 MiB available
_ELEVATED_AVAILABLE_FRACTION = 0.15   # < 15% of MemTotal
```

判定 `classify_pressure`(`:50-60`):MemAvailable 低于任一门槛(绝对值**或**占比,先 critical 后 elevated,`_PRESSURE_TIERS` 次序敏感)即 `critical`/`elevated`,否则 `ok`;**样本缺失/畸形一律 `unknown`**——docstring 原话「"could not read it" must never read as "fine"」(`:51-52`)。新鲜度:`_HEARTBEAT_FRESH_TTL_S = 150.0`(`:31-32`,写侧 30s 节拍,150s 容一次卡顿)——过期样本数字照报(`sampled_at` 标时间)但 pressure 恒 `unknown`,防死网关的最后一口气的「critical」横幅永挂(`:98-101` 注释)。

输出九字段(`collect_memory_status`,`:83-110`):`pressure`/`gateway_rss_mb`/`system_total_mb`/`system_available_mb`/`swap_used_mb`/`sampled_at`/`last_boot_unclean`/`last_boot_suspected_oom`/`boot_id`(哨兵 `started_at`,仪表盘按它区分两次 OOM 重启的横幅消解,`:89-90`)。critical 同时是生命周期账本的 OOM 嫌疑启发式——活着时就预警,死了才好归因(`:14-17` 注释)。

接线与复用:`hermes_cli/web_routers/status.py:458` 把 `collect_memory_status` 挂进 `/api/status` 的 advisory 块(`:452-464` `_advisory_pressure`,注释明确 pressure 是「advisory, not a liveness verdict」,不翻 `overall` 以免误呼叫可用性巡检);`hermes_cli/kanban_db_dispatch.py:1965-1976` 复用同一 `classify_pressure` 判 kanban 侧内存压力,保证「critical」语义两端一致。

**本机实况(macOS)**:心跳写侧的内存采样 `sample_memory()` 是 `/proc` 专属——`gateway/lifecycle_ledger.py:64-66` docstring「Cheap /proc snapshot (KiB)… Linux-only (`{}` elsewhere)」。盘上 `~/.hermes/state/gateway.heartbeat` 亲核:有 `pid/updated_at/monotonic/start_time/loop_tick_socket` 键、**无 `mem` 键** → `collect_memory_status` 读不到样本 → `/api/status` 的 `memory.pressure` 在本机恒 `unknown`。设计语义(读不到绝不冒充没问题)是对的,平台差距如实记录。

---

## 7.5 CLI 记忆命令面

### 7.5.1 `hermes memory` 子命令树(`hermes_cli/subcommands/memory.py`,34 行全读完)

```
hermes memory setup [provider]   # 交互式 provider 选择与配置;带 provider 参数跳过选择器
hermes memory status             # 显示当前记忆 provider 配置
hermes memory off                # 停用外部 provider(纯内建)
hermes memory reset [--target all|memory|user] [-y]   # 抹除内建记忆(MEMORY.md/USER.md)
```

解析器描述里写死了三条契约(`memory.py:14-19`):「Only one external provider can be active at a time」「Built-in memory (MEMORY.md/USER.md) is always active」、bundled=retaindb/byterover 而 catalog 件(honcho/hindsight/supermemory/mem0/openviking/holographic)走 `hermes plugins install`。路由在 `hermes_cli/main_agent_cmds.py:60-67`:`off`/`reset` 就地处理,其余(`setup`/`status`)转 `hermes_cli/memory_setup.py:450-462` 的 `memory_command`。

### 7.5.2 `memory_setup.py`(462 行)——setup 向导与 status 面板

- **provider 发现**:`_get_available_providers()`(`memory_setup.py:120-146`)经 `plugins.memory.discover_memory_providers` 枚举,按 `get_config_schema()` 的 secret/非 secret 字段组合给出提示标签(`requires API key`/`local`/`no setup needed`)。
- **`hermes memory setup` 流程**(`cmd_setup`,`:258-328`):curses 单选列表(默认选中「Built-in only」)→ 选 provider → `_install_dependencies`(`:95-115`:pip 依赖经 `pm.sync_venv` 准备(`:99` 调 `prepare_memory_provider_dependencies`),`external_dependencies` 逐项跑 manifest 里的 `check` 命令(`:106-112`)、失败时给出 `install` 命令)→ `post_setup` 钩子若存在则由 provider 接管连接测试与激活(`:170-180`)→ 否则走通用 schema 表单 `_prompt_schema_fields`(`:204-255`:支持 `choices` 单选、`secret` 掩码输入(已设环境变量时显示 `…后4位`)、`when` 条件显隐、`default_from` 动态默认)→ 写 `memory.provider` 激活键 + `provider.save_config` + **密钥经 `_write_env_vars`**(`:330-361`:逐键走 `hermes_cli.config.save_env_value` 的统一闸——`_ENV_VAR_NAME_RE` 标识符校验、`_ENV_VAR_NAME_DENYLIST`(拒 `LD_PRELOAD`/`PYTHONPATH`/`HERMES_HOME` 等)、CRLF 剥离、0o600 原子写,单键校验失败跳过不炸整批)。
- **`hermes memory status` 输出面**(`cmd_status`,`:364-436`):内建三开关(memory injection/user profile/memory tool,后者经 `_get_platform_tools`+`check_memory_requirements` 双闸)、当前 provider 名、provider 配置节(经 `get_status_config` 脱敏视图)、插件安装态(`installed ✓`/`not available ✗` 并列出缺失的 `env_var` 及其获取 URL,附注「systemd/gateway 服务不继承 ~/.hermes/.env」)、`parked_provider_notice` 停用提示、全部已装 provider 清单(活动者标 `← active`)。
- **`hermes memory setup <name>` 直配**(`cmd_setup_provider`,`:182-202`):找不到本地实体时给 catalog 安装提示(`_catalog_install_hint` → `memory_provider_migration.py:110` 的 `catalog_install_hint(name, category="memory")`)。

### 7.5.3 `memory_oauth.py`(75 行)——provider OAuth 的 HTTP 面

FastAPI 路由挂 `/api/memory/providers`(`memory_oauth.py:12`):`POST /{provider}/oauth/start`(浏览器+回环监听的零 CLI 流程,后台起、立即返回)与 `GET /{provider}/oauth/status`(轮询 `idle|pending|connected|error`,`:60-64`)。`_resolve_flow`(`:16-25`)动态导入 provider 的 `oauth_flow` 子模块,无此模块即 404「does not support OAuth connect」;`_scope_to_profile`(`:27-50`)按 `?profile=` 参数把配置解析临时切到指定 profile 的 home(`set_hermes_home_override` token 式进出),使流程的 eager 路径解析落到该 profile 的配置文件——多 profile 部署(支柱 P10)在 OAuth 面上的兑现。

### 7.5.4 `memory_provider_migration.py`(325 行)——left-core 迁移自愈

头部 docstring(`memory_provider_migration.py:1-19`)给全设计:两个钩子(`hermes update` 逐 profile venv 重建后跑;agent init 发现配置的 provider 找不到时每进程一次)→ 走正常 catalog 安装路径(kill list、依赖约束、enable),**绝无自定义源**;结局四态(installed/refused/failed/absent)必达用户可见渠道,原话「never only ``agent.log``: a provider that silently stays missing is lost memory」(`:17-18`)。关键常量与函数(行号亲核):

- `_LEFT_CORE` 八家 frozenset(`:36`)——无人值守同意只覆盖这八家:用户当年选内建时已接受过其依赖(`:34-35` 注释);名单外(同步来的配置、克隆的 profile)仍需显式安装。
- 重试退避:`STARTUP_RETRY_SECONDS = 3600.0`、`STARTUP_RETRY_MAX_SECONDS = 7*24*3600.0`(`:41-42`),`_failed_recently` 按 `min(3600 * 2**(failures-1), 7天)` 闸(`:75`)——注释解释动机:平窗会让永远装不上的 home(版本门/root 属主 plugins 目录/无 GitHub 路由)每小时失败一次到永远,指数窗让离线笔记本一小时内仍能拿到插件(`:38-40`)。
- 失败记账:`cache/left-core-<plugin>.failed` 戳文件,内容为连续失败计数(`_failure_stamp`/`_note_failure`,`:47-66`);成功即删戳、后续失败从一小时重新起跳(`_note_success`,`:78-79`)。

本机对应物:`~/.hermes/cache/` 下 `ls | grep left-core` 亲查**无任何 `left-core-*.failed` 戳**——迁移当前无未决失败,与 §7.3 holographic 已成功落位互证。

### 7.5.5 `hermes memory off` / `hermes memory reset` 的实现细节(`main_agent_cmds.py:11-58`)

`off`(`main_agent_cmds.py:11-19`)极简:把 `memory.provider` 置空串存盘,打印「✓ Memory provider: built-in only」——纯配置动作,不动插件、不动数据。`reset`(`:22-58`)是**物理删除**而非清空:按 `--target` 收集 `memories/MEMORY.md`/`USER.md` 中存在者,逐文件打印字节数,无 `-y` 时要求输入字面 `yes`(EOFError/KeyboardInterrupt 均走 Cancelled 分支),然后 `unlink()`:

```python
    existing = [(f, desc) for f, desc in files_to_reset if (mem_dir / f).exists()]
    ...
    for f, desc in existing:
        (mem_dir / f).unlink()
        print(f"  ✓ Deleted {f} ({desc})")
    print("\n  Memory reset complete. New sessions will start with a blank slate.")
```

(`main_agent_cmds.py:30-31`/`:52-55`,截选。)收尾提示「New sessions will start with a blank slate」与 P11 的冻结快照语义一致:删除落盘,但**本会话系统提示里的快照不变**,新会话才见空白。

---

## 7.6 模型侧视角:agent 运行时实际可用的记忆工具清单

从代码还原(工具 schema 即模型在每轮请求里看到的 JSON Schema;本机配置下四个工具全部在面):

### 7.6.1 `memory` ——内建精选层写工具(恒在)

注册:`registry.register(name="memory", toolset="memory", schema=MEMORY_SCHEMA, check_fn=check_memory_requirements, dynamic_schema_overrides=_build_memory_schema_overrides)`(`tools/memory_tool.py:468-477`)。schema(`tools/memory_tool.py:373-440`,节选):

```python
MEMORY_SCHEMA = {
    "name": "memory",
    "description": ("Save durable facts to persistent memory that survive across sessions. "
        "…make ALL your changes to one target in ONE call via an 'operations' array…"
        "the char limit is checked only on the FINAL result…"),
    "parameters": {
        "type": "object",
        "properties": {
            "target": {"type": "string", "enum": ["memory", "user"], ...},
            "operations": {"type": "array", "items": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["add", "patch", "remove"]},
                    "content": {"type": "string", ...},
                    "old_text": {"type": "string", ...}},
                "required": ["action"], "additionalProperties": False}},
        },
        "required": ["target", "operations"]}}
```

面收缩机制:`check_fn` 快照两开关进 ContextVar(`tools/memory_tool.py:34-36`),`_build_memory_schema_overrides`(`:448-462`)据此**动态收窄 target enum**(关掉 user 时只剩 `["memory"]` 并改写描述文本)——可用性与 schema 单次定义 pass 内一致,防两开关同关时工具仍在面。handler 兼容顶层单操作旧形状(`:398-400` 注释「models drift and older transcripts replay them」)。内联执行器 `agent/inline_tool_executors.py:142`(`_memory`)→ 审批门 `_gate_or_stage`(`tools/memory_tool.py:86-107`:block/stage/放行三分;staged 时 `_pin_matched_entries` 把锁下完整条目 pin 进 payload,支柱 P7)→ 成功后 `notify_memory_tool_write` 镜像给外部 provider(`inline_tool_executors.py:153-158`)。

### 7.6.2 `session_search` ——会话历史检索工具(恒在)

schema 在 `tools/session_search_tool.py:663-720+`。四形态由参数组合分派(`_dispatch`,`:580-599`):`query`=发现(FTS5 top-N 会话,首名全量注水)/`session_id+around_message_id`=锚点滚动(窗口消息)/`session_id`=整读(亦是解析 `@session:<profile>/<id>` 链接的路径)/无参=最近会话浏览。参数面:`query`、`limit`(默认 3,**clamp 1-10**,`session_search_tool.py:585`)、`sort`(newest/oldest 叠加时间偏置)、`detail`(adaptive/full)、`role_filter`、`after`/`before`、`session_id`/`around_message_id`/`window`、`profile`(**跨 profile 只读打开对方 state.db**,`:621-627`)、`exclude_session_ids`。描述原文明示「Results are actual DB messages, no LLM」与「Searches conversation history ONLY … never conclude 'not found' from history alone」。开库永远 `read_only=True`(主库 `:638`,profile 库 `:444`)。

### 7.6.3 `fact_store` + `fact_feedback` ——holographic 注册的两工具(随 provider 在面)

`~/.hermes/plugins/holographic/__init__.py:741-743` `get_tool_schemas` 返回 `[FACT_STORE_SCHEMA, FACT_FEEDBACK_SCHEMA]`,经 `agent/memory_manager.py:569-580` 注入模型工具面。`fact_store` schema(`__init__.py:42-104`,节选):

```python
FACT_STORE_SCHEMA = {
    "name": "fact_store",
    "description": ("Long-term facts (local store). Use with the memory tool: memory = "
        "always-on notes, fact_store = recall on demand.\n"
        "• search {query, as_of?} … as_of=YYYY-MM-DD: what held on that date.\n"
        "• change {fact_id, content, valid_from?} — it changed …\n"
        "  end / correct / revert / forget {fact_id} — the user asks to forget it: "
        "deleted for good, history included…"),
    "parameters": {...,
        "action": {"type": "string", "enum": ["add", "search", "probe", "related",
            "reason", "contradict", "update", "change", "end", "correct", "revert",
            "forget", "history", "remove", "list", "stats", "export", "review",
            "entities", "alias", "enrich"]},
        "fact_id": {"type": "integer", ...},
        "keywords": {"type": "array", "items": {"type": "string"}, ...},
        "min_trust": {"type": "number", "description": "Minimum trust filter (default: 0.3)."},
        "limit": {"type": "integer", "description": "Max results (default: 10, at most 100)."}},
    "required": ["action"]}
```

**21 个 action**:检索 5(search/probe/related/reason/contradict)+ 版本链 6(change/end/correct/revert/history/superseded 别名 remove)+ 治理 9(update/forget/list/stats/export/review/entities/alias/enrich)+ 写入 1(add)。另有时间旅行三**参数** as_of/valid_from/valid_to(参数面,不占 action 计数)。`fact_feedback` 极简:`action ∈ {helpful, unhelpful}` + `fact_id`,描述「This trains the memory — good facts rise, bad facts sink」(`__init__.py:106-112`)——反馈回路直连 §7.2.3 的 `facts.helpful_count/trust_score` 列。

写权限闸:`handle_tool_call`(`__init__.py:745-753`)在 `self._tool_writable` 为 False(subagent/flush/cron 且 `cron_writes` off)时拒写,原话「only the main agent writes facts」——判据是 `tool_name == "fact_feedback"` 或 `args.get("action") in _WRITE_ACTIONS`(`__init__.py:286` 九动作清单),后台 fork 上下文读可以、写不行,与内建层的无人值守审批门(§7.1.1)同一哲学。工具分派本身是静态映射表 `_TOOL_HANDLERS`(`__init__.py:1127`),入口统一套 `@_serialized` 串行化装饰器(`:746`)防并发写竞争;异常面区分 `DuplicateContentError`(内容 UNIQUE 冲突,§7.2.3 的 `content TEXT NOT NULL UNIQUE` 在此兑现)与 `KeyError`(缺必填参数,返回「Missing required argument」)。

### 7.6.4 工具面的总开关链

本机实际生效链:`platform_toolsets.cli` 含 `memory`(config.yaml:796)→ 内建 `memory` 工具随 toolset 在面(registry 注册即挂 memory toolset)→ 外部 provider 工具经 `memory_provider_tools_enabled`(`agent/memory_manager_tools.py:27-43`)检查同 toolset 放行 → holographic 的两工具注入。即:**四个记忆工具(memory/session_search/fact_store/fact_feedback)在 cli 平台全量在面**,这是模型侧每轮可调的完整记忆动作空间。

---

## 7.7 小结:本机部署的一句话画像

一台 macOS、单 profile、gateway 常驻(external-supervisor 模式)的**双层记忆生产部署**:内建层 MEMORY.md(3.9KB)/USER.md(2.9KB)按 2200/1375 字符预算注入系统提示,写审批门关、nudge 每 10 轮自查;外部层是 community 档 holographic v0.13.0(SHA 钉死 `a6d00931…`,2026-10-14 装),驱动 282KB 双时间版本化 SQLite 事实库(15 facts/15 versions/6 entities/1024 维 HRR,当日仍在写);会话层 691MB WAL state.db(998 会话/58,645 消息/184 条 api_content 边车)以 unicode61+trigram 双 FTS 可查(CJK 增强未构建,按设计降级)。使用面四个记忆工具全量对模型开放。配置里三处陈留(`flush_min_turns`/`auxiliary.flush_memories`/`logging.memory_monitor`)如实点名——它们存在但不生效,复用设计时应当引以为鉴:**每个配置键都要有可指认的读取者,否则就是给运维埋假开关**。
