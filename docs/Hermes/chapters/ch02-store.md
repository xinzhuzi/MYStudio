# 第二章 内置记忆存储契约:MemoryStore 与 memory 工具

> 本章支撑报告支柱:**P9(硬限额+显式整理协议)**、**P11(冻结快照注入)**,并覆盖 **P7(审批 pin)与 P8(威胁扫描)在存储侧的落点**。
> 路径约定:本章所有代码引用相对 Hermes 检出根 `~/.hermes/hermes-agent/`(行号经本轮逐行亲核);`docs/Hermes/hermes-memory-report.md` 为语境真源。
> 本章为只读研究产物:未运行任何 Hermes 代码;盘上样例取自本机 `~/.hermes/memories/` 只读 cat(见 §2.1.3)。

---

## 2.0 概览:两个文件、一个工具、四条不变量

Hermes 的内置精选记忆(built-in curated memory)由两个文件、一个工具类、一个 LLM 工具构成:

| 角色 | 实体 | 落点 |
|---|---|---|
| 存储 | `$HERMES_HOME/memories/MEMORY.md`(agent 笔记)/ `USER.md`(用户画像) | `tools/memory_tool.py:38-40` `get_memory_dir()` |
| 存储类 | `MemoryStore`(一个 AIAgent 一个实例) | `tools/memory_tool_store.py:177-180` |
| LLM 工具 | 单一 `memory` 工具(add/patch/remove 或 `operations` 批量) | `tools/memory_tool.py:373-438`(schema)、`:468-477`(注册) |
| 装载 | `_init_memory` 构建 agent 时 load 并冻结快照 | `agent/agent_init.py:1210-1252` |

存储契约建立在四条不变量上,后文逐条展开:

1. **文件是条目流**:条目以 `\n§\n` 连接,无任何文件头(§2.1);
2. **预算是硬闸**:字符预算只对写入终态检查,超限零写入、报错返回余量,绝不静默压缩(§2.2);
3. **写路径是锁下读-改-写**:旁路 `.lock` 文件 + 盘上重读 + 临时文件原子替换,读失败/外部漂移拒绝写(§2.4/§2.5);
4. **系统提示读的是冻结快照**:轮中写盘落盘但不改提示字节,保前缀缓存(§2.6)。

---

## 2.1 文件格式:MEMORY.md / USER.md

### 2.1.1 盘上格式:纯条目流,无头部

文件本体**没有任何头部、frontmatter 或元数据**,就是条目用分隔符连接的纯文本。分隔符是模块常量:

```python
# tools/memory_tool_store.py:23-26
MEMORY_BLOCK_HEADERS = {
    "memory": "MEMORY (your personal notes)", "user": "USER PROFILE (who the user is)"}

ENTRY_DELIMITER = "\n§\n"
```

注意 `MEMORY_BLOCK_HEADERS` 不是文件头——它只用于系统提示渲染块(§2.1.4)。`tools/memory_tool_store.py:21-22` 的 lockstep 注释**声称** `agent/conversation_compression.py` 会匹配这两个标题检测"目标被清空后残留的块",但该声称在当前检出无落点(本轮独立核证:对 `agent/conversation_compression.py`(249,759 字节)grep `MEMORY_BLOCK_HEADERS|USER PROFILE|your personal notes|_render_block|═` 零命中;全仓库 `MEMORY_BLOCK_HEADERS` 仅 `memory_tool_store.py:23`(定义)/`:674`(`_render_block` 使用)/`memory_tool.py:44`(导入)三处,标题文本唯一其他落点是测试夹具 `tests/agent/test_413_compression.py:631`)。真实机制已换血:现行压缩路径**无条件重建**系统提示("ALWAYS rebuild",`agent/conversation_compression.py:3111-3113`),其注释点名旧 "keep-prompt containment branch"——即当年做标题包含判定的那段——已因"prompt-builder 变更永远到不了长会话"被移除(`:3113-3118`);上述测试(`test_compression_rebuilds_when_prompt_has_leftover_block_for_emptied_memory`,:621 起)在 always-rebuild 制度下继续守"清空后残留块必须触发重建"的行为。结论:lockstep 注释相对当前树**已过期**(声称的消费者不存在),复用者改标题文本 today 无树内代码消费者,但标题字节已烙进历史持久化提示与测试夹具,仍不宜轻改。

解析侧只有一个函数,分寸全在细节里:

```python
# tools/memory_tool_store.py:695-698
@staticmethod
def _parse_entries(raw: str) -> list[str]:
    """Stripped, non-empty entries; splits on the FULL delimiter so a bare "§" survives."""
    return [e for e in (x.strip() for x in raw.split(ENTRY_DELIMITER)) if e]
```

三个语义要点:
- **按完整分隔符切分**:条目内部孤立的 `§` 字符不会被切断(`:697` docstring);
- **条目两端 strip、空条目丢弃**:所以盘上 `A\n§\n\n§\nB` 与 `A\n§\nB` 解析等价;
- **加载时去重**:`load_from_disk` 用 `list(dict.fromkeys(...))` 保序去重(`:246`);`_mutate` 每次写前重读盘也做同样去重(`:367`)。

编码契约在读取函数里钉死(`tools/memory_tool_store.py:677-693`):`utf-8-sig` 读入(剥 Notepad 写入的 UTF-8 BOM,锚 #10878/PR #10888——plain utf-8 会把 U+FEFF 粘死在首条目上,永久污染匹配与去重),**解码失败保持 strict**:`errors="replace"` 会让读-改-写调用方拿到有损视图再存盘覆写真实字节,因此 `UnicodeDecodeError`/`OSError` 一律返回 `read_ok=False` 走"读失败拒写"(§2.4.2)。

### 2.1.2 "条目结构"约定:没有结构

条目就是任意非空字符串——没有 key/value、没有时间戳、没有 ID。定位靠内容本身:`old_text` 子串匹配(§2.3.3),审批钉死靠整条目全文(§2.3.5)。这是刻意选择:条目要进系统提示(`_scan_memory_content` 的 docstring 明言 "memory enters the system prompt, so a poisoned entry persists across sessions",`tools/memory_tool_store.py:29-32`),保持纯文本使威胁扫描、匹配折叠、人工编辑都作用于同一份字节。

### 2.1.3 真实盘上样例(本机只读取证)

本机 `~/.hermes/memories/` 下四件:`MEMORY.md`、`USER.md` 与各自的 `.lock`(锁文件,§2.4.1)。`cat ~/.hermes/memories/MEMORY.md` 开头(节选):

```
当前项目 > MA: `/Users/zhengbingjin/Project/Unity/MA/` 千年志*道劫 DNF风格2.5D横版ARPG …
§
.
§
道劫关键设定(防误判): 晏燎不是天生半妖!纯人族,妖族灵气来自码头帮工时半妖老汉血溅手臂偶然渗入(事件#3)。…
§
审查经验: (1)标题vs正文比对细纲。(2)AI改细纲会虚构技能名。…
```

`USER.md` 开头:

```
基本信息: **称呼**: 主人（郑冰津）
§
基本信息: **语言偏好**: 中文
§
基本信息: **时区**: Asia/Shanghai (UTC+8)
```

可实证三点:①`§` 独占一行即 `\n§\n` 的落盘形态;②第二条 `.` 是真实存在的噪声条目(strip 后仍非空所以存活)——文件格式对内容零假设;③USER.md 条目自带人工前缀(`基本信息: `),那是写条目者自己的约定,存储层不感知。

### 2.1.4 系统提示渲染块:头部只在这里出现

文件无头,但注入系统提示时有渲染块。`_render_block`(`tools/memory_tool_store.py:669-675`):

```python
def _render_block(self, target: str, entries: list[str]) -> str:
    """System prompt block: header + usage indicator + entries ("" when empty)."""
    if not entries:
        return ""
    content, sep = ENTRY_DELIMITER.join(entries), "═" * 46
    title = MEMORY_BLOCK_HEADERS["user" if target == "user" else "memory"]
    return f"{sep}\n{title} [{self._usage_pct(target, len(content))}]\n{sep}\n{content}"
```

渲染形状:46 个 `═` 分隔线 + 标题行(含用量百分比,`_usage_pct` 格式为 `"42% — 924/2,200 chars"`,`:320-322`)+ 第二条分隔线 + 条目正文。空 store 渲染为 `""`(`format_for_system_prompt` 对空串返回 `None`,`:652`)。这个渲染结果在加载时被冻结进快照(§2.6),不是每轮现算。

---

## 2.2 字符预算:2200/1375 的确切口径

### 2.2.1 预算值与配置链

默认值 `memory=2200` / `user=1375` 在代码中三处钉死,单位是**字符**(模块 docstring:"budgets are in chars (model-independent)",`tools/memory_tool_store.py:2`):

- `MemoryStore.__init__(self, memory_char_limit: int = 2200, user_char_limit: int = 1375, *, memory_enabled=True, user_profile_enabled=True)`(`tools/memory_tool_store.py:188-189`);
- 无 agent 上下文的加载兜底 `MemoryStore(int(mem_cfg.get("memory_char_limit", 2200)), int(mem_cfg.get("user_char_limit", 1375)), …)`(`tools/memory_tool.py:56-57`,服务于 gateway/Desktop//memory,保证审批路径与 `agent_init` 用**同一套上限**);
- agent 构建路 `_init_memory`:`MemoryStore(memory_char_limit=mem_config.get("memory_char_limit", 2200), user_char_limit=mem_config.get("user_char_limit", 1375), …)`(`agent/agent_init.py:1246-1250`)。

即用户可在 config.yaml 的 `memory` 节覆写 `memory_char_limit`/`user_char_limit`(读取经 `get_builtin_memory_config`,`tools/memory_tool.py:292-303`;该节缺失/畸形时回落 `{}` → 双开关默认 enabled,`:306-309`)。

### 2.2.2 计算口径:含分隔符的 join 长度

预算的分子不是条目字符和,是**含分隔符的 join 总长**:

```python
# tools/memory_tool_store.py:311-312
def _char_count(self, target: str) -> int:
    return len(ENTRY_DELIMITER.join(self._entries_for(target)))
```

N 条目总长 = Σlen(entryᵢ) + 4×(N−1)(分隔符 `\n§\n` 占 4 字符)。判断口径处处一致:单条 add 用 `len(ENTRY_DELIMITER.join(entries + [content])) > limit`(`:408`)、replace/patch 用改后列表的 join 长(`:505`/`:454`)、batch 用终态 join 长(`:618`)。

**预算只在写入时检查,加载不截断**:`load_from_disk` 发现盘上超限只 `logger.warning`(文案注明 "further additions are blocked until it is back under the limit"),条目照常全量加载——外部写者(MCP 桥、手编)超限后,超限块会继续进提示,只是后续 add 全被拒,直到整理回限内(`tools/memory_tool_store.py:249-254`,锚 #10877;"never truncate a user's memories")。

### 2.2.3 超限返回文案原文

**单条 add 超限**(`_add_overflow`,单 op 路与单元素 batch 共用;`tools/memory_tool_store.py:329-337`):

```python
def _add_overflow(self, target: str, content: str, limit: int) -> dict[str, Any]:
    """A lone add over budget, legacy or one-item batch: the model has not consolidated yet,
    so the live entries come back (its prompt snapshot may predate other sessions' writes)."""
    over = len(ENTRY_DELIMITER.join(self._entries_for(target) + [content])) - limit
    return self._failure_with_entries(target, (
        f"Memory at {self._char_count(target):,}/{limit:,} chars; adding this entry ({len(content)} chars) "
        f"would exceed the limit by {over:,} chars. Retry as ONE 'operations' batch that "
        f"removes or shortens (patch) stale entries from current_entries below to free at least "
        f"{over:,} chars AND adds this entry — the limit is checked only on the batch result."))
```

行为三件套:错误经 `_failure_with_entries`(`:324-327`)附 `current_entries`(live 现有条目,docstring 解释为何要带:模型的提示快照可能早于其他会话的写盘)与 `usage`;`failure_class="over_budget"`;再经 `_consolidation_failure` 计数(§2.2.5)。

**batch 终态超限**(报告 P9 引用的原文;`tools/memory_tool_store.py:618`+`623-628`):

```python
new_total = len(ENTRY_DELIMITER.join(working))  # budget check against the FINAL state only
...
if grows and new_total > limit:
    if len(ops) == 1 and ops[0].get("action") == "add":  # the advertised single add
        return self._add_overflow(...)
    return self._batch_failure(target, (
        f"Applying all {len(operations)} operations {_over_limit(new_total, limit)} more. Add "
        f"removes or shortening patches of other stale entries to the same batch, then retry."),
        "over_budget")
```

其中 `_over_limit(n, limit)` 生成 `"would put memory at {n:,}/{limit:,} chars: free at least {n-limit:,} chars"`(`:129-130`)。batch 失败**不回 current_entries**(caller 手里已有清单;回显会让每次整理重试膨胀它本要收缩的上下文,锚 #97316,`:339-348`)。

**patch 超限**:`"Patch would put memory at {new_total:,}/{limit:,} chars. Shorten the new text, or 'remove' other stale or less important entries to make room (see current_entries below), then retry — all in this turn."`(`:456-459`)。**replace 超限**:同样附 current_entries 并指示改用 batch(`:507-510`)。

### 2.2.4 终态检查的三条豁免与一道底线

- **grows 判定**:纯 remove batch、或"单 op 且 working == entries"(幂等重复 add,`:527-528` 跳过重复不失败)不算增长,不因旧上限遗留的超限被拒(`:620-622`)——降上限后 prune 是唯一回限路径,不能堵死;
- **批量清空拒绝**:`entries and not working and not (len(ops)==1 and ops[0]["action"]=="remove")` 时拒绝,文案 `"Refusing to empty {MEMORY.md|USER.md}: this batch would remove every entry from a previously non-empty store. …To delete the final entry deliberately, remove it alone in a one-item batch."`,failure_class=`would_empty`(锚 #103419;`tools/memory_tool_store.py:606-617`);
- **单元素 batch 的 add** 走 `_add_overflow` 而非通用 batch 文案(`:624-625`),让"广告位的单 add"拿到带 current_entries 的可行动错误。

### 2.2.5 整理熔断:每轮 3 次失败后终态放行

防"脆弱的 replace/add 把轮循环到预算耗尽、压掉用户回复"(锚 #42405):

```python
# tools/memory_tool_store.py:186
_MAX_CONSOLIDATION_FAILURES_PER_TURN = 3
```

`_consolidation_failure`(`:206-221`):overflow/zero-match 类失败每次 +1;未超 3 原样返回(响应里有重试指引);超 3 后丢弃重试指引,返回终态结果 `{"success": False, "done": True, "error": "Memory consolidation failed {N} times this turn. Stop retrying memory calls — leave memory unchanged for now and continue with your reply to the user. The fact can be saved in a later turn."}`(failure_class=`retry_cap`)。计数器两个复位点:轮边界 `reset_consolidation_failures()` 由 `agent/turn_context.py:628` 的 `_reset_per_turn_agent_state` 调用;成功写盘即清零(连续失败计数,非轮内终身计数,`_success_response` 内 `:660-662`)。

---

## 2.3 memory 工具完整契约

### 2.3.1 注册与 schema

注册(`tools/memory_tool.py:468-477`):`registry.register(name="memory", toolset="memory", schema=MEMORY_SCHEMA, handler=…, check_fn=check_memory_requirements, emoji="🧠", dynamic_schema_overrides=_build_memory_schema_overrides)`。

`check_memory_requirements`(`:312-318`,`@no_cache_check_fn` 标记本地配置检查不缓存)快照双开关进 ContextVar `_memory_surface_flags`(`:35`),供**同一次工具定义 pass** 内的 `dynamic_schema_overrides` 收窄 target 枚举(只开一个 store 时枚举只剩一个、description 换成 `_SINGLE_TARGET_TEXT` 单目标文案,`:441-463`)——注释明言这是防 availability 与 schema 用两次配置读取产生分叉(`:32-34`)。

`MEMORY_SCHEMA` 参数面(`:401-437`):

| 字段 | 类型 | 约束 | 说明摘译 |
|---|---|---|---|
| `target` | string enum `["memory","user"]` | required | memory=个人笔记;user=用户画像 |
| `operations` | array of object | required | 一次调用原子应用;"单个变更就是单元素列表" |
| `operations[].action` | string enum `["add","patch","remove"]` | required(项内) | — |
| `operations[].content` | string | add/patch 必需 | add=新条目;patch=替换 old_text 的新文,条目其余保留 |
| `operations[].old_text` | string | patch/remove 必需 | 须取自单一条目;patch 要求在条目内**恰好出现一次**;remove 删整条;add 省略 |

schema `additionalProperties: False` 只加在**项**上;顶层故意**保留**未广播的旧形状——handler 仍接受顶层 `action`/`content`/`old_text` 与 `new_text` 别名(`:398-400` 注释:"models drift and older transcripts replay them";`#90468` 使省略的可选串到达时变 `""`,`_memory_tool` 开头 `if not content and new_text: content = new_text` 兜住,`:252-254`)。

**`replace` 已从工具面移除**:模型调用得到 `_REPLACE_REMOVED` 拒绝文案("'replace' is not available; use 'patch'. …Nothing was written.",`:168-170`);但 `_STORE_ACTIONS`(`:107-118`)与暂存重放仍保留它,让移除前已暂存的写能 pin、展示、重放(`:165-167` 注释)。分派表本身把 action 映射为 store 调用与审批门摘要文本。

### 2.3.2 分派链与内联执行器

模型侧调用链:注册 handler(`:472-474` 拉参数、`store=kw.get("store")` 注入)→ `memory_tool()`(`:222-238`;`store is None` 直接 `"Memory is not available. It may be disabled in config or this environment."`)→ `FAILURE_CLASS.set("other")` 起 → `_memory_tool()`(`:250-289`):

1. `new_text` 别名归一(`:252-254`);
2. `_memory_target_error`(`:321-350`):target 缺失/非法、batch 内嵌异 target(`"One call writes one store"`;与顶层相同或 null 的冗余不算错,`:338-340`)、目标 store 被配置禁用(`"Built-in {USER.md|MEMORY.md} writes are disabled in memory config."`,failure_class=`disabled`);
3. `operations` 存在 → batch 分支:非 list 拒;含 `replace` 拒;`_background_delete_gate`(§2.3.6)→ `_apply_write_gate` 批量门(§2.3.5)→ `store.apply_batch`;
4. 无 action 无 operations → `"Missing required parameter: 'operations', …"`(锚 #64291:防落进无信号的 "Unknown action 'None'" 引发连环重试);
5. 单 op:`_validate_single_op`(`:143-162`,缺 content/缺 old_text 的可恢复错误——缺 old_text 时返回 `current_entries`+`usage` 让模型补参重发)→ 后台删除门 → 审批门 → `_STORE_ACTIONS[action][0]` 落 store。

落 store 前,`memory_tool()` 在 finally 里复位 ContextVar 后调 `record_builtin_memory_call(action, operations, outcome=…, failure_class=…)`(`:236-237`)——`FAILURE_CLASS` 全程只喂共享指标,从不进模型可见结果(`tools/memory_tool_store.py:35-37`)。

agent 侧接线是内联执行器 `_memory`(`agent/inline_tool_executors.py:142-162`):映射六参调 `memory_tool` 并注入 `store=agent._memory_store`;**成功后**若 `agent._memory_manager` 存在则 `notify_memory_tool_write(result, args, build_metadata=…)` 把写镜像给外部 provider(`:151-161`)。镜像侧语义:只镜像已落盘的成功写,展开单 op/batch 形状,patch 翻译成整条 replace(`agent/memory_manager.py:778-823`,注释:"To a provider a patch replaced the whole entry with its edited form"),`previous_content` 只取 committed store 结果、绝不取搜索参数。

### 2.3.3 old_text 定位匹配语义(三级)

定位核心是"全等优先,子串兜底,折叠容错":

```python
# tools/memory_tool_store.py:98-109
def _find_unique_match(entries: list[str], old_text: str) -> tuple[Optional[int], bool]:
    """…A whole-entry EXACT match (``old_text == entry``) takes absolute priority — substring
    matches are only considered when no entry equals *old_text*, so a short
    entry stays addressable even when its full text is contained inside a
    longer sibling entry (remove('test') vs '...tests pass...'). Exact-duplicate
    matches are safe (first wins); distinct matches → ``(None, True)``."""
    exact = [i for i, e in enumerate(entries) if e == old_text]
    matches = exact or _substring_matches(entries, old_text)
    if len({entries[i] for i in matches}) > 1:
        return None, True
    return (matches[0] if matches else None), False
```

1. **整条全等**(`e == old_text`)绝对优先:短条目即使全文被长兄弟条目包含也仍可寻址;
2. **字节精确子串**:`old_text in e`(`_substring_matches`,`:88-91`);无命中再降一级——
3. **排版折叠匹配**:`_normalize_for_match`(`:80-85`)把引号/反引号全折叠为 `'`、各类 dash 折叠为 `-`(`_MATCH_FOLD` 翻译表 `:76-77`)、字面 `\n` 与空白串折成单空格——针对"模型重打条目时直引号换弯引号、em dash 换连字符、重排换行"导致 byte-exact 误报 no-match。折叠 needle 若**不含任何字母数字**(纯标点/空格会选中整条目)直接返回空(`:93-94`)。

命中去重后(`len({entries[i]…}) > 1`)才算歧义;同一文本重复条目 first wins(加载已去重,此为防御)。

### 2.3.4 错误分支全表(patch/remove/replace 共用的 `_locate`)

`_locate`(`tools/memory_tool_store.py:470-485`)按序返回索引或错误 dict:

| 分支 | 触发 | 返回(附字段) | failure_class |
|---|---|---|---|
| 歧义 | 折叠去重后 ≥2 不同条目命中 | `"Multiple entries matched '{old_text}'. Be more specific."` + `matches`(每条截 80 字符加省略号,`:480-482`) | `ambiguous` |
| 零匹配 | 无命中 | `_no_match_error`(见下)+ `current_entries` | `no_match`(经 `_consolidation_failure` 计数) |
| pin 失效 | `matched_entry` 不在当前 entries | `_stale_entry_message` | `stale_entry` |

`_no_match_error`(`:112-126`)是行为学打磨过的零匹配错误:对条目按词集重叠率打分,取**前三且重叠 ≥0.3** 的作 `closest_entries`(改写/过期的 old_text 通常仍共享多数词);old_text 里含 `§` 时追加提示 `"old_text must come from ONE entry ('§' separates entries); use one op per entry."`(跨条目截取是最常见误用);主干文案 `"No entry matched '{old_text}'. … Retry the {verb} with old_text copied verbatim from the intended entry"`。

patch 另有两道自检(`_patch_entry`,`:147-158`):span 在条目内出现次数用 `_span_occurrences` **含重叠计数**(`'00'` 在 `'1000'` 中算 2 次,`:142-144`),>1 即拒:`"'{old_text}' appears {count} times in the matched entry, and patch edits one span. Include more surrounding text so old_text occurs once."`(`ambiguous`);`replace(old,new,1)` 后结果与原条目相等即 no-op 拒(`invalid_args`);改后条目再过 `_scan_memory_content` strict 扫描(`scan_blocked`)。且 patch 的 span **保留空白**("tea " → "coffee " 的尾随空格是被替换文本的一部分,`:439`),非 patch 的 op 才 strip(`:596-597`)。

### 2.3.5 返回结构与错误信封

**成功响应**(`_success_response`,`tools/memory_tool_store.py:654-667`):

```python
self._consolidation_failures = 0
return {"success": True, "done": True, "target": target,
        "usage": self._usage_pct(target, self._char_count(target)),
        "entry_count": len(self._entries_for(target)), **({"message": message} if message else {}),
        **extra,
        "note": "Write saved. This update is complete — do not repeat it."}
```

要点:**不带 entries 列表**——docstring 直说 "echoing entries invites the model to 'find more to fix' and re-issue the same ops"(`:654-659`);`done: True` 标记终态(与整理熔断的 `done` 同一语义);`**extra` 通道放防丢字段:单 replace 的 `replaced_entry`、单 remove 的 `removed_entry`、单 patch 的 `patched_entry_before/after`(`:460-461`/`:504`/`:511`)——"silent data loss is the failure this field exists to prevent"(锚 #117952,`:172-175`),故意豁免于 no-entries 规则。batch 成功的 extra 是三个 1-based 序号字典 `replaced_entries`/`patched_entries`(+`patched_entries_after`)/`removed_entries`,序号与失败文案的 "Operation N" 编号对齐(`:632-645`)。

**错误信封**:`_error(message, failure_class, **extra)` → `{"success": False, "error": message, **extra}` 并 `FAILURE_CLASS.set`(`:41-43`);工具层另有 `tool_error`(`tools/registry.py:1057-1060`,`{"error": bounded_text, **extra}`,错误体有界防原始异常撑爆历史)。已见 failure_class 全集:`missing_content`/`missing_old_text`/`invalid_args`/`unknown`(`Unknown action '{action}'. Use: add, patch, remove`,`memory_tool.py:283`)/`disabled`/`ambiguous`/`no_match`/`stale_entry`/`over_budget`/`would_empty`/`scan_blocked`/`drift`/`read_failed`/`retry_cap`/`gate_refused`/`staged`/`other`。

### 2.3.6 审批门与后台删除门(存储契约的守门段)

**审批门** `_gate_or_stage`(`tools/memory_tool.py:84-102`):`write_approval.evaluate_gate(wa.MEMORY, …)` 放行→返回 None 照常写;`decision.blocked`→`gate_refused` 拒绝;需暂存→先 `_pin_matched_entries`(`:64-81`):对 batch 调 `store.resolve_batch_entries` 拿每个 replace/remove 的**锁下完整条目**,把 `{**op, "matched_entry": entry}` 写回 payload;对单 replace/remove/patch 调 `resolve_entry` 同样 pin。暂存返回 `{"success": True, "staged": True, "pending_id": …, "message": …}`。pin 的对价在重放侧:`apply_memory_pending`(`:353-370`)对缺 `matched_entry` 的破坏性暂存直接拒("This destructive pending write predates entry pinning and cannot be verified; nothing was applied."),落地时 `_locate`/`_apply_batch_op` 只认 `_pinned_index` 的**全等条目**(`tools/memory_tool_store.py:475-477`/`:540-543`,变更一字即 `stale_entry` 且不回落 old_text 子串搜索)——TOCTOU 偷换窗口由此闭合(报告 P7)。

**后台删除门** `_background_delete_gate`(`tools/memory_tool.py:179-219`,锚 #105921):无人值守 review fork(`is_unattended_review()`)里 patch/remove(含 batch 内)一律不直接应用,而是 pin 后转暂存,返回 `"Background review may not delete memory entries unattended. The proposed … was staged for your approval — review it with /memory pending"`;暂存本身失败则 fail-closed 降级为纯拒绝。

---

## 2.4 锁协议与原子替换写

### 2.4.1 `.lock` 旁路文件锁

```python
# tools/memory_tool_store.py:259-264(节选)+ :286-298
@contextmanager
def _file_lock(path: Path):
    """Exclusive lock on a separate .lock file so the memory file itself can
    still be atomically replaced."""
    ...
    lock_path = path.with_suffix(path.suffix + ".lock")
    ...
    with fd:
        def _flock(unlock: bool):
            if fcntl:
                fcntl.flock(fd, fcntl.LOCK_UN if unlock else fcntl.LOCK_EX)
            else:
                fd.seek(0)
                msvcrt.locking(fd.fileno(), msvcrt.LK_UNLCK if unlock else msvcrt.LK_LOCK, 1)
        _flock(False)
        try:
            yield
        finally:
            with suppress(OSError):
                _flock(True)
```

协议要点:
- **锁旁路文件**(`MEMORY.md.lock`/`USER.md.lock`,本机盘上实存,§2.1.3):锁 memory 文件本身毫无意义——它每次写都被 rename 整体替换,锁的是旧 inode;旁路文件让锁对象稳定存活(`:259-261` docstring);
- 打开 flags `os.O_RDWR | os.O_CREAT`(+有 `O_NOFOLLOW` 则加,拒绝符号链接锁文件),再 `os.fchmod(raw_fd, 0o600)` **在取得锁之前**收紧已打开 inode 的权限——绕过 umask 与旧进程留下的松权限锁文件,操作 fd 而非路径避免 path-swap 窗口(`:271-281` 注释);
- Unix 用 `fcntl.flock` 排它锁,Windows 用 `msvcrt.locking` 锁 1 字节;两者皆无(奇异平台)则裸 yield(`:268-270`);fcntl/msvcrt 从 `tools.memory_tool` 惰性取——测试在那儿 monkeypatch(`:262-263`,`tools/memory_tool.py:18-28`);
- 解锁在 `finally` 且 `suppress(OSError)`(`:297-298`):持锁期间 fd 是打开的,解锁失败也不阻止上下文退出。

### 2.4.2 `_mutate`:锁下重读 → 闭包 → 原子写

所有写路径(add/replace/patch/remove/apply_batch/resolve_*)汇入 `_mutate`(`tools/memory_tool_store.py:350-395`):

```python
# :361-370(节选)
path = self._path_for(target)
with self._file_lock(path):
    raw, read_ok = self._read_raw_checked(path)
    if not read_ok:
        return _read_failed_error(path)
    oversized = not skip_drift and self._has_oversized_entry(target, raw)
    before = list(dict.fromkeys(self._parse_entries(raw)))
    self._set_entries(target, before)
    FAILURE_CLASS.set("other")  # read below: only this closure's refusal counts
    result = mutate(self._entries_for(target), self._char_limit(target))
```

纪律清单:
- **锁下重读盘**:内存态在写前被盘上真值覆盖(跨进程/跨会话的一致性由锁+重读共同保证;`_write_file` 的 docstring 钉 #119668:早先快照的裸写会丢并发条目,`:706-710`);
- **读失败拒写**:`_read_failed_error`(`:65-71`)——"文件存在但此刻读不出"(他进程临时锁、权限变化、编码损坏、文件系统错误)时,按空文件继续存盘等于全量抹除,故拒绝且 `"Nothing was changed — retry in a moment."`。连 append-only 的 add 也不豁免:add 重写**整个文件**(`:411-413`);
- 闭包返回 dict 即**原样透传、零持久化**——错误 dict,或只读闭包(`resolve_entry`/`resolve_batch_entries`,`commit=False`)的成功载荷(`:360` docstring);
- 闭包可返回三元组,第三元 dict 并入成功载荷(`:377`,即 §2.3.5 的 extra 通道);
- 漂移检查与解析用**同一份 raw 快照**——曾经"第二次读失败算无漂移"的漏洞被注释点名(`:355-356`)。

### 2.4.3 原子替换写

```python
# tools/memory_tool_store.py:706-714
@staticmethod
def _write_file(path: Path, entries: list[str]):
    """Atomic temp-file + rename: readers never see a truncated file. Callers
    hold ``_file_lock`` (via ``_mutate``): a bare write from an earlier snapshot
    drops concurrent entries (#119668)."""
    try:
        atomic_write_text(path, ENTRY_DELIMITER.join(entries), tmp_prefix=".mem_")
    except OSError as e:
        raise RuntimeError(f"Failed to write memory file {path}: {e}")
```

`atomic_write_text`(`utils.py:350-363`)委托 `_atomic_write`(`utils.py:301-341`):`mkstemp_beside`(目标旁、`O_CREAT|O_EXCL` 恒 0600、前缀 `.mem_`)→ 写入+flush+`os.fsync` → `atomic_replace`(`utils.py:179-197`:`os.replace` 落位,先解析 symlink 保符号链接存活;EXDEV/EBUSY 跨设备/忙文件降级 copy+fsync+unlink,Windows rename 被占用句柄竞争时有界重试)。任一失败 `BaseException` 清理临时文件。读者永远看不到半截文件;写者崩溃不留脏目标。模块 docstring 强调这套写被 memory store、skill manager、agent importer 等所有破坏性重写共享(`utils.py:355-356`)。

---

## 2.5 round-trip drift 检测与备份

### 2.5.1 什么算漂移

漂移的定义刻意收窄到一种可判定形态:

```python
# tools/memory_tool_store.py:716-723
def _has_oversized_entry(self, target: str, raw: str) -> bool:
    """True when one entry in *raw* is longer than the whole-file limit. A tool
    write never produces one, so it is free-form text appended without delimiters, or an entry
    written before the limit was lowered. Layout differences (blank lines around ``§``,
    empty entries, padding) are NOT drift: parsing only strips whitespace, so the flush
    loses nothing but whitespace, and refusing there blocked every replace/remove on a
    hand-formatted file for good (#107270)."""
    return max(map(len, self._parse_entries(raw)), default=0) > self._char_limit(target)
```

判定:单条目长度 > 整文件上限。工具写永不产生这种条目,所以它只来自两类外因:无分隔符的自由文本追加(patch 工具、shell append、手编),或上限调低前的旧条目。**布局差异不算漂移**(`§` 周围空行、空条目、填充)——解析只剥空白,回写无损;曾经把手排版文件上所有 replace/remove 全堵死的过宽判定被 #107270 修正。

### 2.5.2 漂移时的三个分支(`_mutate` 内)

`tools/memory_tool_store.py:374-389`:

1. **漂移在场且闭包报 over_budget** → 改报 drift(那个 oversized 条目才是障碍,预算错误模型无法满足;`:374-375`);
2. **闭包结果引入新文本**(`not set(result[0]) <= set(before)`)→ 拒绝写,先备份(`:381-383`);
3. **闭包只删条目**(含删除 oversized 条目)→ 放行,但**被删条目中有 oversized 的先落备份**再删,且备份失败(`.bak` 末尾带 `_BACKUP_FAILED = " (BACKUP FAILED — file unchanged on disk)"` 后缀,`:38`)时改判 drift 拒绝——没有副本就不删可能粘连自由文本的条目(`:384-389`)。

`add` 显式 `skip_drift=True`(追加不覆盖外来内容),但读失败仍拒(§2.4.2;`:411-413`);`resolve_*` 干跑同样 skip(`:493`/`:647` `skip_drift=not commit`)。

### 2.5.3 漂移错误文案与 `.bak` 备份

`_drift_error`(`:51-62`)全文值得读——它把根因、后果、两条出路、事故编号一次讲清:

> "Refusing to write {path.name}: it holds an entry larger than the whole store's char limit, i.e. free-form text written without § delimiters (the patch tool, a shell append, a manual edit). Rewriting it would lose that text. A snapshot was saved to {bak_path}. Resolve the drift first — either rewrite the file as a clean §-delimited list of entries, or move the extra content out — then retry. This guard exists to prevent silent data loss (issue #26045)."

响应附 `drift_backup=<bak路径>` 与 `remediation`(指示打开 .bak,逐条 `memory(target=…, operations=[{action:'add',…}])` 找回,再清理原文件;`:59-62`)。备份文件名 `_drift_backup`(`:725-740`):`{MEMORY.md|USER.md}.bak.{unix时间戳}`(同秒冲突追加 `.{n}`,`itertools.count` 排他探测;`open(..., "x")` 排他创建;OSError 返回路径+`_BACKUP_FAILED` 后缀)。排他创建的理由写在 docstring:同一秒两次快照绝不互覆(`:726-728`)。

---

## 2.6 冻结快照 `_system_prompt_snapshot`

### 2.6.1 抓取点与填充内容

`_system_prompt_snapshot` 在全文件仅出现 4 处(`tools/memory_tool_store.py`):

| 落点 | 行号 | 作用 |
|---|---|---|
| 类 docstring | `:179` | 明言 "frozen at load time (prefix-cache stable)" |
| `__init__` | `:194` | `{"memory": "", "user": ""}` 初始化 |
| `load_from_disk` | `:255` | **唯一写入点**:`self._system_prompt_snapshot[target] = self._render_block(target, [_sanitize(e, path.name) for e in entries])` |
| `format_for_system_prompt` | `:649-652` | **唯一读取点** |

```python
# tools/memory_tool_store.py:649-652
def format_for_system_prompt(self, target: str) -> Optional[str]:
    """Frozen load-time snapshot (NOT live state — mid-session writes don't touch
    it, preserving the prefix cache); None if empty."""
    return self._system_prompt_snapshot.get(target, "") or None
```

轮中写盘路径(`_mutate`/`_write_file`/`_set_entries`)**不触碰**快照——这就是 P11 的机制本体:轮中写入落盘可见于 `current_entries` 等返回,但系统提示字节不动,全会话 prompt 前缀缓存有效;新内容下次注入才进系统提示(即时可见性由 `<memory-context>` 围栏补位,见报告 §1.2)。

### 2.6.2 使用点与刷新边界

- **使用点**:`agent/system_prompt.py:522-533` `_memory_parts` 对 memory/user 各调 `agent._memory_store.format_for_system_prompt(kind)`(`:529`),非空块拼进系统提示(外部 provider 块随后同函数追加,`:535-549`);
- **抓取点一(agent 构建)**:`agent/agent_init.py:1246-1252` ——`_init_memory` 在双开关任一开启时构建 `MemoryStore` 并立刻 `load_from_disk()`;注意守卫条件 `if not skip_memory or _memory_toolset_requested`(`:1234`)与 `with suppress(Exception)`("Memory is optional — don't break agent init",`:1235-1236`)——skip_memory 只跳过外部 provider,`enabled_toolsets=["memory"]` 仍建内置 store 防 `store=None`(#65429,注释 `:1223-1229`);
- **抓取点二(上下文重建边界)**:`agent/system_prompt.py:816-834` `invalidate_system_prompt`(压缩后调用):清缓存提示(`:830-831`),`:834` 是**代码行** `agent._memory_store.load_from_disk()` 重抓快照。其 docstring 给出的理由是 "Called after context compression events. Also reloads memory from disk so the rebuilt prompt captures any writes from this session"(`:821-822`)——**并无**缓存成本论证;"缓存本就失效、重抓不付额外代价"的注释级落点在同一边界的**压缩执行侧**而非此处:工具定义刷新注释 "The prompt cache is already broken here, so the refresh is free"(`agent/conversation_compression.py:3101-3102`,针对工具 schema 刷新)与 ALWAYS-rebuild 段的 "when something changed, the cache was stale by definition"(`:3118`)。报告 P11 的"`(system_prompt.py:834)注释明言该点缓存本就失效`"按当前检出应据此修正指向(行号对,内容是代码非注释)。对 agent 活实例的快照刷新全库仅上述两处(grep 实证:`load_from_disk` 生产调用点只有 `agent/agent_init.py:1252` 与 `agent/system_prompt.py:834`;`tools/memory_tool.py:60` 是 `load_on_disk_store` 另建新 store,不触碰 agent 实例)。

### 2.6.3 快照专属的加载期净化 `_sanitize`

`load_from_disk` 的 `_sanitize`(`tools/memory_tool_store.py:230-238`)是快照填充前的最后一道闸(P8 加载侧):

```python
# :232-238(节选)
findings = scan_for_threats(entry, scope="strict") if entry and not entry.startswith("[BLOCKED:") else None
if not findings:
    return entry
logger.warning("Memory entry from %s blocked at load time: %s", filename, ", ".join(findings))
return (f"[BLOCKED: {filename} entry contained threat pattern(s): {', '.join(findings)}. "
        f"Removed from system prompt; use memory(action=remove, target='{_store_target(filename)}') "
        f"to delete the original.]")
```

只替换**快照**里的条目,live 列表保留原文——用户能在工具返回的 `current_entries` 里看见并删除中毒条目,静默丢弃反而掩盖攻击(`load_from_disk` docstring,`:223-227`)。扫描 scope=strict(与写入侧 `_scan_memory_content` 同档,`:29-32`;strict 集包含 all/context 全部规则并叠加记忆/技能专属规则——`send_to_url`、`authorized_keys`/SSH、`.hermes/.env`、hardcoded_secret 等,`tools/threat_patterns.py:78-104`,作用域累积 all⊂context⊂strict,`:114-115`);已被 `[BLOCKED:` 开头的占位条目跳过复扫。无 agent 上下文的消费者(gateway、Desktop、/memory)经 `load_on_disk_store`(`tools/memory_tool.py:47-61`)拿到同上限、同开关、刚 `load_from_disk` 的新 store——保证审批重放面对的 caps 与 agent_init 一致。

---

## 2.7 契约一览(复用者速查)

| 维度 | 契约 | 落点 |
|---|---|---|
| 文件 | 纯条目流,`\n§\n` 连接,无头部;utf-8(-sig 读),strict 解码 | store`:26`/`:695-698`/`:691` |
| 预算 | `len(ENTRY_DELIMITER.join(entries))`,默认 2200/1375 字符,只查写入终态 | store`:311-312`/`:188` |
| 超限 | 零写入+返回余量/现有条目/整理指引;单 add 走 `_add_overflow`;batch 终态检查 | store`:329-337`/`:618`/`:626-628` |
| 熔断 | 每轮 3 次 overflow/zero-match 失败后终态 `done` 放行 | store`:186`/`:206-221` |
| 定位 | 整条全等 > 字节子串 > 排版折叠;歧义拒;零匹配回 closest(词重叠≥0.3) | store`:98-109`/`:88-95`/`:112-126` |
| patch | span 须在条目内恰好一次(含重叠计数);保空白;no-op 拒;改后过 strict 扫描 | store`:142-158` |
| 审批 | 危险写暂存时 pin 锁下完整条目;重放只认全等,无 pin 的破坏性暂存拒 | tool`:64-102`/`:353-370`;store`:475-477` |
| 后台 | 无人值守 review 的 patch/remove 一律转暂存(fail-closed) | tool`:179-219` |
| 锁 | 旁路 `*.lock`,`flock`/`msvcrt`,O_NOFOLLOW+锁前 fchmod 0600 | store`:257-298` |
| 写 | 锁下重读盘→闭包→mkstemp(`.mem_`)+fsync+rename;读失败拒写 | store`:350-395`/`:706-714`;utils`:301-341` |
| 漂移 | 单条目>整文件上限才算;新文本拒写、删 oversized 先备份 `.bak.<ts>` | store`:716-723`/`:374-389`/`:725-740` |
| 快照 | `_system_prompt_snapshot` 仅 `load_from_disk` 写(`:255`)、`format_for_system_prompt` 读(`:652`);刷新仅 agent 构建(agent_init`:1252`)与压缩边界(system_prompt`:834`) | — |
| 返回 | 成功 `{success,done,target,usage,entry_count,…extra,note}` 不回 entries;防丢字段(replaced/removed/patched)例外 | store`:654-667` |

复用者最应带走的三条设计判断:①**预算口径含分隔符**且只查终态——"删旧腾位+新增"能在一次原子 batch 里完成,这是整理协议能闭环的前提;②**锁对象是旁路文件**而非数据文件,因为数据文件的写法是整体 rename 替换——任何"锁+原子替换"组合都须回答锁谁;③**快照冻结是写路径的自觉自律**:`_set_entries`/`_write_file` 全都触手可及,快照不被污染靠的是 `_system_prompt_snapshot` 只有一写一读两个入口、并被 docstring 与注释反复钉死动机(prefix cache)——复用时若新增写快照的路径,这条契约即破。
