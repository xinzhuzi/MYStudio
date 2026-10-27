# 第 1 章 记忆运行时与调用链(Memory Runtime & Call Chains)

> **路径约定**:本章全部 `path:line` 引用相对 Hermes 源码检出 `~/.hermes/hermes-agent/`(本仓库外的一手只读证据),行号为本次撰写时逐行亲核的实测值;支柱编号沿用 `docs/Hermes/hermes-memory-report.md`。
>
> **本章支撑的支柱**:P1(api_content 边车逐轮回放一致性——§4 时序逐跳)、P3(压缩前检查点 fail-closed——§4.6)、P5(九个 provider 出口的强制脱敏接线——§2.1/§4)、P6(_StuckCallGate 进程级熔断——§3.2)、P10(多 profile 归属隔离三机制接线——§3.4/§5.2);另覆盖报告 §1.4 的四类生命周期边界钩子(§4.7)。

---

## 1.1 运行时总览:四条轨道

Hermes 记忆运行时在一个 agent 进程里有四条并行轨道:

| 轨道 | 载体 | 驱动方 | 本章落点 |
|---|---|---|---|
| 内置文件库 | `agent._memory_store`(`MemoryStore`,MEMORY.md/USER.md) | 轮起始计数器 + `memory` 工具 + 每 N 轮后台 review | §4.1/§4.4 |
| 外部 provider | `agent._memory_manager`(`MemoryManager`,至多 1 个插件 provider) | 轮首 prefetch / 轮尾 sync / 工具分发 / 生命周期钩子 | §2-§5 |
| 注入通道 | 当轮用户消息的 `api_content` 边车 + `<memory-context>` 围栏 | 轮首 stamp、API 时回放、流式剥离 | §4.2/§4.3 |
| 后台线程 | 单 worker `DaemonThreadPoolExecutor` + prefetch 守护线程 + 三门准入 | `_submit_background`/`_call_unless_stalled` | §3.2/§3.3 |

一个关键事实(复用者最容易误解的点):**当前检出中,内置文件库不是注册进 `MemoryManager` 的 provider**。`MemoryManager` 类 docstring 自称 "Builtin provider (always first)"(`agent/memory_manager.py:197`),`add_provider` 也保留 `name == "builtin"` 恒接受的契约(`agent/memory_manager.py:271`);但全库 grep `add_provider` 的唯一生产调用是 `agent/agent_init.py:1269`,且只传外部 provider `_mp`。内置库走 `agent._memory_store` 独立装载(`agent/agent_init.py:1246-1252`),不经过 manager 的任何钩子;manager 内六处 `name != "builtin"` 守卫(`agent/memory_manager.py:267/:360/:517/:760/:910/:926`)是给"若注册了 builtin provider"预留的契约路径。设计复用时应把两层视为**并行且互不代理**的记忆面,唯一桥接点是写入镜像 `notify_memory_tool_write`(§4.4)。

---

## 1.2 MemoryProvider 钩子全清单

基类 `MemoryProvider(ABC)` 定义于 `agent/memory_provider.py:84`。模块 docstring 给出的生命周期总纲:"initialize -> system_prompt_block / prefetch / sync_turn per turn -> tool dispatch -> shutdown, plus optional `on_*` hooks"(`agent/memory_provider.py:4-5`)。

### 1.2.1 抽象必须实现(4 个)

| 钩子 | 签名 | 触发时机 |
|---|---|---|
| `name` | `@property @abstractmethod def name(self) -> str` | 常量标识(如 `'builtin'`/`'honcho'`);注册、单槽判定、日志都用它(`agent/memory_provider.py:109-112`) |
| `is_available` | `def is_available(self) -> bool` | agent 初始化装载时(`agent/agent_init_memory_provider.py:72`);"check config/deps only, no network"(`:118`) |
| `initialize` | `def initialize(self, session_id: str, **kwargs) -> None` | agent 启动一次,经 `MemoryManager.initialize_all`(`agent/memory_manager.py:929`);kwargs 恒含 `hermes_home`/`platform`,可含 `agent_context`("primary"\|"subagent"\|"cron"\|"flush")、`agent_identity`、`agent_workspace`、`parent_session_id`、`user_id`、`user_id_alt`(`agent/memory_provider.py:120-128`) |
| `get_tool_schemas` | `def get_tool_schemas(self) -> list[dict[str, Any]]` | agent 初始化注入工具面时(`agent/memory_manager_tools.py:94`);返回 OpenAI function-calling 形状,空列表=无工具(`agent/memory_provider.py:159-161`) |

### 1.2.2 核心生命周期(有默认实现,按需覆写)

| 钩子 | 签名 | 默认 | 触发时机 |
|---|---|---|---|
| `unavailable_reason` | `def unavailable_reason(self) -> str` | `return ""` | `is_available()` 为 False 时,初始化告警一次性拼进用户提示(`agent/agent_init_memory_provider.py:78`) |
| `system_prompt_block` | `def system_prompt_block(self) -> str` | `return ""` | 系统提示构建时拼入静态文本(`agent/system_prompt.py:542` → `agent/memory_manager.py:336-340`);"Recalled context goes through prefetch(), not here"(`agent/memory_provider.py:135`) |
| `prefetch` | `def prefetch(self, query: str, *, session_id: str = "") -> str` | `return ""` | 每轮轮首、工具循环开始前(`agent/turn_context.py:932`);外部 provider 受 8s 超时守护(§3.2) |
| `queue_prefetch` | `def queue_prefetch(self, query: str, *, session_id: str = "") -> None` | 空体 | 轮尾后台排队,下一轮 `prefetch` 消费缓存(`agent/memory_provider.py:143-144`;接线 `agent/memory_manager.py:429-433`) |
| `recall_status` | `def recall_status(self) -> Optional[RecallStatus]` | `return None` | `prefetch_all` 后立即调,生成「🧠 已召回 N 条」指示(`agent/turn_context.py:937`;`agent/memory_manager.py:409-420`) |
| `sync_turn` | `def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "", messages: Optional[list[dict[str, Any]]] = None, turn_author: Optional[dict[str, Any]] = None) -> None` | 空体 | 轮尾在单后台 worker 序列化执行("Never inline",`agent/memory_manager.py:446-447`);`turn_author` 只发给签名接受的 provider(`:448`) |
| `handle_tool_call` | `def handle_tool_call(self, tool_name: str, args: dict[str, Any], **kwargs) -> str` | `raise NotImplementedError(...)` | 工具循环分发到本 provider 注册的工具名(`agent/tool_executor.py:1706-1716`) |
| `shutdown` | `def shutdown(self) -> None` | 空体 | 会话关停,逆注册序调用(`agent/memory_manager.py:861-862`) |

### 1.2.3 可选 `on_*` 钩子(默认空,覆写即启用)

| 钩子 | 签名 | 触发时机 |
|---|---|---|
| `on_turn_start` | `def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None` | 每轮轮首、prefetch 之前(`agent/turn_context.py:924`);kwargs 可含 `remaining_tokens`/`model`/`platform`/`tool_count`/author 三元组(`agent/memory_provider.py:172-175`) |
| `identity_signature` | `def identity_signature(self) -> dict[str, Any]` | 网关每条入站消息对**未初始化实例**调用,变更即 bust 缓存 agent;"keep it cheap and read-only"(`agent/memory_provider.py:177-181`) |
| `on_session_end` | `def on_session_end(self, messages: list[dict[str, Any]]) -> None` | 真会话边界(CLI 关停/网关逐出边界/轮转),绝不逐轮(`agent/memory_provider.py:183-184`) |
| `on_session_switch` | `def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "", reset: bool = False, rewound: bool = False, **kwargs) -> None` | `session_id` 中途轮换(/resume、/branch、/reset、/new、压缩)不拆 provider 时重绑(`agent/memory_provider.py:186-192`;接线 `agent/memory_manager.py:666-678`) |
| `on_pre_compress` | `def on_pre_compress(self, messages: list[dict[str, Any]]) -> str` | 压缩执行前,返回洞见文本进摘要提示(`agent/memory_provider.py:194-196`;fail-closed 语义见 §4.6) |
| `on_delegation` | `def on_delegation(self, task: str, result: str, *, child_session_id: str = "", **kwargs) -> None` | 父侧观察一次完成的委托(`agent/memory_provider.py:198-199`) |
| `get_config_schema` / `save_config` | `def get_config_schema(self) -> list[dict[str, Any]]` / `def save_config(self, values: dict[str, Any], hermes_home: str) -> None` | `hermes memory setup` 配置流(`agent/memory_provider.py:201-210`) |
| `on_memory_write` | `def on_memory_write(self, action: str, target: str, content: str, metadata: Optional[dict[str, Any]] = None) -> None` | 内置 memory 工具成功写后镜像;patch 翻译成整条 replace(`agent/memory_provider.py:212-220`;镜像门 §4.4) |
| `backup_paths` | `def backup_paths(self) -> list[str]` | `hermes backup`/`import`;MUST 无 `initialize()`、无网络可用(`agent/memory_provider.py:222-225`) |

### 1.2.4 模块级协议件(常量与助手)

```python
# agent/memory_provider.py:21-33
def ctx_bound(fn): ...            # 把 fn 绑到调用者的 contextvars,供他线程执行
def spawn_context_thread(target, *, name, daemon=True, args=(), kwargs=None):
    """Unstarted thread running *target* under the spawner's contextvars ...
    Every memory-provider background job (prefetch, sync, writer loops) must go through this."""
```

常量:`PRE_COMPRESS_CHECKPOINT_API_VERSION = 2`(`:37`);`INDICATOR_GLYPH = "🧠"`(`:40`);`CORE_MEMORY_PROVIDER_SENTINELS = frozenset({"", "default", "builtin", "built-in", "none"})`(`:44`)——这些值表示"用内置库、无外部插件",医生/迁移/依赖刷新不得把它们当插件查找(`:42-44`)。trivial 提示正则 `TRIVIAL_PROMPT_RE`(`:66-72`,锚定+仅尾随空白/标点,故 "k8s"/"note" 不中而 "hi!"/"done???" 中),`is_trivial_prompt` 对空串、`/` 命令、纯问候/应答返回 True(`:75-81`)。`RecallStatus` frozen dataclass 携 `provider_label`/`count`/`glyph`(`:52-60`),`count == 0` 表示"有内容但无离散计数"(如 reflect 综合答案,渲染为泛化文案)。

### 1.2.5 签名内省适配层(provider 是鸭子类型)

manager 不要求 provider 升级签名,而是逐钩子探测"它能不能吃这个参数":

| 助手 | 位置 | 用途 |
|---|---|---|
| `_signature_params(fn)` | `agent/memory_manager.py:62-67` | 参数映射,不可内省(C 可调用等)返回 None |
| `_has_var_kwargs(params)` | `:70-71` | 是否声明 `**kwargs` |
| `_accepts_require_checkpoint(fn)` | `:74-84` | `on_pre_compress` 能否收 `require_checkpoint`;注释钉反例:裸形状 v2 provider 收到该关键字会 TypeError,被宿主误当"检查点失败" |
| `_provider_sync_accepts(provider, keyword)` | `:435-439` | `sync_turn` 能否收 `messages`/`turn_author`(不可内省→假定能) |
| `_provider_memory_write_metadata_mode(provider)` | `:735-742` | `on_memory_write` 的 metadata 走 keyword / positional / legacy(不发)三型 |
| `_tool_call_keywords(provider)` | `:254-261` | `handle_tool_call` 声明的关键字集,None=收任意;按 `id(provider)` 缓存一次 |

语义关键字与普通关键字区别对待:`hermes_home`/`caller_gsk` 等"上下文信息"能省则省(省了不误事),而 `require_checkpoint=True` 是**信号**——发不出去等于语义未传达,所以必须先探测再发(§1.7 第 7 条)。`on_turn_start` 的 author 三元组同理由 `_tick` 内过滤(`:620-622`):只声明 `(turn_number, message)` 的老 provider 拿不到新 kwargs,但 tick 照发。

---

## 1.3 MemoryManager 内部结构

类定义 `agent/memory_manager.py:196`,自述契约:"Builtin provider (always first) plus at most one external provider. Failures in one provider never block the other: every fan-out hook logs and swallows per-provider exceptions."(`:197-201`)

### 1.3.1 provider 注册表

`__init__`(`agent/memory_manager.py:209-235`)维护:

- `self._providers: list[MemoryProvider]`(`:210`)——注册表本体;
- `self._tool_to_provider: dict[str, MemoryProvider]`(`:211`)——工具名→provider 路由表;
- `self._has_external: bool`(`:213`)——单外部槽占用标记;
- `self._external_prefetch_spill_config`(`:212`)——注册时快照的溢写配置(见下);
- `self._home_key`(`:220`)——构建时(而非调用时)捕获的 profile home 键,进程内多 profile 各自管理器互不串键;
- `self._bound_scope`(`:234`)——`initialize_all` 记录的归属(§3.4);
- `self._tool_call_keywords_cache`(`:235`)——`handle_tool_call` 声明关键字集的按 id 缓存。

`add_provider`(`:269-327`)的四个门口,次序即防御:

1. **单外部槽**:已有外部 provider 再来一个,log warning 后直接 return(`:271-279`)——防工具 schema 膨胀与后端冲突。
2. **schema 先于状态**:`schemas = list(provider.get_tool_schemas())` 在改动任何 manager 状态**之前**执行(`:280-284`,注释钉 #9948:schema 抛异常的 provider 若已污染 `_providers`,会堵死本进程后续所有外部 provider)。
3. **外部专属快照**:非 builtin provider 注册时一次性读 `memory.prefetch_spill_enabled`(默认 False)与溢写配置,不中则把 `max_chars` 放宽到 `max(原值×10, 100_000)`(`:286-297`)——"keep a ceiling so a runaway provider can't overflow the context"(`:294`);注释明言"Snapshot both gates at registration, never re-read them mid-conversation"(`:290-291`)。
4. **核心工具名保留**:provider 工具名撞 `_HERMES_CORE_TOOLS` 者拒入路由表(`:306-318`,#40466:内置工具在 agent 初始化恒赢,残留影子条目会劫持分发);同名冲突后注册者输(`:319-323`)。

### 1.3.2 三门:`_PREFETCH_GATE` / `_BACKGROUND_GATE` / 超时守护

**门本体 `_StuckCallGate`**(`agent/memory_manager.py:142-193`)——按 `(home, provider)` 键的进程级准入控制器。设计动机写在注释里:"Python cannot stop a thread, so every stuck call pins one until it returns"(`:47-48`)。状态四张表(`:153-158`):`calls`(token→(start, deadline))、`last_ok`、`probe_at`、`skips`。

三条常量(`:51/:54/:57`):

```python
_MAX_STUCK_CALLS = 4        # 最近一次成功返回之后启动且超期的调用达 4 个即关门
_PROBE_INTERVAL_S = 60.0    # 关门期间每 60s 放行一个半开探针
_MAX_INFLIGHT_CALLS = 16    # 在飞硬顶(含孤儿):卡死后端最多钉住有界线程数
```

`enter(key, token, timeout)`(`:160-181`)的准入三判,顺序固定:

```python
# agent/memory_manager.py:166-176(节选)
stuck = sum(start > last_ok and now > deadline for start, deadline in calls.values())
if len(calls) >= _MAX_INFLIGHT_CALLS:
    admit = False
elif stuck < _MAX_STUCK_CALLS:
    admit = True
    self.probe_at.pop(key, None); self.skips.pop(key, None)   # 开门即清探针/跳过计数
else:
    admit = now - self.probe_at.setdefault(key, now) >= _PROBE_INTERVAL_S
    if admit: self.probe_at[key] = now
```

要点:**stuck 只数"启动晚于 last_ok 且已超期"的调用**(`:166`)——更早的孤儿属于一次已恢复的故障,不计数;"Calls not yet overdue are not counted, so healthy concurrent sessions run side by side"(`:148-150`)。`leave(key, token, ok=)`(`:183-193`)只摘自己的条目;键下还有别的调用且 `ok` 时刷新 `last_ok`;键清空则连锅端掉四张表——后端恢复后不留陈旧状态。

**两道门是类属性,跨实例共享**(`agent/memory_manager.py:206-207`):

```python
_PREFETCH_GATE = _StuckCallGate()     # 外部 prefetch 线程(#134392)
_BACKGROUND_GATE = _StuckCallGate()   # 后台 sync_turn / queue_prefetch 调用
```

注释解释为何键要含 home:"one gateway process can serve several profiles, each with its own config and credentials for a same-named provider: one profile's hung backend must not silence another's"(`:203-205`)。类属性=进程级(每个 agent 各建新 manager,实例级视图会让每个新 manager 对同一挂死后端再放一个调用、再钉一条线程,`:144-147`)。键由 `_registry_key` 给出:优先 `initialize_all` 绑定的 home,回落构建时 home(`:539-542`)。

**接线一:_PREFETCH_GATE** 在 `_prefetch_provider`(`:357-407`):builtin 走直调(`:360-361`);外部 provider 先 `enter(key, thread, self._external_prefetch_timeout)`——**8s 预取超时兼任该门的逾期判据**(`:376`;`_EXTERNAL_PREFETCH_TIMEOUT_S = 8.0`,`:42`)。被门跳过则空串返回(`:377-380`);线程启动后 `thread.join(self._external_prefetch_timeout)`(`:388`),存活即 warning 并返回空——**超时的调用继续在守护线程上跑**,其门条目要等 `finally` 里的 `leave`(`:372-373`)在该调用真正结束时才摘除,所以在飞超期的调用会累积成 stuck 计数。

**接线二:_BACKGROUND_GATE** 在 `_call_unless_stalled`(`:513-537`):后台类调用(sync_turn/queue_prefetch)以 `_BACKGROUND_CALL_STALL_S = 30.0` 为逾期线 `enter`(`:522`);被跳过时第 1 次与每第 100 次打 warning(`:525-530`)。注释给出阈值关系:"Well above the shutdown drain bound and the prefetch timeout so a slow-but-healthy backend is never counted"(`:43-46`)。**builtin provider 永不过门**(`:517-519`)。

把两道门的生命周期串成一条时间线(以一个网络黑洞的后端为例,全部机制均有上文行号支撑):

1. **t=0**:第 N 轮 prefetch,`enter` 记 `(start=0, deadline=8)`;`join(8.0)` 超时,该轮召回为空,调用继续挂在守护线程上。
2. **t=8+**:该条目 `now > deadline` 且 `start > last_ok`(若 last_ok 从未成功则为 `-inf`,恒真)→ 计入 stuck;第 N+1、N+2、N+3 轮各再进一条,stuck=4。
3. **t≈N+3**:第 4 条 stuck 达标,门关:`enter` 对新调用返回 `(stuck, in_flight, skips)`,prefetch 直接空串返回;`probe_at[key]` 以关门时刻初始化(`:174`)。
4. **关门期**:每 60s 放行一个探针;探针也吃在飞配额(`_MAX_INFLIGHT_CALLS=16` 含孤儿,`:55-57`);连续失败的探针各钉一条线程但不再增殖——"a backend that stays wedged pins a bounded number"。
5. **恢复**:任一探针成功返回,`leave(ok=True)` 刷新 `last_ok`(`:189-190`);此后 `enter` 里 `stuck < 4` 恒真(旧孤儿因 `start < last_ok` 不再计数),门重开且清空 `probe_at`/`skips`(`:169-172`);键下最后一条 `leave` 时四张表连锅清(`:192-193`)。

### 1.3.3 后台线程模型

单 worker、惰性创建、守护线程、按耐久度分类追踪:

- `_sync_executor` 惰性创建于 `_submit_background`(`agent/memory_manager.py:479-489`):`DaemonThreadPoolExecutor(max_workers=1, thread_name_prefix="mem-sync")`(`:486`)——"a wedged provider must never block interpreter exit"(`:484`);**builtin-only 路径一个线程都不开**(`:221-223`)。`DaemonThreadPoolExecutor` 覆写 `submit` 使复用 worker 仍跑在提交者的 contextvars 里(`tools/daemon_pool.py:23-35`,#54937)。
- 提交的任务先经 `ctx_bound(in_owner_home(self._bound_scope, fn))` 双重包裹(`:478`):前者绑提交者上下文,后者**显式**设 owner profile 的 `HERMES_HOME` override(`agent/memory_caller_scope.py:140-154`)——空上下文启动的 worker 不得静默落到默认 profile。
- `self._background_futures: dict[Future, str]` 按耐久度("write"/"prefetch")追踪(`:227`),关停排水按类报告丢弃了什么(§5.3)。
- FIFO 序列化的意义:"The single worker also serializes writes (turn N before N+1)"(`:447`)——外部后端绝不看到乱序轮。
- executor 不可用时**内联执行**作历史兜底(`:508-511`)。
- `flush_pending` 用哨兵任务证明队列排空:"a sentinel task completing proves every earlier task ran"(`:548-558`)。

---

## 1.4 一轮对话的完整记忆时序(逐跳)

以 CLI/gateway 一次 `run_conversation` 为轴,记忆相关的每一跳:

### T0 轮首:进入 `build_turn_context`

`agent/conversation_loop.py:1660` 调 `build_turn_context`(`agent/turn_context.py:1039`,签名 `:1040-1049`)。记忆相关的前置步:

1. `:1095` `_reset_per_turn_agent_state`——其中 `:628-630` 调 `agent._memory_store.reset_consolidation_failures`(整理失败 3 次熔断的计数器每轮重置)。
2. `:1135` `should_review_memory = _tick_memory_nudge(agent)`——`agent/turn_context.py:761-770`:仅当 `_memory_nudge_interval > 0`(默认 10,`hermes_cli/config_defaults.py:1321`;接线 `agent/agent_init.py:1215/:1244`)、`"memory" in agent.valid_tool_names` 且 store 在位时 `_turns_since_memory += 1`,达阈值即清零并返回 True。
3. `:1145-1147` 系统提示按会话缓存(`_cached_system_prompt`)——记忆块只在构建时进入(§4.5),轮中不再变。

### T1 `on_turn_start` → `prefetch_all` → 召回指示

`:1198` `ext_prefetch_cache = _memory_turn_start_and_prefetch(agent, original_user_message, turn_author)`(`agent/turn_context.py:912-940`),三步全包 `suppress(Exception)`:

```python
# agent/turn_context.py:924-932(节选)
agent._memory_manager.on_turn_start(
    agent._user_turn_count, _query,
    author_id=_author.get("id") or None, author_name=_author.get("name") or None,
    author_is_bot=bool(_author.get("is_bot")),
)
ext_prefetch_cache = ""
if not is_trivial_prompt(_query):
    ext_prefetch_cache = agent._memory_manager.prefetch_all(_query, session_id=agent.session_id) or ""
```

- **on_turn_start**(`agent/memory_manager.py:613-624`):先 `_owner_allows` 归属校验(§5.2),消息过 `_redact_for_provider`(`:616`),再按 provider 的 `on_turn_start` 签名过滤 kwargs 后逐个 fan-out(`:620-622`——只声明 `(turn_number, message)` 的老 provider 照样拿到 tick)。
- **prefetch_all**(`:346-355`):剥 skill 脚手架(`:344`,/skill 或 /bundle 轮只取用户指令),query 过出口脱敏(`:351`),逐 provider 走 `_prefetch_provider`(§3.2 门+8s join),结果非空段以 `\n\n` 连接。
- **溢写护栏**:外部 provider 非空召回先过 `spill_if_oversized(result, session_id=..., source=f"{provider.name} memory prefetch", config=self._external_prefetch_spill_config)`(`agent/memory_manager.py:400-407`→`tools/hook_output_spill.py:64`)——超大召回溢写落盘而不是灌满此后每一轮的上下文;该配置(含默认放宽的 `max_chars`,§1.3.1)是注册时快照,会话中不再重读。
- **召回指示**:`ext_prefetch_cache` 非空时 `describe_recall()`(`agent/turn_context.py:937`)→ `agent._emit_status(_recall_indicator)`(`:939`)——确定性渲染「🧠 Provider — recalled N memories」,**不依赖模型开口**(`agent/memory_manager.py:409-411`)。
- 查询文本取 `_memory_query_text`(`agent/turn_context.py:903-909`):多模态(list)轮 flatten 成文本,纯图轮仍为空→trivial→跳过召回。

### T2 注入落位:api_content 边车 stamp

回到 `build_turn_context`,`:1206-1216` 二选一:

- 字符串 content 且非 MoA/codex_app_server:`_stamp_api_content_sidecar`(`agent/turn_context.py:943-987`)。`compose_user_api_content`(`:121-132`,docstring:"Single source for the api_content sidecar and the wire bytes so they never drift")组合 `content + "\n\n" + 注入块`,写入 live dict 的 `api_content` 键(`:959`);若该轮用户行已被别的写者先落库(就地压缩/抢跑的 flush),持 `_session_persist_lock` 读 `_row_id` 后以行寻址 SQL 回填(`:973-985` → `hermes_state_api_content.py:41-70` 的 `UPDATE messages SET api_content = ? WHERE id = ? AND session_id = ? AND role = 'user' AND active = 1 AND content IS ?`;无行号时退化 `set_latest_user_api_content` 的 `ORDER BY id DESC LIMIT 1` 定位,`hermes_state_api_content.py:17-38`)。
- 多模态(list)content:`_append_multimodal_context`(`agent/turn_context.py:990-1019`)把注入块作为持久 text part 追加,同一 `_row_id` 协议回写。

注入块的包装由 `build_memory_context_block` 完成(`agent/memory_context.py:169-185`):`<memory-context>` 围栏 + 系统注记("[System note: ... NOT new user input. Treat as authoritative reference data ...]"),并做同 section 字节级 bullet 去重(`:123-166`;去重理由写在 docstring:边车内容此后每轮原样回放,"each duplicate is paid once per turn, forever")。

持久化侧的对偶:落行时若 `sanitize_context(content).strip() != content.strip()`(即内容带围栏、回放会剥掉它),就把原文捕获为 `api_content` 保存(`agent/session_persistence.py:224-232`,注释:"get_messages_as_conversation replays rows through sanitize_context().strip(); capture the sent bytes when they would differ")——持久行是干净文本,发送字节住边车,围栏只活在 API 副本里。

`:1218` `_persist_turn_start` 持锁落库(崩溃韧性:首次 LLM 调用前行已在、边车已终)。

### T3 请求构建与流式回答

- **API 时**:工具循环每 pass 调 `build_api_messages`(`agent/turn_context.py:1249-1362`)。历史行:从发送副本 pop `api_content`(`:1293`),若为非空字符串且 role∈(user, assistant) 则**原样回放 exact bytes**(`:1311-1318`);当轮用户行:优先复用轮首 stamp(`:1300-1303`,"Reuse the prologue's stamp so sidecar and wire cannot drift and every pass this turn sends identical bytes"),绕过 prologue 的调用方才现场组合(`:1305-1310`)。这就是 P1 的逐 pass 字节稳定。
- **流式剥离**:scrubber 实例是 agent 状态(`agent/agent_init.py:552`,`_STREAM_STATE` 挂 `StreamingContextScrubber`),流管线在每个 delta 上 `scrubber.feed(text)`(`agent/stream_delivery.py:358`)。状态机(`agent/memory_context.py:30-115`)持 partial-tag 尾巴跨 delta 剥 `<memory-context>` span;`flush()` 在流结束时,若仍处未闭合 span 内,**丢弃尾巴**——`:83` `tail = "" if self._in_span`,docstring:"leaking partial memory context is worse than a truncated answer"(`:81-82`)。

### T4 工具循环:两条工具分发路

模型发起工具调用后,分发优先级(`agent/inline_tool_executors.py:320-335`):`todo_list/session_search/memory` 三个内联优先,然后 memory-manager 工具,再其余内联。

- **内置 `memory` 工具** → `_memory`(`agent/inline_tool_executors.py:142-162`):调 store 完成写,然后镜像:

```python
# agent/inline_tool_executors.py:153-161(节选)
if agent._memory_manager:
    agent._memory_manager.notify_memory_tool_write(
        result, args,
        build_metadata=lambda: agent._build_memory_write_metadata(
            task_id=ctx.effective_task_id, tool_call_id=ctx.tool_call_id),
    )
```

  `notify_memory_tool_write`(`agent/memory_manager.py:778-827`)先以 `_memory_tool_result_succeeded` fail-closed 门控(`:767-776`:非 JSON/非 dict/`success != True`/`staged == True` 一律不镜像——provider 绝不镜像未落地的写),再展开单操作/批量 `operations`,只保留 `_MIRRORED_MEMORY_ACTIONS = {"add","replace","patch","remove"}`(`:765`),patch 翻译成整条 replace(`:815-824`),`previous_content` 只取 store 提交结果、绝不取搜索参数(`:784-786`),最后走 `on_memory_write`(`:744-761`,仅外部 provider、content+metadata 出口脱敏 `:749`)。
- **provider 工具**(如 `hindsight_retain`/`honcho_search`,不在注册表)→ `agent/tool_executor.py:1706-1716` 判 `agent._memory_manager.has_tool(function_name)` 后 `_SequentialDispatch` 包 `agent._memory_manager.handle_tool_call(function_name, next_args, caller_gsk=...)`;并发路 `resolve_invoke_tool_executor` 同形(`agent/inline_tool_executors.py:330-333`)。`handle_tool_call`(`agent/memory_manager.py:589-611`):路由表查 provider(`:591`)→ `caller_scope` 归属校验失败即拒绝(`:594-596`)→ 按缓存的关键字集过滤 kwargs(`:599-601`)→ **args 过出口脱敏**(`:602`)→ 调 provider(`:605`),异常记 observability 并回 `tool_error` JSON(`:606-609`)。

### T5 轮尾:`sync_all` + `queue_prefetch_all`

`finalize_turn`(`agent/turn_finalizer.py:590`)在交付用户之后调 `agent._sync_external_memory_for_turn`(`agent/turn_finalizer.py:839-843`)→ `run_agent.py:888-919`:

- **中断轮整体跳过**:`if interrupted or not (self._memory_manager and final_response and original_user_message): return`(`run_agent.py:901`)——docstring 钉 #15218:"partial output is not durable truth ... The prefetch is gated on the same flag"(用户下一条消息多半是同一意图的重试,基于中断轮的预取会对着陈旧上下文开火)。
- `:914` `sync_all(user_text, response_text, **sync_kwargs)`(messages 与 turn_author 按有无所附);`:916-917` 非 trivial 才 `queue_prefetch_all(user_text, session_id=...)`。
- `sync_all`(`agent/memory_manager.py:441-472`):剥 skill 脚手架 → 归属校验 → **三个值(用户文本、助手文本、messages 切片)整体过 `_redact_for_provider`**(`:458-459`)→ 按各 provider 的 `sync_turn` 签名挑选可选 kwargs(`:462-468`)→ `_submit_background` 排入单 worker(`:470-472`,kind="write")。
- `queue_prefetch_all`(`:422-433`)同样脱敏 query(`:428`)后排入同一 worker(kind="prefetch"),worker 内逐 provider `_call_unless_stalled(p, lambda: p.queue_prefetch(...))`(`:429-433`)——为下一轮预排队召回。

随后 `turn_finalizer.py:845-859`:若 `final_response` 非空、未中断、未禁后台 review 且 `_should_review_memory or _should_review_skills`,`agent._spawn_background_review(messages_snapshot=list(messages), review_memory=..., review_skills=...)`(`run_agent.py:752` 定义;本地托管 llama-server 运行时会 defer 到机器空闲,`:756-757`)。注意 `turn_finalizer.py:866-867` 的显式声明:"Memory provider on_session_end()/shutdown_all() are NOT called here: run_conversation() runs once per message; CLI/gateway own session-end cleanup."——轮 ≠ 会话。

### T6 压缩前:fail-closed 检查点(压缩发生时插入)

压缩触发时 `conversation_compression.py:2889-2929` `_pre_compress_memory_context`:能力探测(`:2897-2907`,无 provider 或不支撑 checkpoint API v2 即 `_checkpoint_incapable`)→ `memory_manager.on_pre_compress(messages, evidence_messages=..., require_checkpoint=True, checkpoint_api_version=2)`(`:2911`,异常转 `CompressionCheckpointUnavailable`);非必需路径 `:2922` best-effort。manager 侧 `on_pre_compress`(`agent/memory_manager.py:693-733`):归属拒绝且 require 即 raise(`:702-705`);逐 provider 分流 v1 原始/v2 evidence 消息并按签名传 `require_checkpoint`(`:713-719`);checkpoint provider 异常原样上抛(`:725-728`);require 而无一成功即 `RuntimeError`(`:729-732`)——调用方因此保留未压缩 transcript(P3)。

### T7 会话边界:四类钩子各归其位

| 边界 | 入口 | 链 |
|---|---|---|
| CLI/进程关停 | `AIAgent.close()`(`run_agent.py:938`)→ `shutdown_memory_provider`(`:867-879`) | `claim_teardown(session_end=True)`(`:873`)→ `on_session_end(messages)`(`:875`)→ `shutdown_all()`(`:878`) |
| 网关逐出(资源性) | `release_clients`(`run_agent.py:921`) | `:933-934` `release_soft()`(`agent/memory_manager.py:850-856`):flush 10s 后 shutdown_all,**不做** on_session_end |
| 网关边界逐出(/reset、压缩) | `_evict_cached_agent_at_boundary`(`gateway/run_agent_cache.py:872-876`) | `_commit_then_release_soft`(`:941-944`)先 `commit_memory_session`(`run_agent.py:881-886`→`on_session_end`)再软释放;释放线程显式跑在**拥有该 session key 的 profile** 作用域里(`:897-920`) |
| CLI /new(轮转不拆 provider) | `hermes_cli/cli_session_mixin.py:652` | `commit_session_boundary_async`(`agent/memory_manager.py:633-664`):`on_session_end` 与 `on_session_switch(reset=True)` 作为**同一任务**排进单 worker——docstring 钉 #16454:内联阻塞 /new 数秒,临时线程又与就地 switch 竞态把转录记错会话;单 worker FIFO "serializes end→switch against every other provider write" |

网关关停路径另有排水前置:`gateway/run_shutdown.py:1265-1288` `_cleanup_agent_resources` 先 `claim_teardown(session_end=True)` 再 `flush_pending(timeout=10)`——注释钉 #73297:"shutdown_all() gives the single serialized worker only ~5s and cancels the rest, so a /reset or rotation could drop writes"。

---

## 1.5 agent 初始化与主循环的接线点

记忆面在 agent 构建中一次接妥,入口 `_init_memory`(`agent/agent_init.py:1210-1281`),由 `create_agent` 在 `:2245` 调入(`memory_manager=None` 是默认形参,`run_agent.py:279`):

```python
# agent/agent_init.py:1246-1252(内置库)
agent._memory_store = MemoryStore(
    memory_char_limit=mem_config.get("memory_char_limit", 2200),
    user_char_limit=mem_config.get("user_char_limit", 1375),
    memory_enabled=agent._memory_enabled,
    user_profile_enabled=agent._user_profile_enabled,
)
agent._memory_store.load_from_disk()
```

随后外部 provider 三分支(`:1254-1278`):

1. **传入已初始化 manager**(网关逐轮重建 agent 复用会话 manager):直接挂 `agent._memory_manager = memory_manager`,**不再 initialize_all**——providers 保住跨轮 prefetch/retain 状态(#120116,`:1257-1260`)。
2. **skip_memory**:manager 置 None;但 `enabled_toolsets=["memory"]` 仍给内置库,保证 memory 工具不见 store=None(#65429,`:1223-1229`)。
3. **正常路径**:配置 `memory.provider` 非 core 哨兵(`is_core_memory_provider`,`agent/memory_provider.py:47-49`)时,new `MemoryManager()`(`:1266`)→ `resolve_memory_provider(_mem_provider_name, say=agent._emit_startup_warning)`(`:1267`)→ `add_provider(_mp)`(`:1269`)→ `initialize_for_agent(say=..., **_memory_provider_init_kwargs(...))`(`:1270-1271`);失败或零 provider 则 manager 置 None(`:1275-1278`)。safe_worker 模式直接无记忆(`:1220-1222`)。

`resolve_memory_provider`(`agent/agent_init_memory_provider.py:50-82`)的三级挽留:装载失败先查"已安装但被停用"(parked,`:56-60`,绝不自动重装);目录在而加载失败→查 left-core 迁移自愈 `recover_at_startup`(`:63-66`);仍失败→按 (home, provider, kind) 去重的一次性用户告警(`:67-71`)。`is_available()` False 也走一次性告警并附 `unavailable_reason()`(`:72-81`)。

`_memory_provider_init_kwargs`(`agent/agent_init.py:1172-1207`)固定注入 `session_id`/`platform`/`hermes_home`/`agent_context`(cron/subagent 上下文让 provider 跳写,`:1180`);CLI 才给 `status_callback`(召回指示的出口,`:1182-1184`);另附会话标题、网关身份、cwd、profile 身份。

初始化收尾 `inject_memory_provider_tools(agent)`(`agent/agent_init.py:1280-1281`;实现 `agent/memory_manager_tools.py:63-106`):同一道 toolset 门(`memory_provider_tools_enabled`,`:27-44`)决定 provider 工具 schema 是否追加进 `agent.tools`——门关时打 info 说明是哪个配置键关的(#81014,`:70-84`),且系统提示侧 `_memory_parts`(`agent/system_prompt.py:522-549`)用**同一道门**,保证 provider 的 system_prompt_block 绝不宣传工具面上不存在的工具。

主循环侧接线:会话启动时 `_init_memory` 装的快照进系统提示(`agent/system_prompt.py:527-529` 读 `_memory_store.format_for_system_prompt`、`:535-543` 拼 `build_system_prompt()`);每轮 `run_conversation` → `build_turn_context`(§4);工具循环按 §4.4 分发;轮尾 `finalize_turn`(§4.5)。流式 scrubber 实例在 `_STREAM_STATE` 声明(`agent/agent_init.py:552`),每轮轮首由 `_reset_per_turn_agent_state` 重置(`agent/turn_context.py:665-669`:两个 scrubber 名字循环 `reset()`)。

---

## 1.6 失败隔离与 provider 退出

### 1.6.1 逐 provider 静默隔离

`_each_provider` 是所有 fan-out 的漏底(`agent/memory_manager.py:237-247`):逐 provider try/except,失败 `logger.log(level, "Memory provider '%s' %s: %s", ...)` 后继续下一个。各出口的日志级别刻意分层:prefetch/queue_prefetch/turn_start 用 DEBUG("non-fatal"),sync_turn/on_session_end/system_prompt_block 用 WARNING(`:338-340/:430-431/:471/:630`)。轮首侧再包一层:`_memory_turn_start_and_prefetch` 对 on_turn_start、prefetch、recall 指示各套 `suppress(Exception)`(`agent/turn_context.py:923/:930/:936`)——记忆子系统任何故障都不许打断一轮对话的开始。

### 1.6.2 出口脱敏:九个出口先过闸(P5)

`_redact_for_provider`(`agent/memory_manager.py:99-135`)递归 walk dict/list/tuple,字符串全过 `_scrub`→`redact_for_egress`(`:89-93`,fail-closed,与 `security.redact_secrets` 开关无关);被掩码的 token 进 learned 集,对同批其他值二次 `[redacted]` 屏蔽(`:125-134`,防"密钥在工具结果里被掩、模型在散文里复述"漏网)。本次亲核的九个调用点:`prefetch_all` query(`:351`)、`queue_prefetch_all` query(`:428`)、`sync_all` 三值(`:458`)、`handle_tool_call` args(`:602`)、`on_turn_start` message(`:616`)、`on_session_end` messages(`:629`)、`on_pre_compress` 双消息表(`:708`)、`on_memory_write` content+metadata(`:749`)、`on_delegation` task+result(`:832`)。

### 1.6.3 `_drop_provider`:唯一的注册表收缩路径

```python
# agent/memory_manager.py:263-267
def _drop_provider(self, provider: MemoryProvider) -> None:
    self._tool_call_keywords_cache.pop(id(provider), None)
    self._providers = [p for p in self._providers if p is not provider]
    self._tool_to_provider = {t: p for t, p in self._tool_to_provider.items() if p is not provider}
    self._has_external = any(p.name != "builtin" for p in self._providers)
```

全库唯一生产调用在 `initialize_all`(`:919-930`):注入 `hermes_home`(`:921-923`)→ `bound_scope` 记录归属(`:924`)→ 逐外部 provider `claim_instance(provider, kwargs["hermes_home"])`,False 即 drop(`:926-928`)——同实例被别的 profile 先绑定的,本 profile 拒绝重绑(#140058;`agent/memory_caller_scope.py:111-137`,multiplexed 进程上同实例他 profile 已绑定即 False,不可 weakref 跟踪的实例也 False)。**用户可见反馈**由外层 `initialize_for_agent`(`:906-917`)补:对比 drop 前后名单,被 drop 的 provider 逐个经 `say`(agent 启动告警 sink)告知"⚠ Memory provider ... disabled for this profile ... Built-in memory still works"(`:912-916`)——provider 静默缺失就是记忆丢失,不能只写日志。

被 drop 的 provider **不 shutdown**(`_drop_provider` 不调 `shutdown`)——实例可能仍被首个绑定的 profile 活着使用,本 manager 只是不再触达它。

### 1.6.4 归属三闸的运行时接线(P10)

- **`caller_scope`**(`agent/memory_caller_scope.py:71-100`):每次工具调用与生命周期钩子前经 `_owner_allows`(`agent/memory_manager.py:249-252`)/`handle_tool_call:594` 校验;multiplexed 进程上不具名 profile 的调用者直接拒绝(`:83`),具名但与绑定 profile 不符也拒绝(`:94`);拒绝理由只进日志,模型/聊天只看通用拒语(`:36-38`)。
- **`claim_instance`**:见 §5.3;全局 `_claims` 表按 `id(provider)` 弱引用跟踪(`:32`),弱引用回调只摘自己的条目(`:103-108`,防 id 复用误删新 claim)。
- **`in_owner_home`**(`:140-154`):后台提交时显式 set/reset `HERMES_HOME` override,接线于 `_submit_background:478`。

### 1.6.5 teardown 所有权与有界排水

`claim_teardown(*, session_end: bool)`(`agent/memory_manager.py:838-848`)是关停互斥:首个 claimer 赢,输家跳过——providers 无幂等契约,绝不 shutdown 两次;session_end claim 可被网关 flush 后二次复用,soft release 一次性且让位于已在排水的 manager。`shutdown_all`(`:858-862`)先 `_drain_sync_executor`(`:870-904`):置 `_shutting_down`、快照在册 futures(`:876-881`)→ `executor.shutdown(wait=False, cancel_futures=False)` 关提交不搅 FIFO(`:887`)→ `wait(tracked, timeout=5.0)`(`:888`,`_SYNC_DRAIN_TIMEOUT_S=5.0`,`:41`)→ 超时后对未完成 future 逐个 `cancel`,按耐久度计数 `abandoned_writes`/`abandoned_prefetches`/`active_tasks`(`:889-897`)并 warning 报告"abandoning N queued memory write(s) and M queued prefetch(es)"(`:900-904`)——**显式报告丢弃了什么**而不是吞掉。`shutdown_drain_state` 属性(`:864-868`)留最近一次排水快照供观测。

---

## 1.7 复用要点(设计者清单)

1. **两层记忆面不要互相代理**:内置层与外部层并行,唯一桥是成功写的镜像;镜像必须 fail-closed 判定"真的落库了"(success 且非 staged)。
2. **召回注入三定律**:轮首一次性组合、边车持久化 exact bytes、逐 pass 复用同一 stamp——发送字节、持久化字节、回放字节单一来源。
3. **后台写永远不内联**(除兜底)、永远单 worker FIFO;轮序即写序。
4. **卡死准入做成进程级、按 (home, provider) 键**:stuck 只数"last_ok 之后启动且超期"的;关门后 60s 半开探针;在飞 16 硬顶;阈值阶梯 drain(5s) < prefetch(8s) < stall(30s) 保证慢而健康的后端永不被误判。
5. **每条 provider 出口都要过同一把脱敏闸**,闸本身 fail-closed;token 同批二次屏蔽。
6. **关停要 claim 互斥 + 有界排水 + 丢弃计数显式上报**;轮与会是两个生命周期,on_session_end 只属于会话边界。
7. **provider 声明式能力用签名内省适配**(`inspect.signature` + `**kwargs` 检测),老 provider 不改代码也能继续收到新事件的降级形态——但 `require_checkpoint` 这类"语义关键字"必须先探测签名再传,否则裸形状 v2 provider 会被宿主误判为检查点失败(`agent/memory_manager.py:74-84`)。
