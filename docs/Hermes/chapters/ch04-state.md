# 第四章 会话状态库工程:state.db 的守卫、边车、检索与自愈

> 支撑支柱:P1(记忆注入的回放一致性:api_content 边车)、P2(会话库 WAL 所有权纪律,绝不在线降级)、P4(CJK 双字分词 FTS + 索引腐败 fail-open + 让路式重建)。支柱编号与主张全文见 `docs/Hermes/hermes-memory-report.md` §2(P1 :72-77、P2 :79-84、P4 :93-98)。
>
> 引用约定:本章所有 `路径:行号` 均相对 Hermes 检出 `~/.hermes/hermes-agent`(与主报告核证附录同一坐标系;该检出不在本仓库内,行号以 2026-10-27 检出为准)。标「本机佐证」的条目为本次撰写时对 `~/.hermes/state.db` 以 `sqlite3 "file:...?mode=ro&immutable=1"` 只读探测所得,命令与输出全文见 §4.8。本章未运行 Hermes 代码或测试;源中注释里的性能数字(3-6s/6.8GB 等)均为主报告已如实降级的「注释声称」。

---

## 4.0 state.db 是什么、由谁打开

- 库文件:`~/.hermes/state.db`。本机佐证:724,901,888 字节(≈691 MB),与 `state.db-shm`(32,768 B)、`state.db-wal`(5,586,752 B)边车并存。
- 写入方是**多进程**:gateway 服务、Desktop 的 `hermes serve` 后端、交互 CLI、TUI slash worker 常规并存共享一个 state.db(`hermes_state_common.py:1222-1227`)。这是本章一切守卫规则的拓扑前提——「任何进程随手切 journal mode 都可能静默毁掉别人的提交」(主报告 P2 价值判断)。
- WAL 策略模块 `hermes_state_wal.py` 同时被 `hermes_cli.kanban_db_connect.connect` 复用(`hermes_state_wal.py:258-259` 「Shared by SessionDB and hermes_cli.kanban_db_connect.connect」),即守卫是双库共享的。
- 模块拓扑:巨型 `hermes_state.py`(1732 行)按 cluster 拆成约 58 个 `hermes_state_*.py` mixin 文件,`SessionDB` 由 Schema/Search/FtsSetup/ApiContent 等 mixin 组合。拆分纪律见各文件头注:`hermes_state_schema.py:1-5`「Plain mixin for hermes_state.SessionDB … Must never import hermes_state (cycle); shared constants live in hermes_state_common」;`hermes_state_api_content.py:1-7`「(#124102 FILE_LINES split)… every existing session_db.set_message_api_content(...) call site and test patch seam keeps working unchanged」。**共享 SQL 常量全部住在 `hermes_state_common.py`**,mixin 不得反向 import,这是复用这套拆分时的第一条纪律。

## 4.1 表结构:从 SCHEMA_SQL 还原

### 4.1.1 版本常量与初始化流程

DDL 真源是单条 `SCHEMA_SQL` 字符串常量(`hermes_state_common.py:451-770`)。`_init_schema`(`hermes_state_schema.py:940-1024`)每次可写打开按序执行:

1. `report_startup_progress(600.0, phase="state_db_init_schema")` 向启动看门狗声明进度租约——多 GB 库的调和是 I/O 密集近零 CPU,看门狗的 CPU 回退会误判为停摆(OOF-298 / PR #89750;租约上限被夹到 `_MAX_LEASE_S=900`,:944-954);
2. `cursor.executescript(SCHEMA_SQL)`(:956,全语句 `IF NOT EXISTS`,重放幂等);
3. `_reconcile_columns(cursor)` 声明式补列(:959,见 4.1.5);
4. 两处 ALTER TABLE 表达不了的主键形状修复:`_heal_gateway_routing_pk`、`_heal_session_model_usage_pk`(:960-964);
5. 建依赖后加列的索引(`DEFERRED_INDEX_SQL`,:982);顺手治愈 `active IS NULL` 的历史行(先 SELECT 探测再 UPDATE:无条件 UPDATE 即使零命中也拿写锁,曾阻塞兄弟进程的每次打开,:987-993);
6. FTS5 能力探测 + `fts_stale` 面包屑检查(:995-1004);版本行初始化或 `_run_data_migrations`(:1006-1018);FTS ensure + 布局落戳(:1021-1023)。

关键版本常量:

| 常量 | 值 | 位置 | 语义 |
|---|---|---|---|
| `SCHEMA_VERSION` | 32 | `hermes_state_common.py:289` | 数据迁移链版本(本机佐证=32) |
| `FTS_STORAGE_VERSION` | 3 | `hermes_state_common.py:312` | FTS 布局代次,独立于 schema_version |
| `FTS_TOOL_CONTENT_PREFIX_CHARS` | 8_192 | `hermes_state_common.py:322` | tool 行进 base 索引的内容前缀截断 |
| `MAX_FTS5_QUERY_CHARS` | 2_048 | `hermes_state_common.py:335` | FTS5 查询消毒前的长度帽 |
| `_FTS_TRIGGERS` | 6 触发器名元组 | `hermes_state_common.py:448-449` | base+trigram 的 insert/delete/update |

### 4.1.2 核心转录表 sessions(65 列,六组)

`sessions`(`hermes_state_common.py:461-529`)每会话一行:

| 组 | 列(节选,行号) |
|---|---|
| 身份/谱系 | `id TEXT PRIMARY KEY`、`source`、`created_source`、`user_id`、`parent_session_id`(FK→sessions.id)、`session_key`/`chat_id`/`chat_type`/`thread_id`(:462-479) |
| 模型/计费 | `model`、`model_config`、`system_prompt`(v25 起置 NULL 的遗留内联)、`system_prompt_hash`(FK→system_prompts.hash)、`billing_provider`/`billing_base_url`/`billing_mode`、`estimated_cost_usd`/`actual_cost_usd`/`cost_status`/`cost_source`/`pricing_version`(:475-501) |
| 令牌汇总 | `input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_write_tokens`/`reasoning_tokens`/`api_call_count`(:485-507) |
| 压缩治理 | `compression_failure_cooldown_until`/`compression_failure_error`/`compression_fallback_streak`/`compression_ineffective_count`/`compression_recovery_deadline`/`compression_overload_streak`(:511-516) |
| 展示/归档 | `title`/`title_source`、`display_name`/`origin_json`、`archived`/`auto_archived`/`pinned`/`hidden`、`handoff_state`/`handoff_platform`/`handoff_error`(:472-473、:502-510) |
| 一致性锚 | `runtime_revision`/`runtime_generation`、`git_branch`/`git_repo_root`/`git_metadata_generation`、`transcript_revision`(:463-464、:490-493、:526) |

`transcript_revision` 由触发器 `messages_transcript_revision_update` 维护:内容列原地改写(提示扩展、多模态上下文、脱敏)既不动活跃行数也不动最大 id,派生缓存就以这个写侧修订数为键(`hermes_state_common.py:787-796`,注释明言「Whoever wrote the row, old builds included」)。系统提示去重表 `system_prompts(hash TEXT PRIMARY KEY, prompt TEXT NOT NULL)`(:456-459):v25 起 sessions 只存哈希,内联 prompt 由 `_dedupe_legacy_system_prompts` 迁入内容寻址表;中途遇 OperationalError 安全返回——部分迁移无害(旧列仍是读回落,下次打开续迁),向上传播曾把版本卡在 25 以下造成网关崩溃循环(`hermes_state_schema.py:189-211`)。

### 4.1.3 转录本体 messages(30 列)

`messages`(`hermes_state_common.py:531-562`),`id INTEGER PRIMARY KEY AUTOINCREMENT`,`session_id` FK 引用 sessions:

```sql
CREATE TABLE IF NOT EXISTS messages (          -- hermes_state_common.py:531-538(节选)
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    role TEXT NOT NULL,
    content TEXT,
    tool_call_id TEXT, tool_calls TEXT, tool_name TEXT,
```

载荷列组:推理五列 `reasoning/reasoning_content/reasoning_details/codex_reasoning_items/codex_message_items`(:543-547);可见性三态 `observed/_compressed_summary/active/compacted`(:549-552,`WHERE active = 1` 的转录加载器曾因 reconciler 加列缺 DEFAULT 而整段隐藏历史,#51646,治愈见 4.1.1 第 5 步);本章主角:

```sql
    api_content TEXT,                          -- hermes_state_common.py:553
```

展示稳定四列 `display_kind/display_metadata/display_identity BLOB/display_order`(:554-557)与身份四列 `message_uid/absorbed_message_uids/tool_call_uids/tool_call_uid`(:558-561)。本机佐证:`SELECT count(*) FROM messages` → 58,645。

### 4.1.4 簇表、元数据表与触发器(全量清单)

其余表:`session_model_usage`——6 列复合主键 `(session_id, model, billing_provider, billing_base_url, billing_mode, task)` 的每模型用量账(:564-584);`runtime_epoch`(singleton=1 单行纪元,:586-590);`session_admissions`——`intent IN ('queue','steer','redirect')`、`status IN ('queued','started','unknown','terminal')` CHECK 约束的准入账本,`UNIQUE (principal_id, target_session_id, request_id)` 幂等(:591-607);`worker_executions`/`worker_receipts`(运行时工作账本,:618-638);`state_meta(key PRIMARY KEY, value)`——一切 marker/面包屑的家(:640-643);`gateway_routing`(复合主键 `(scope, session_key)`,:645-651)与 `gateway_hygiene_state`(:653-656);`conversation_generations`——单调会话代数,注释明言这些行**故意永不** GC:回收会把某 peer 重置回「无代数」,下次边界又写 generation=1,重发已退役 gwk_ 作用域用过的标识——「exactly the ABA this table exists to close」(:658-685,#96811);`gateway_heartbeats`(每后端心跳,:687-702,#94895);`compression_locks`/`session_turn_leases`(`expires_at` 租约,:704-716);`async_delegations`(:718-748,列形状刻意与委托工具自己的 CREATE TABLE 对齐防漂移,#94691)。SCHEMA_SQL 内索引约 12 条(:750-769),含部分索引 `idx_messages_assistant_calls_by_session … WHERE role='assistant' AND tool_calls IS NOT NULL`(:761-763)。

`DEFERRED_INDEX_SQL`(`hermes_state_common.py:778-910`)承载依赖后加列的索引与五组触发器:防降级删除守卫 `sessions_runtime_ledger_delete_guard`(BEFORE DELETE,有准入/工作账即 RAISE ABORT,文案明言「this older Hermes cannot delete such sessions. Downgrading is unsupported」,:780-786);`messages_message_uid_insert`(AFTER INSERT WHEN new.message_uid IS NULL → `lower(hex(randomblob(16)))`,保证任何写入方产出行都带 uid,:808-816);维护 `display_order` 的三组触发器(:817-882)。整段由 `_execute_ddl_skipping_settled_triggers` 逐句执行:对已存且同体的 DROP+CREATE 触发器对**跳过**——`DROP TRIGGER IF EXISTS` 对已存在触发器也要拿写锁,无条件重放会让定型库的每次打开阻塞在兄弟进程事务后(:304-337,`sqlite_master.sql` 存 CREATE 原文减 `IF NOT EXISTS` 与分号,精确比对即可判定)。

### 4.1.5 声明式列调和:无版本迁移的加列

加列不走版本门。`_reconcile_columns`(`hermes_state_schema.py:772-803`)把 SCHEMA_SQL 在内存库执行、`PRAGMA table_info` 反推每表期望列(含类型/NOT NULL/DEFAULT 重构),对 live 库缺列逐条 `ALTER TABLE … ADD COLUMN`;同列撞名(sibling 赢了 ADD 竞态)降为 debug,锁错误**重新上抛**让锁耐心包装重试(吞掉曾留下半调和库使每次读都 no such column,:796-799)。期望列解析按 DDL 的 SHA-256 缓存到 `~/.hermes/cache/schema_columns.json`,省每次启动约 85ms;仅参考侧解析被缓存,live 库 diff 每次启动照跑(:723-770)。因此「column additions need no version-gated migration; schema_version remains for data migrations only」(`_init_schema` docstring,:941-943)。只读打开跳过调和(不对他人 live 库发 DDL),改跑 `schema_read_probe_statements()`——从 SCHEMA_SQL 派生每表 `SELECT 表.列 FROM 表 LIMIT 0`,列名强制**表限定**:未限定的双引号标识符解析失败会静默退化为字符串字面量(SQLite 缺陷)从而在陈旧库上假通过(:169-183,「a hand-maintained list went stale within days」)。

## 4.2 WAL 守卫规则逐条(全部带事故锚)

策略入口签名(`hermes_state_wal.py:254`):

```python
def apply_wal_with_fallback(conn: sqlite3.Connection, *, db_label: str = "state.db",
                            require_wal: bool = False) -> str:
```

配置源 `database.journal_mode`(wal 默认;delete 供无 WAL 安全持久性的文件系统;非法值回落 wal,:157-167)。六条规则按决策流排列——`apply_wal_with_fallback` 主体的实际分支顺序:

```
config 锁被占 → 保观察模式(wal+vulnerable→DELETE 处置;delete+有内容→保 delete)(:277-295)
↓ configured = resolve_journal_mode()
SQLite 易感(WAL-reset bug)→ _apply_delete_for_wal_reset_bug            [规则四 :303-304]
↓ 探针 _on_disk_journal_mode
已 WAL → delete_overridden 告知(配置 delete 不生效)/跨VM告诫 → WAL 伴随 PRAGMA → "wal" [规则一 :307-313]
configured=delete → 探针 None 则 raise;否则 no-wait DELETE 验收           [规则二 :315-321]
探针 None → require_wal 则 raise WalUnsupportedError;否则不动文件返回 "wal" [规则一/二 :322-330]
路径在跨 VM 文件系统 → 拒启用 WAL,置 DELETE                              [规则三 :331-339]
↓ _enable_wal:静默拒绝检测(:357-365)、EIO 二义重试×2(:379-394)、
  失败后头部是 wal/None 则 raise 不降(:397-398)、DELETE 兜底(:403-416)
```

**规则一|不变量:绝不在线降级 WAL。** docstring 原文:「Invariant on every path: never downgrade to DELETE if the on-disk header reports WAL or cannot be read — other gateway/cron/worker connections may hold the DB open, and a live downgrade destroys their uncheckpointed commits」(:265-267)。三处兑现:头部已 WAL → 套伴随 PRAGMA 原样返回(:307-313);`_enable_wal` 失败分支再探头部,`_on_disk_journal_mode(conn) in ("wal", None)` 即 raise 不降(:395-398);配置 delete 但盘上已 WAL → 保 WAL,ERROR 级一次性告知 `delete_overridden`,正路是停全部进程后 `hermes sessions set-journal-mode delete`(:541-546)。探针 `_on_disk_journal_mode`(:62-83)读不到(None)同样不动文件——WAL 初始化会 unlink 其他连接仍在用的 `-wal/-shm` 边车(:322-329);`disk i/o error` 在虚拟化块设备上可瞬态,先重试 4 次(间隔 50ms)再判 None(:64-74)。

**规则二|busy_timeout=0 并发探测器。** 非 WAL 的 journal-mode 切换**只**允许发生在 `_set_journal_mode_no_wait(conn, mode)`(:419-437):

```python
# hermes_state_wal.py:428-434(节选)
    row = conn.execute("PRAGMA busy_timeout").fetchone()
    previous_timeout = int(row[0]) if row and row[0] is not None else 0
    conn.execute("PRAGMA busy_timeout=0")
    try:
        return _mode_from_row(conn.execute(f"PRAGMA journal_mode={mode}").fetchone())
    finally:
        conn.execute(f"PRAGMA busy_timeout={previous_timeout}")
```

原理(:422-426 注释):离开 WAL 需独占访问,任何其他连接持库则 PRAGMA 立即 `database is locked` 失败——把模式切换变成**并发打开者探测器**;调用方必须把该 OperationalError 当「非独占所有:别动模式」,绝不是可重试。配置 delete 且探针失败时直接抛 `_CANNOT_VERIFY_DELETE_MSG`(:52-54、:318-321:「refusing to downgrade a database this process does not exclusively own」)。

**规则三|virtiofs/9p 跨 VM 文件系统预拒。** Docker Desktop/OrbStack/Podman 把宿主 bind mount 以 `fuse.virtiofs` 或 9p 暴露给 guest;WAL 的 `-shm` 跨 VM 边界不连贯,**写压下静默失败(零填页)**,反应式标记匹配永远等不到信号——必须在 PRAGMA 之前拒(:177-183 注释,锚 openclaw/openclaw#120597)。实现:仅 Linux 解析 `/proc/self/mountinfo`(`statvfs` 不带 fstype),取最长前缀挂载点的 fstype,含八进制转义处理(:193-213);命中 `_CROSS_VM_FSTYPES = frozenset({"virtiofs","fuse.virtiofs","9p","9p2000","9p2000.l","9p2000.u"})`(:184)则对 0 页/DELETE 文件拒绝启用 WAL 置 DELETE(:331-339,`require_wal=True` 时改抛 `WalUnsupportedError`,:335-337)。对**已经**是 WAL 的跨 VM 库:保 WAL(规则一优先)但发 ERROR 级 `cross_vm_fs_existing_wal`,给出两条修复路(停机切 delete / 迁到原生卷),锚 #110848(:440-447、:560-569)。探测按 resolved 目录缓存,警讯按(进程,库路径)去重(:185-190)。

**规则四|WAL-reset 缺陷版本门控 3.7.0–3.51.2。** `is_sqlite_wal_reset_vulnerable(version_info=None) -> bool`(:131-134)委托 `hermes_cli/sqlite_runtime.py:23-30`:

```python
    info = _version_tuple(version_info)
    return not (
        info < (3, 7, 0)
        or info >= (3, 51, 3)
        or (3, 50, 7) <= info < (3, 51, 0)
        or (3, 44, 6) <= info < (3, 45, 0))
```

即易感窗 = 3.7.0 ≤ v < 3.51.3,减去回溯修复窗 3.50.7+ 与 3.44.6+(上游 https://sqlite.org/wal.html#walresetbug)。易感构建对非 WAL 文件不启用 WAL,走 `_apply_delete_for_wal_reset_bug`(:450-485):盘上已 WAL → 保 WAL 警告(`kept_wal`);探针读不到 → 不动并警告——「treating "could not read" as "not WAL" once flipped a live WAL state.db to DELETE under a writer, destroying its uncheckpointed commits」(:453-456);否则 no-wait 置 DELETE。门控曾反转又恢复:#71724 的锁取消修复曾被误撤(「DELETE 才是腐坏模式」的对照被 SQLite 3.53.1 混杂变量污染——3.53.1 同时带 WAL-reset 修复与 3.51.0 的 close()-断锁防御);在实捆 3.50.4 上重测 WAL/DELETE 各 0/3 干净,但上游仍认定缺陷真实,故保留门控(:269-275 docstring)。修复提示按安装类型(git/pip/docker/nix)给命令,不许诺不存在的修复路径(:488-501,锚 #75153)。

**规则五|macOS 双持久化屏障。** `_apply_macos_checkpoint_barrier(conn)`(:103-114)在 darwin 上 `PRAGMA checkpoint_fullfsync=1`(`_darwin_pragma` best-effort、他平台空操作,:96-100)。docstring 给出完整因果:Apple `fsync(2)` 既不保证数据上盘也不保证顺序,launchd **系统级**关机/重启丢 OS 页缓存等价断电,「已持久」的 checkpoint 可能从未落盘——#30636「SIGTERM during launchd shutdown under high load」的触发器,区别于页缓存可存活的普通进程内 kill;代价仅约 +0.1ms/commit(对比 `fullfsync=1` 的 +4ms,只覆盖 checkpoint 边界)。`_enforce_macos_synchronous_full`(:117-121)随后强制 `PRAGMA synchronous=FULL`:NORMAL 下 WAL checkpoint 撞上进程终止留半写 btree 页(`btreeInitPage error 11`)。两屏障打包成 `_apply_wal_companions`(:124-128)随**每次** WAL 激活重施,防先前的 NORMAL 粘住。配置侧同向钳制:`_apply_synchronous_pragma` 在 darwin 拒绝任何低于 FULL 的配置值并告警——「raising is allowed, lowering is refused out loud」(:635-639);操作符写名字(OFF/NORMAL/FULL/EXTRA)映射到 0-3,非法值告警不动(:602-621)。

**规则六|WAL 体积上限 64 MiB。** `_WAL_SIZE_LIMIT_BYTES = 64*1024*1024`(:31);`_apply_wal_size_limit`(:86-93)设 `PRAGMA journal_size_limit`:默认 -1 下已 checkpoint 的 WAL 原位复用**永不截断**,`state.db-wal` 保持历史最大事务的高水位——一次 3 GB optimize 留下 3 GB WAL(docstring 事故)。best-effort,失败只损失磁盘冗余。可选性能 PRAGMA(`cache_size/mmap_size/temp_store/wal_autocheckpoint/journal_size_limit`)由 `apply_database_pragmas` 从 config 施加,全部类连接生效、失败不破初始化(:644-669)。

**一次性日志矩阵**(`_ONCE_LOGS`,:513-570,全部「once per process per database」):`wal_fallback` ERROR(#WAL 不容,NFS/SMB/FUSE/ZFS);`delete_overridden` ERROR(#配置 delete 不生效);`wal_delete_fallback_failed` WARNING(双 PRAGMA 皆拒,APFS 外置 SSD 高争用,传播会崩掉所有 DB-init 调用方);`wal_probe_unknown` WARNING(探针失败不动文件,连接继承头部模式);`cross_vm_fs` WARNING / `cross_vm_fs_existing_wal` ERROR(#110848);`wal_reset_bug` WARNING(#版本+安装类型修复提示);`journal_upgrade` WARNING(#journal mode 是文件属性,操作者用 PRAGMA 设的 delete 挡不住每次打开重施 WAL——想固化去 config 设)。

本机佐证:`PRAGMA journal_mode`(immutable 只读连接)返回 `delete`;系统 `sqlite3 --version` 为 3.51.0(落在易感窗 3.7.0–3.51.2 内)。**未**验证 Hermes 自身运行时链接的 SQLite 版本,故不据此断言本机走的是哪条规则。

## 4.3 api_content 边车:写入时序、UPDATE、逐轮回放

### 4.3.1 常规落库路径:INSERT 原生含列

消息行 INSERT 的列清单原生包含 api_content(`_INSERT_MESSAGE_SQL`,`hermes_state_messages.py:33-36`);live dict 上盖了 `api_content` 键的行落库时直接带上(参数绑定 `_str_or_none(msg.get("api_content"))`,:298)。回读侧 `row["api_content"] is not None` 时还原到 dict(:363-364)。列语义文档(:405-407):「api_content: byte-fidelity sidecar, the exact string sent to the API when it differed」。压缩拷贝走纯 SQL 列克隆(every column except id——content, api_content…),**逐字节保留**(:933);回读侧 `_rows_to_conversation` 的 docstring 亦明示「``api_content`` VERBATIM (no sanitize/strip) so replay keeps the provider prompt cache byte-stable」(:1553)。

### 4.3.2 补写路径:两条 UPDATE

当轮用户行先于边车组合被物化(就地预检压缩、抢先 flush 撞上 prologue,#102194)时,crash-persist 按 marker 跳过该消息,盖的字节到不了库。`hermes_state_api_content.py` 的两个 UPDATE 专为此时:

```python
# hermes_state_api_content.py:64-67 —— 行寻址(首选)
"UPDATE messages SET api_content = ? WHERE id = ? AND session_id = ? "
"AND role = 'user' AND active = 1 AND content IS ?"
# hermes_state_api_content.py:35-39 —— 位置寻址(仅压缩拷贝安全)
"UPDATE messages SET api_content = ? WHERE id = (SELECT id FROM messages "
"WHERE session_id = ? AND role = 'user' AND active = 1 ORDER BY id DESC LIMIT 1"
") AND content IS ?"
```

- `set_message_api_content(session_id, row_id, content, api_content) -> int`(:41-67):用写路径盖在 live dict 上的 `_row_id` 精确寻址「cannot drift onto a neighbouring row that merely carries the same text」;`active=1` 与 `content IS ?` 双防御(被压缩归档的行、被竞态改写的行不碰);非法 row_id(bool/非正数)直接返回 0(:62-63)。
- `set_latest_user_api_content(session_id, content, api_content) -> int`(:17-39):docstring 是边车工程最精细的防御推理——重复相同用户轮(「ok」「y」「continue」)会让**更旧的行**也通过 content 匹配;在当轮行尚不存在时调用,会把上一轮的边车改成本轮字节:「durable wrong-bytes replay, a worse cache break than the missing sidecar」(:25-30)。仅当调用方确知最新活跃用户行就是被盖那条(压缩刚把它变成最新行)才安全。

### 4.3.3 逐跳写入时序(单轮 prologue)

1. `conversation_loop.build_turn_context` → `_memory_turn_start_and_prefetch` 取回外部记忆召回(主报告 §1.2 召回链);
2. 轮 prologue 判型:当前轮用户消息 content 是 list → `_append_multimodal_context`(上下文成为持久 text part,#71998);是 str 且非 codex_app_server/MoA → `_stamp_api_content_sidecar(agent, messages, current_turn_user_idx, ext_prefetch_cache, plugin_user_context, *, preflight_compressed)`(调用点 `agent/turn_context.py:1213-1218`);
3. 组合单源:`compose_user_api_content(content, ext_prefetch_cache, plugin_user_context) -> Optional[str]`(:121-132)——docstring:「Single source for the api_content sidecar and the wire bytes so they never drift (what turn N sends is what turn N+1 replays)」;无注入或 content 非 str 返回 None;`compose_multimodal_context_part`(:109-117)把召回包成 `<memory-context>` 围栏再与插件上下文拼一段;
4. 盖章:`_turn_user_msg["api_content"] = _api_content`,经 `durable_user_row_content` 对齐持久行内容(持久 override=净转录)后,`_api_content == durable_content` 则免盖章(:950-958);
5. 补写:在 `_persist_lock` 内读 `_row_id`——int → 行寻址 UPDATE;`preflight_compressed and _last_compaction_in_place` → 位置寻址 UPDATE;皆无 → 留给常规 INSERT(:961-991)。锁内读的必要性(:977-980 注释):close-flush 持锁提交行、**然后**才回写 `_row_id`;锁外读会在缝隙里看不到 id 而返回,flush 随即标记消息已持久化且 `api_content=NULL`,再无写入方纠正该行。注释末尾钉死:「Never widen this to an unconditional positional backfill」(:966)。

### 4.3.4 回放侧:字节稳定的两条保证

`build_api_messages`(`agent/turn_context.py:1249`,签名 `(agent, messages, *, current_turn_user_idx, ext_prefetch_cache, plugin_user_context, moa_config, active_system_prompt) -> tuple[list, str]`,docstring:「Prompt-cache invariant: historical user/assistant rows replay their api_content sidecar (the exact bytes sent live) so the prefix stays byte-stable」):

- 结构化克隆(非 `msg.copy()`,嵌套容器不得经原地变换漏进持久史,:1284-1287 附近)后 `_api_content = api_msg.pop("api_content", None)`——**从每个出站副本弹出**:它是簿记字段绝非 provider 字段,严格后端拒未知键(:1290-1295 注释);持久/展示簿记字段(`display_*`/`_row_id`/`timestamp`)同批弹出;
- **历史行保证**:user/assistant 行带非空边车 → `api_msg["content"] = _api_content`(:1311-1318,「Replay the exact bytes sent live so the prompt-cache prefix stays byte-stable. User rows carry the injection sidecar; user and assistant rows may carry a sanitize-divergence sidecar」);
- **当前轮保证**:复用 prologue 盖章(:1300-1303,「Reuse the prologue's stamp so sidecar and wire cannot drift and every pass this turn sends identical bytes」——同轮工具循环多 pass 逐次同字节);绕过 prologue 的调用方现场组合(:1306 附近 `compose_user_api_content`)。

收尾两件:`substitute_api_content(api_msg) -> Optional[str]`(:135-141)弹出边车换入 content 并返回(明示「keeps the prompt-cache prefix byte-stable」,实调在 chat_completion_helpers.py:2155,主报告核证);`drop_stale_api_content(msg)`(:143-146)在内容被改写的消息上丢弃边车——重放它等于重发改写已删的东西,代价只是一次 cache miss。回放消费侧另剥围栏:围栏只活在边车里(主报告 §1.4)。

## 4.4 检索路由:search_messages 与 cjk→trigram→LIKE 三级降级

### 4.4.1 入口签名、消毒与前门

```python
def search_messages(self, query: str, source_filter: list[str] | None = None,
                    exclude_sources: list[str] | None = None, role_filter: list[str] | None = None,
                    limit: int = 20, offset: int = 0, sort: str | None = None,
                    include_inactive: bool = False, fields: Optional[Collection[str]] = None,
                    after_ts: Optional[int] = None, before_ts: Optional[int] = None) -> list[dict[str, Any]]
# hermes_state_search.py:1257-1262
```

外层只做慢查询日志:阈值 `HERMES_SEARCH_SLOW_MS`(默认 1000;0 记每次,:122-126、:1264),超线记 `path=<路由名> elapsed=<ms> rows=<n> query=<截断200>`(:1275-1278)。实现在 `_search_messages_impl`(:1280-1384):

1. **消毒 `_sanitize_fts5_query`**(:1011-1046):先 `query[:2048]` 截断;①成对引号短语用编号占位符保护、落单引号化空白;②剥 FTS5 特殊字符(未引号的 `TODO: fix` 会解析成 `column:term`),`%` 仅对含 CJK 的查询保留(:1030-1033);③压缩重复 `*`、去行首 `*`(前缀要字符);④去首尾悬挂 AND/OR/NOT;⑤点/连字符/下划线词**一趟**正则加引号防二次加引号;⑥还原短语;
2. **前门三分支**:`role_filter` 含 `tool` → 直接 LIKE(:1304-1306;超大工具结果只索引 8192 前缀,显式 tool 搜索是选入全量扫描的路径);`_fts_stale` → LIKE(:1308-1310);`not _fts_enabled` → 空结果(:1311-1312)。时间窗 `after_ts/before_ts` 绑定 `s.started_at`,所有路由一致(:280-285);
3. 含 CJK → `_search_cjk`(下节);纯 Latin → `messages_fts` MATCH:OperationalError(语法)吞掉返回空;DatabaseError(腐坏父类,MATCH 读出 malformed / "fts5: corrupt structure record" 类,#66296)→ `_enter_fts_fail_open` 摘索引后 LIKE 兜底(:1324-1338);
4. **重建期补洞**:挂起中且命中不足 `fts_rebuild_status() is not None and len(matches) < limit` → `_search_unindexed_gap` 对 `(progress, high_water]` 区间补有界 LIKE——「old messages never vanish mid-rebuild. Cost decays to zero as the backfill advances」(:1340-1349;谓词 `m.id > ? AND m.id <= ?`,FTS 查询退化为 AND 连接的子串词,:1415-1430);
5. **零结果 Latin 补救**:unicode61 在拉丁-CJK 交界无边界(「修改youer服务端」单 token,MATCH "youer" miss),miss 后先试 cjk 索引再试 trigram(≥3 字符 token),门控在 miss 所以命中保留排序(「cat」可继续命中「concatenate」,:1351-1368);
6. **OR 松弛重试**:隐式 AND 多词查询(转述式查询缺任一词即空)改写 `A OR B` 再试 `messages_fts`;显式 OR/NOT、单词、CJK 路由、stale 态不动(:1370-1383;`_or_relaxed_query` :1070-1083)。

`sort` 映射 `_FTS_ORDER_BY = {"newest": "ORDER BY m.timestamp DESC, rank", "oldest": "ORDER BY m.timestamp ASC, rank"}`,默认 `ORDER BY rank`(:153-154)。命中统一 `_finalize_search_matches`:500 行一批附 1 条上下文,弹掉 `content` 只留 snippet,`fields` 投影白名单校验(:291-306、:1226-1253)。

### 4.4.2 _search_cjk 三级降级逐分支

```python
def _search_cjk(self, query: str, wants_unindexed_rows: bool, route: dict) -> list[dict]:
# hermes_state_search.py:1386-1413(骨架,注释为笔者所加)
raw_query = _strip_cjk_wildcards(query).strip('"').strip()    # :1393
match_query = _quote_fts_tokens(raw_query)                    # 词全引号化防 FTS5 语法误解析
if self._fts_cjk_available and not wants_unindexed_rows \
   and not self._has_lone_cjk_run(raw_query):                 # 分支①门控 :1395
    matches = self._match_rows("messages_fts_cjk", match_query,
                               fail_open="CJK-bigram", ...)   # :1396-1398
    if matches is not None: return matches                    # None=语法/分词器失败→降级
if self._trigram_route_ok(raw_query) and not wants_unindexed_rows:  # 分支② :1401
    matches = self._match_rows("messages_fts_trigram", match_query, fail_open="Trigram", ...)
    if matches is not None: return matches
non_op_tokens = _non_operator_tokens(raw_query) or [raw_query]       # 分支③ :1405
like_where = [f"({' OR '.join([_LIKE_ANY_COLUMN_SQL] * len(non_op_tokens))})"]  # :1407
```

门控谓词的精确语义:

- **① cjk_unicode61 双字索引**:`_fts_cjk_available`(加载/回填/面包屑三态,见 4.6.3);`wants_unindexed_rows` = `role_filter` 含 tool 或 `source_filter` 命中 `FTS_TRIGRAM_EXCLUDED_SOURCES=("cron","subagent")`(:1048、:1316-1319)——要搜的行不在该索引里;`_has_lone_cjk_run`(:1056-1068)任一极大 CJK 游程恰 1 字即真——双字索引只对 ≥2 字游程存 bigram,单字词只能命中孤立字符,LIKE 子串语义更宽。docstring(:1386-1392)还点出根因:unicode61 把 CJK 撕成单字造成假阳性与短语丢失。
- **② trigram**:`_trigram_route_ok`(:1098-1102)= `_count_cjk(raw_query) >= 3` **且** `_has_short_cjk_token` 为假(:1092-1096,每个非运算符 CJK token ≥3 字)且 `_trigram_available`。反例写在 docstring:「广西 OR 桂林 OR 漓江」共 6 个 CJK 字但每 token 2 字,trigram 返 0。trigram 需 SQLite ≥ 3.34;缺失只禁此索引、不禁 FTS(`hermes_state_fts.py:290-294`)。
- **③ LIKE 全表扫描**:每 token 一条三列 OR 谓词 `_LIKE_ANY_COLUMN_SQL`(content/tool_name/tool_calls 各一 `%term%`,:144-145),token 间再 OR(:1407)——三词 OR 查询每词可各自命中;snippet 用 `instr()` 定位首 token、`substr(…, max(1, instr-40), 120)` 截 120 字符(:143、:1411-1412);LIKE 路径自管通配符转义(:132 注释「the CJK LIKE fallback needs it literal」)。

`_match_rows(table, match_query, order_by_sql, *, fail_open=None, operational_debug=None, **kwargs)`(:1137-1157)是三索引共用执行器:OperationalError → None 调用方降级;DatabaseError 且 `fail_open` 指名了子串能力索引 → `_enter_fts_fail_open` 摘索引转正典行——「a live search never runs the unbounded rebuild. Other DatabaseErrors propagate」。路由自述 `_describe_search_path`(:1104-1119)产出五个可记路径名:`like_scan_fts_stale / fts5 / fts_cjk / trigram / like_scan`(与 4.4.1 慢日志对应)。

## 4.5 cjk_unicode61 分词器:bigram 重发射的实现

### 4.5.1 形态、加载与门控

`native/fts5_cjk/fts5_cjk.c`:252 行、零依赖的可加载 FTS5 分词器扩展,注册名 `cjk_unicode61`(入口 `sqlite3_ftscjk_init`,:231-243;另导出下划线基名别名 `sqlite3_fts5_cjk_init`,:249-252)。构建一行:`gcc -shared -fPIC -O2 fts5_cjk.c -o libfts5_cjk.so`(:20);使用 `tokenize='cjk_unicode61'`,额外参数透传 unicode61(如 `remove_diacritics 2`,:22-24)。运行时加载 `load_fts5_cjk_extension(conn) -> bool`(`hermes_state_fts.py:113-128`):best-effort 绝不抛;路径 `HERMES_FTS5_CJK_SO` 环境变量,否则 `$HERMES_HOME/lib/libfts5_cjk.so`(:101-104);配置门 `sessions.cjk_fts` 默认开(环境 `HERMES_CJK_FTS`,:107-110)。头注释(:2-10)动机全文:unicode61 把 CJK 游程当一个 token;trigram 需 ≥3 字/词,2 字词(일본、구글、项目)掉 LIKE——「measured 3-6s CPU per query on multi-GB installs」(`hermes_state_fts.py:35`;C 头注 :9 措辞为「measured at 3-6s per query on a 6.8GB messages table」,session_search 延迟头号驱动;注释声称,主报告未复跑);PR #65544,贡献者 Soju06(:40)。

### 4.5.2 包装器结构与 cjk_emit 重发射

实现是**包装器**而非独立分词器:`cjkCreate`(:173-194)经 `fts5_api->xFindTokenizer` 找内建 unicode61 实例化,`cjkTokenize`(:204-213)把文本喂给 unicode61、回调重定向到 `cjkInnerCallback` → `cjk_emit`。即先按 unicode61 切词,再对**每个 token 内部**做 CJK 重发射。核心 `cjk_emit`(:96-165)三段:

1. **快路径**(:102-111):token 内无任何 CJK 码点则原样直通——纯拉丁文本零额外开销;
2. **非 CJK 段**(:119-129):扩展到下一个 CJK 字或 token 末尾,整段透传;
3. **CJK 游程→滚动窗口 bigram**(:131-154):

```c
      int bounds[3];               /* rolling window: start, mid, end */
      bounds[0] = segStart; bounds[1] = segStart + len; i += len;
      int nChars = 1;
      while (i < nToken) {
        int l2 = cjk_utf8_decode(z + i, nToken - i, &cp);
        if (!cjk_is_cjk(cp)) break;
        i += l2; nChars++;
        if (nChars >= 2) {
          bounds[2] = i;
          rc = p->xOuterToken(p->pOuterCtx, tflags, pToken + bounds[0],
                              bounds[2] - bounds[0],
                              CJK_CLAMP_END(bounds[0]), CJK_CLAMP_END(bounds[2]));
          bounds[0] = bounds[1]; bounds[1] = bounds[2];   /* 窗口前移一格 */
```

游程恰长 1 时按 unigram 发射(:155-160)。发射偏移用 `CJK_CLAMP_END` 夹在 unicode61 报告的 `[iStart, iEnd)` 内(:113);偏移按 token 内字节位映射:CJK 折叠是恒等、ASCII 大小写折叠保长,罕见变长折叠(带音符拉丁)只漂高亮不损匹配(:86-94)。**匹配语义的关键**(:16-18 头注释):FTS5 把一个查询词连续发射的 token 当**短语**处理,查询词 캘린더 → [캘린][린더] 两枚 bigram 的短语匹配即精确子串语义——「exact substring semantics with index-speed lookups, down to 2-char terms」。

CJK 码点分类 `cjk_is_cjk`(:34-47)覆盖:谚文音节 U+AC00–D7A3、谚文 Jamo(U+1100–11FF/U+3130–318F/U+A960–A97F/U+D7B0–D7FF)、CJK 统一表意 U+4E00–9FFF、扩展 A U+3400–4DBF、兼容表意 U+F900–FAFF、扩展 B..F U+20000–2FA1F、平假名 U+3040–309F、片假名 U+30A0–30FF/U+31F0–31FF。UTF-8 解码自实现(`cjk_utf8_decode`,:52-70),无效字节按自身解码保证分段终止。

### 4.5.3 CJK 索引 DDL 与同步触发器

`FTS_CJK_TABLE_SQL`(`hermes_state_fts.py:41-55`):源视图 `messages_fts_cjk_src` 排除 tool 行(`WHERE role <> 'tool'`,全量 content 不截断);虚表三列 `content, tool_name, tool_calls` external-content 于该视图、`tokenize='cjk_unicode61'`。三触发器 `FTS_CJK_TRIGGER_SQL`(:57-98)与 base/trigram 同构但用**专属 marker 对** `fts_cjk_rebuild_high_water/_progress` 做 WHEN 门控(:60-63)。模块注释(:21-33)写明 v23 纪律:表/视图任何时刻可 ensure;触发器只在索引完整或 marker 门控下创建;**过期索引必须保持触发器摘除态**——「an external-content 'delete' for a rowid the index never held is the canonical FTS5 corruption hazard」;表只在分词器加载成功时存在,加载不了的进程摘 cjk 触发器保写(索引过期到下次 optimize-storage)。

本机佐证:`SELECT count(*) FROM messages_fts_cjk` → `Error: no such table: messages_fts_cjk`;默认路径 `~/.hermes/lib/libfts5_cjk.so` 不存在(.so 未构建)。即主报告 P4 核证注所述「本机按设计降级(检索仍走 trigram/LIKE)」。

## 4.6 FTS fail-open 与分块自适应重建

### 4.6.1 三张索引的布局与门控谓词

v23 起 base/trigram 为 external-content 布局;legacy v11–v22 是 inline 单列(`LEGACY_FTS_SQL` :1155-1181 / `LEGACY_FTS_TRIGRAM_SQL` :1184-1211,只为旧库保命、新装永不创建,:1144-1154)。`FTS_SQL`(:941-1022)的源视图对 tool 行截 8192 前缀:

```sql
CREATE VIEW IF NOT EXISTS messages_fts_src AS        -- hermes_state_common.py:945-951
    SELECT id,
           CASE WHEN role = 'tool'
                THEN substr(COALESCE(content, ''), 1, 8192)
                ELSE content END AS content,
           tool_name, tool_calls
    FROM messages;
```

trigram 源视图(:1067-1071)更强:JOIN sessions 排除 tool 行与排除源会话;判词 `fts_trigram_session_sql(alias)`(:1050-1060)= `source NOT IN ('cron','subagent') AND json_extract(model_config,'$._delegate_from') IS NULL`,由**视图/触发器/回填三方共享**「so they can never disagree about the index boundary」。注释 :933-940 解释为何需要稳定投影:工具行按有界前缀索引,索引必须回读同一投影,否则 FTS5 的 integrity-check/'delete' 与存量 token 不一致——曾依赖移动的 state_meta 高水位键,是「recurring fts5 checksum-mismatch drift」的根,故 v3 起固定为每行函数。延迟重建记账不变量(:913-931):`fts_rebuild_high_water H` = 旧索引 drop 时刻的 `MAX(messages.id)`;`fts_rebuild_progress P` = 分块回填已达最高 id;**行已索引 ⟺ id ≤ P(回填过)或 id > H(drop 后新插,AUTOINCREMENT 保证新 id 恒 > H)**;(P, H] 是未索引洞;六个同步触发器全部以同一谓词做 WHEN 门控(:962-965 等三处),marker 缺席时 COALESCE(-1) 化为永真式即正常运行;对不在索引内的行发 external-content 'delete' 会腐坏索引、对在索引内的行跳过则留陈旧条目(:925-927)。

### 4.6.2 写路径 fail-open:原子摘触发器后重试

写路径统一过 `_execute_write`;其 DatabaseError 分支的关键两行(`hermes_state.py:1119-1121`):

```python
# Corrupt FTS shadow tables fail every write via the sync triggers while canonical
# rows are intact: detach the derived indexes atomically and retry (never rebuild here).
if self._enter_fts_fail_open(exc, deadline=deadline, patience_s=patience_s):
    continue
```

`_enter_fts_fail_open(exc, *, deadline=None, patience_s=None) -> bool`(`hermes_state_fts.py:463-535`)的**原子性**是设计核心:单个 `BEGIN IMMEDIATE` 事务内同时写 `fts_stale` 面包屑(存在 CJK 触发器则加写 `fts_cjk_stale`,:496-507)并 `_drop_all_fts_triggers`,一起提交(:489-512)——触发器一旦缺席,索引就有未知范围的洞,**任何人不得不经全量重建就重装触发器**(:467-469)。每次尝试前重查隔离态(等待锁时兄弟可能已隔离该文件,隔离句柄上不得再提交,:481-483);锁忙按调用方写预算等待——写连接 busy timeout 仅 1s,通常的持锁者是正在摘同一坏索引的兄弟,1s 放弃会丢掉那一轮正典写(:473-479)。成功后置 `_fts_stale/_fts_enabled/_trigram_available/_fts_cjk_available` 四态并 ERROR 记录「canonical write still … retrying; Search temporarily uses LIKE until a later SessionDB open rebuilds the indexes」(:525-534)。腐坏判定 `is_fts_scoped_corruption_error`(SQLITE_CORRUPT_VTAB 或 `fts5:` 报告点名 `messages_fts*`,:455-461)——**正典行完好、只有派生索引坏时,写入永不因索引损坏而丢**。读路径同款:`_match_rows` 的 `fail_open` 参数(4.4.2);`_refresh_fts_stale_state`(:1214-1224)每次搜索前查 `fts_stale` 键,观察**他进程**发起的 fail-open(面包屑是跨进程信号)。

### 4.6.3 CJK 索引的独立降级与三态可用性

`_ensure_fts_cjk_schema(cursor)`(`hermes_state_fts.py:352-427`,never raises)按「分词器×表在场」四态:分词器**未加载**而 CJK 触发器在库上 → **先写** `fts_cjk_stale` 面包屑**再**摘触发器(顺序刻意:两步间崩溃只是保守,:369-386),写继续、CJK 检索退 trigram/LIKE,提示 `optimize-storage` 在有扩展的宿主上重建;已加载且表缺席 → 建表;空库天然完整免 marker,有数据的库落 marker 对(`high_water=MAX(id), progress='0'`,:403-412),回填完成前 `_fts_cjk_available=False` 不服务读;面包屑在场(洞范围未知)→ **绝不**重装触发器(:413-416);一切 OperationalError(含注册失败后的 no such tokenizer)降级为 warning + unavailable(:389-395、:422-427)。

### 4.6.4 stale 恢复:跨进程准入、holder 让路与进程内退避

`_recover_stale_fts(cursor, *, legacy, timeout_seconds=None) -> bool`(`hermes_state_schema.py:580-594`)两级门:① `_foreign_state_db_holders` 有外进程持库/边车 → `_defer_stale_fts_for_holders` 记诊断并放弃(:584-586)——同一 PID 集连挡 `_FTS_HOLDER_FUTILE_ATTEMPTS=10` 次/`_FTS_HOLDER_FUTILE_SECONDS=1800.0` 判 futile 并点名进程与自救法(结构常驻 peer 不是值得等的过客,#106393,:41-44、:544-566);`_FTS_HOLDER_ESCALATE_ATTEMPTS=3` 次/60s 先收割**确证死亡**的孤儿 Desktop 后端再复查(:39-40、:533-543);② `fts_rebuild_admission` 跨进程重建准入(`<db>.fts_rebuild.lock`):**任何**全量结构重建(rebuild_fts / _rebuild_fts_indexes / _recover_stale_fts 三入口)单进程串行——两并发重建曾在生产上结构性打坏 state.db(PR #93200;2026-08-15/08-23 事故,#89293/#90950);锁可移植(msvcrt/flock)、有界等待 `_FTS_REBUILD_LOCK_TIMEOUT_SECONDS=120.0`、fail-closed;孤儿 fd( fork 子进程继承的 flock 沿 open file description 存活)仅在持有者可证死亡时 unlink 换 inode 打破,不确定即让(孤儿 fd/双锁区分的注释块与 `_FTS_REBUILD_LOCK_TIMEOUT_SECONDS=120.0` 均在 `hermes_state_common.py:1219-1246`,准入函数 `fts_rebuild_admission` 同文件 :1432);与离线 schema 手术锁 `<db>.repair.lock` 刻意分开。分块回填**故意不**过此锁——它在 SQLite 事务权威下多进程认领(`hermes_state_common.py:1230-1232`)。拿到准入后 `_recover_stale_fts_locked`(:657-704)在**一个**写事务里 `BEGIN IMMEDIATE` + drop 全部 FTS 对象 + 重建 DDL + FTS5 `'rebuild'` 命令 + 清 marker + COMMIT——「One write transaction, so no canonical writer slips between rebuild and trigger restoration」(:658-659);执行失败则回滚后**保持摘除态**(`_drop_all_fts_triggers` 再提交)——过期索引在 DDL 事务行为有差异的构建上也必须保持摘除(:687-699)。进程内重试 `retry_deferred_fts_recovery() -> bool`(:596-655):网关一开 state.db 就是数天,「"next open" never comes」,故由既有周期 tick(gateway housekeeping)做非阻塞重试,退避 `_FTS_STALE_RETRY_SECONDS=60.0` 起步倍增至 `_FTS_STALE_RETRY_MAX_SECONDS=3600.0` 封顶(:47-48、:629-635);backoff 锚定**具体 holder 集**,holder 集一变立即清退避(封顶值会让已恢复的服务白等一小时,:620-628)。

### 4.6.5 分块自适应重建引擎

一次性 'rebuild' 在 25 GB 库上曾持写锁约 16 分钟(:537-539 注释,事故),所以回填/拆除全部分块。常量(`hermes_state_fts.py:551-558`):

| 常量 | 值 | 语义 |
|---|---|---|
| `_FTS_REBUILD_CHUNK_ROWS` | 500 | 每阶段首块与 trash 表块;后续自适应 |
| `_FTS_REBUILD_CHUNK_MIN_ROWS` | 50 | 自适应下限 |
| `_FTS_REBUILD_CHUNK_MAX_ROWS` | 100_000 | 自适应上限 |
| `_FTS_REBUILD_CHUNK_TARGET_S` | 0.25 | 无 holder 时每块目标耗时(秒) |
| `_FTS_REBUILD_PACED_TARGET_S` | 0.05 | 有 holder 时块目标 |
| `_FTS_REBUILD_DUTY_FACTOR` | 4.0 | paced 下睡眠 ≥ 4× 块耗时 ⇒ **占空比 ≤ 20%** |
| `_FTS_REBUILD_MIN_PAUSE` | 0.2 | paced 块间最小停顿(秒) |

自适应 `_next_chunk_rows(rows, cost_s, target_s)`(:560-565):按上块耗时缩放 `scale = target_s / max(cost_s, 1e-4)`,单步最多翻倍或减半(一个噪声块——冷页/checkpoint——带不动整引擎),夹在 [50, 100_000]。块大小按**行数**而非 id 跨度(被清理过的库 id 有洞,:546-547);行成本在 trigram_data 与 docsize 间差约 1000 倍,自适应按实测成本走(:545-546)。节奏(:541-550 注释):无 holder 时块间**不停**(固定 0.2s 停顿曾占 >95% 墙钟;前台 `optimize-storage` 在有 holder 时拒绝启动,held_store_refusal #110054);侧线程每 `_HOLDER_SCAN_INTERVAL_S` 扫 holder,出现即切 paced(块目标 0.05s、块间睡 `max(0.2, cost×4)`)让路在线写。

引擎核心 `_rebuild_step(prefix, insert_sqls, *, finish, finish_when_empty=False, progress=None) -> bool`(`hermes_state_search.py:432-477`):

```python
        def _do(conn):
            # Re-reading progress inside the BEGIN IMMEDIATE held by _execute_write IS
            # the claim: two workers cannot read the same value.
            row = _meta_row(conn, f"{prefix}_progress")
            ...
            nth = conn.execute("SELECT id FROM messages WHERE id > ? AND id <= ? "
                               "ORDER BY id LIMIT 1 OFFSET ?", (done, high_water, chunk - 1)).fetchone()
            ...
            for sql in insert_sqls:
                conn.execute(sql, (done, upper))
            # Progress lands in the same transaction as its rows (crash-atomic).
            conn.execute("UPDATE state_meta SET value = ? WHERE key = ?", (str(upper), f"{prefix}_progress"))
```

claim 即「在 `_execute_write` 持有的 BEGIN IMMEDIATE 内重读 progress」(:442-447);窗口上界取下一块第 chunk 行的 id(:453-455);行插入与 marker 推进同事务落盘(:460-463)。收尾 `_rebuild_finish`(:399-410)对 `[hw-1000, hw+1000]` 边界兜底扫描(防 high_water 捕获与触发器激活之间的滑落行)再清 marker;base 收尾带 trigram 半闸(`_trigram_available` 缺 tokenizer 则跳过整半,:381-390),CJK 收尾后置 `_fts_cjk_available=True` 开始服务(:392-397)。两个公开步进:`fts_rebuild_step(progress=None)`(base+trigram,:412-423)与 `fts_cjk_rebuild_step(progress=None)`(:425-430,分词器未加载即 False)。回填 INSERT 的 SQL 形状:`_CHUNK_INSERT_SQL`(:369-374,base 带 8192 截断 CASE)与 `_TRIGRAM_CHUNK_INSERT_SQL`(:375-379,带排除源 JOIN)。被降级的 v22 影子表改名 `fts_v22_trash_*`(DROP 多 GB vtable 阻塞数分钟,:567-569)后分块掏空:INTEGER 单列主键走高水位排水避免每块从头重扫的 O(n²)(#79324,:479-529),复合键小表保持 LIMIT 分块删除。进度读取 `fts_rebuild_status() / fts_cjk_rebuild_status()`(`{"pending","total","indexed","percent"}`,走池化读连接不碰写锁,:325-342)。

## 4.7 复用清单(给复用者的一句话提炼)

1. **多进程共库的第一守卫是「绝不在线降级」**:journal mode 是文件属性,模式切换=所有权切换;用 `busy_timeout=0` 把切换变成并发探测器,读不到头部=非独占=什么都不做(`hermes_state_wal.py:419-437`)。
2. **环境不兼容要在 PRAGMA 之前预拒**:静默失败(virtiofs 零填页、macOS NFS 不抛异常)比抛异常更危险,反应式标记匹配等不到信号(`:177-184`、`:357-365`);二义错误(disk I/O error)靠短重试分辨瞬态(`:379-394`)。
3. **发送字节与持久字节要单一来源**:wire 组合函数即边车来源;历史行原样回放、当前轮复用 prologue 盖章(`turn_context.py:121-132`、`:1300-1318`);补写 UPDATE 永远行寻址+内容匹配双防御,理解「ok/y/continue」重复轮的邻行错写面(`hermes_state_api_content.py:25-39`、`:64-67`)。
4. **派生索引的写入必须 fail-open**:面包屑+摘触发器单事务原子落盘,重建所有权归打开/维护路径,活路径只降级不自愈(`hermes_state_fts.py:463-535`;`hermes_state.py:1119-1121`)。
5. **检索路由按「查询语言特征×索引能力」矩阵降级**:每个门控谓词写进 docstring 并配真实反例(「广西 OR 桂林」式);慢路径必须最后、可度量、可路由名记日志(`hermes_state_search.py:1386-1413`、`:122-126`)。
6. **CJK 检索的最小可行答案是 bigram 重发射包装器**:包内建分词器而非重写,~250 行 C,FTS5 短语语义免费给出 2 字子串匹配(`native/fts5_cjk/fts5_cjk.c:96-165`)。
7. **重建永远分块+自适应+让路**:行数窗口在事务内 CAS 认领、块大小按耗时自适应夹逼、有 holder 时占空比 ≤20%、降级对象改名为 trash 分块拆(`hermes_state_search.py:432-477`;`hermes_state_fts.py:551-570`)。

## 4.8 本章验证记录(本次撰写实际执行的检查)

只读探测,未运行 Hermes 代码/测试,未做任何写操作:

1. `sqlite3 "file:$HOME/.hermes/state.db?mode=ro&immutable=1" "SELECT version FROM schema_version;"` → `32`(与 `hermes_state_common.py:289` 的 `SCHEMA_VERSION = 32` 一致)。
2. 同连接 `"SELECT key, value FROM state_meta WHERE key IN ('fts_storage_version','fts_stale','fts_cjk_stale','fts_rebuild_high_water','fts_rebuild_progress','fts_cjk_rebuild_high_water');"` → **零行**:无 FTS 布局戳、无 stale 面包屑、无挂起重建 marker。
3. 同连接 `"SELECT name FROM sqlite_master WHERE type='view';"` → **零行**:本机库无 `messages_fts_src`/`messages_fts_trigram_src` 视图,即非 v23 external-content 布局。
4. 同连接 `"SELECT sql FROM sqlite_master WHERE name='messages_fts';"` → `CREATE VIRTUAL TABLE messages_fts USING fts5(content)`——**legacy inline 单列布局**(对应 `hermes_state_common.py:1155-1181` 的 `LEGACY_FTS_SQL` 形状,即 :1148 所述「the exact inline shape v11..v22 shipped」)。
5. 同连接 `"SELECT count(*) FROM messages_fts_cjk;"` → `Error: no such table: messages_fts_cjk`;`ls ~/.hermes/lib/libfts5_cjk.so` 不存在——CJK 索引在本机未启用(按设计降级)。
6. 同连接 `"SELECT count(*) FROM messages;"` → `58645`;`"PRAGMA journal_mode;"` → `delete`;`ls -la ~/.hermes/state.db*` → 主库 724,901,888 B、`-shm` 32,768 B、`-wal` 5,586,752 B。
7. `sqlite3 --version` → `3.51.0 2025-06-12 …`——系统 CLI 落在 WAL-reset 易感窗 3.7.0–3.51.2 内(`hermes_cli/sqlite_runtime.py:23-30`);但 Hermes 运行时实际链接的 SQLite 版本**未验证**,不据此断言本机走了规则四。
8. 行号核实:本章引用的全部 `路径:行号` 在撰写时以 Read/grep 对 `~/.hermes/hermes-agent` 检出逐一定位;未复核的断言已在正文标明(性能数字为注释声称、运行时 SQLite 版本未验证)。

本章未做:召回质量评测、FTS 重建实操、WAL 切换实验、Hermes 测试套件运行——均为只读研究边界之外。
