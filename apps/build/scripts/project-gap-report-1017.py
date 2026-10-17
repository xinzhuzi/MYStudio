from pathlib import Path
import json,shutil,hashlib
root=Path.cwd();out=root/'apps/output/automation/project-gap-audit-1017';out.mkdir(exist_ok=False)
for src,dst in [('/tmp/mystudio-audit-core-1017-run2.log','baseline-core.log'),('/tmp/mystudio-gap-probes-1017-run3.log','reproduction.log'),('/tmp/mystudio-storage-baseline-1017.log','baseline-storage.log')]:
 shutil.copy2(src,out/dst)
probe=root/'apps/build/scripts/project-gap-audit-1017'
sha={str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in probe.glob('*.test.ts')}
(out/'probe-sha256.json').write_text(json.dumps(sha,indent=2))
specs=[
('01-storage-ack.md','[P0] 校验文件存储写入确认，迁移失败时保留来源副本', '''## Overview
遵循 MVP：先让现有存储边界可靠报告成功与失败，不增加第二套存储系统。磁盘写入返回 false 时，renderer 当前仍 resolve；浏览器迁移随后删除唯一来源副本。

## Evidence / Reproduction
- `apps/frontend/electron/ipc/files/file-storage-ipc.ts:67`：失败返回 false（catch 在80行附近）。
- `apps/frontend/lib/storage/indexed-db-storage.ts:168`：忽略 setItem 的 boolean 确认并 return。
- 同文件129–140：迁移写入后无条件移除 localStorage/IndexedDB 来源。
- 隔离探针 `apps/build/scripts/project-gap-audit-1017/write-ack.test.ts`：mock IPC setItem=false；普通保存 resolve；迁移后唯一浏览器副本为 null。未使用真实用户数据。
- 文档边界：`docs/engineering/STORAGE_AND_DATA.md:55` 承诺读取时迁移，产品为本地优先存储。

## Scope
覆盖 renderer fileStorage 普通写入/移除和 localStorage、IndexedDB 迁移。保留现有键、目录、IPC boolean 接口；不搬迁真实数据、不清理历史副本、不重构 storage engine。

## Technical Requirements
继续使用 `setItem(key:string,value:string):Promise<boolean>` 的 preload 协议，但将 false 归一化为明确失败；StateStorage 的 Promise<void> 必须 reject。Electron 写入失败不能静默变成 browser success。只有目标写入明确成功且回读一致时才能移除迁移来源；失败可重试且不写成功标记。

## Implementation Plan
1. 在 indexed-db-storage.ts 添加内部 confirmed-write 助手，校验 boolean；调用现有 bridge，不新增 IPC。
2. 普通保存传递失败，现有调用方展示持久化错误；防止 catch 吞掉后隐式成功。
3. 两种迁移均先 confirmed write，再校验回读，再清理来源；目标失败保留完整原文。
4. 在 indexed-db-storage.test.ts、file-storage-ipc.test.ts 增加 false/reject、读回不一致与成功重试用例；把本轮探针转为期望修复后行为的正式回归测试。

```ts
const ok = await bridge.setItem(key, value);
if (!ok) throw new Error('文件保存失败');
// Migration: confirm read-back before source removal.
```

## Acceptance Criteria
- false 或异常导致可观测的保存失败，不能显示持久化成功。
- localStorage/IndexedDB 的来源在目标失败或读回不一致时保持逐字节不变。
- 成功后重试幂等，键名兼容现有 legacy 迁移。
- focused storage/IPC tests、typecheck 通过；用临时目录故障注入验证磁盘失败，无需真实项目。

## Priority
P0；影响5、战略5、可行性4、工作量2、风险2，分数6.25。直接影响用户作品保存与迁移安全。

## Dependencies
- Blocked by: 无。
- Blocks: 共享资源保存修复的可靠失败报告（可并行开发，集成验收依赖本件）。

## Implementation Size
Small/Medium，约1–2天；暂不拆子 issue。
'''),
('02-shared-scope.md','[P0] 共享资源按已加载范围保存，防止关闭共享时清空与删空后复活', '''## Overview
MVP 只修复现有 createSplitStorage 的读写范围对称性。关闭共享后，读取只含当前项目，但保存仍无条件覆盖 shared；共享开启时删除其他项目最后一条资源，该项目 ID 从数据消失，旧文件不再写回，重载后资源复活。

## Evidence / Reproduction
- `apps/frontend/lib/storage/project-storage.ts:238`：共享关闭只返回当前 projectPayload。
- 同文件251–297：setItem 不检查 sharingKey 开关；297行无条件写 sharedPayload。
- 同文件270–287：目标项目集合来自当前 payload，无法包含已被删除至空的其他项目。
- `apps/frontend/stores/library/character-library-store.ts:243` 删除动作过滤数组；455行接入 createSplitStorage。
- 文档：`docs/engineering/STORAGE_AND_DATA.md:124` 承诺角色/场景/素材可独立关闭共享，此时只改变可见范围。
- 隔离 `apps/build/scripts/project-gap-audit-1017/split-storage.test.ts` 已复现两条：共享关闭保存把已有 shared 数组写成[]；删除 p2 最后一条后重新读取又出现该条目。

## Scope
角色、场景、素材共用的 split adapter；不扩展到独立 assets.db，不声称剧本资产库所有入口均受影响。不开启共享时保存不修改未加载资源。禁止用写空全部已知项目的方式修复删除。

## Technical Requirements
在 adapter 内维护按 active project、sharing mode 和成功加载代次区分的 loadedProjectIds、sharedLoaded；只写当前可编辑范围。记录上一轮已加载目标，即使其条目删空也写入该目标空分片；未加载或读取失败的项目不自动写空。分享开关切换、项目切换必须使旧范围失效或重新加载。

## Implementation Plan
1. createSplitStorage 的 getItem 在成功读取时记录来源范围；与当前 pid/share state 绑定。
2. setItem 仅写确认已加载/当前新建的数据范围；共享关闭不碰 shared 与其他项目。
3. 对已加载的其他项目，删到零仍写该项目空资源集；保留非资源字段和现有splitFn/mergeFn接口。
4. 用项目p1/p2/shared矩阵覆盖开关切换、新项目无文件、读取失败、最后一项删除、重新加载与跨项目保存。

```ts
// Internal adapter metadata, not a second persisted truth.
type LoadedScope = {
  projectId: string;
  sharing: boolean;
  loadedProjectIds: Set<string>;
  sharedLoaded: boolean;
};
```

## Acceptance Criteria
- 共享关闭时编辑p1，p2/shared磁盘内容逐字节不变。
- 共享开启时删除p2最后一个已加载资源，重载不复活。
- 未加载、损坏或不可读项目不能因另一个项目保存而清空。
- 角色/场景/素材三种splitFn均通过同一适配器契约测试。
- 保存失败明确可见；typecheck与storage/library focused tests通过。

## Priority
P0；影响5、战略5、可行性4、工作量2、风险2，分数6.25。两个触发条件属于同一读写范围缺陷，合并成一个修复规格。

## Dependencies
- Blocked by: 写入确认 issue（集成验收；范围算法可以独立实现）。
- Blocks: 无。

## Implementation Size
Medium，约2–3天；不拆不必要的子 issue。
'''),
('03-queue-commit.md','[P1] 串行化渲染队列状态提交，保证事件序号与快照恢复一致', '''## Overview
MVP 保留现有 Remotion 持久队列，修复状态提交的线性顺序。文件层虽然串行写盘，但 queue.commit 在 await append 前计算 sequence+1，多个提交会分配同一序号。

## Evidence / Reproduction
- `apps/frontend/electron/rendering/plugins/remotion/queue/remotion-render-queue.ts:538`：seq计算→await append→更新sequence/jobs→snapshot，没有队列级互斥。
- 同文件 `restoreEvent`（约593行）：seq <= current 时跳过，重复序号不能可靠重放。
- `apps/frontend/electron/rendering/plugins/remotion/queue/remotion-queue-utils.ts:86` 起文件写锁只串行文件操作，不能修复调用前已分配的重复seq。
- 文档：`docs/workflow/WORKFLOW_FULL_VIDEO_PIPELINE.md:180` 规定持久shot队列与current evidence；`docs/engineering/DEVELOPER_ARCHITECTURE.md` 声明取消/重试/依赖/恢复。
- `apps/build/scripts/project-gap-audit-1017/queue.test.ts`：公开 Promise.all(enqueueShot×3) + 有异步延迟的持久化 mock 复现重复seq；内部两次commit得到[1,1]，无snapshot的journal replay恢复1/2个job。完整最新snapshot仍可能包含全部job，不能据此宣称每次重启必丢；风险在快照落后与事件恢复路径。

## Scope
只修改队列状态提交/init与对应测试，不改 renderer、media pipeline、并发渲染槽数、目录与既有job identity；不清理或重写真实历史日志。

## Technical Requirements
串行边界覆盖分配seq、append、内存状态、snapshot以及通知的确定顺序；不能只锁append。单独 initPromise 避免多请求并行恢复。失败传播与后续任务恢复应明确，不能导致整个提交链永久阻塞。需要定义重复/断裂日志的保留与诊断策略，不静默丢弃不同job的重复seq。

## Implementation Plan
1. 引入进程内 commit tail，将整个提交事务排队；仅在轮到执行时分配下一序号。
2. 明确snapshot失败后内存/日志事实，保留可重放事件并报告失败；失败不毒化tail。
3. init复用在途Promise，失败允许明确重试；不得两次并行restore/recovery。
4. 把公开并发enqueue、并发完成、cancel与pump交错加入正式队列测试；使用真实临时目录 persistence 补充旧snapshot+journal recovery。

```ts
private commitTail: Promise<void> = Promise.resolve();
// Tail must cover sequence assignment through snapshot; renderer slots remain concurrent.
```

## Acceptance Criteria
- 至少50路交错提交，seq严格递增且唯一，journal无缺项。
- 将snapshot停留在旧代后重启，回放恢复所有已append的job状态。
- append/snapshot故障注入不会伪报成功或使后续提交永远挂住。
- 并发3路渲染能力保留；身份、依赖、取消、项目切换现有测试不回退。
- typecheck、queue tests与focused workflow tests通过；无需生成真实视频。

## Priority
P1；影响5、战略5、可行性3、工作量3、风险3，分数2.78；优先于低影响API体验缺口，排在数据保存保护之后。

## Dependencies
- Blocked by: 无；与storage两项文件所有权互不重叠，可独立开发。
- Blocks: 可靠队列恢复验收。

## Implementation Size
Medium，约2–3天；无需父子issue层级。
''')]
for name,title,body in specs:
 (out/name).write_text('# '+title+'\n\n'+body)
(out/'specs.json').write_text(json.dumps([{'file':name,'title':title} for name,title,_ in specs],ensure_ascii=False,indent=2))
report='''# MYStudio 核心流程实查（2026-10-17）

本轮使用 gen-specs-as-issues、workflow-integrity-testing 与 GitNexus 探索指导；用户已明确本次跳过Trellis。审计对象是 Electron 漫剧工作台，不是Unity工程。未改任何既有产品文件；只新增本地探针/报告。无git/worktree、无真实数据写入、无引擎重启、无媒体生成。两路子代理均收到空载荷并返回未执行，未采用其作为证据，最终核验由主代理完成。

## 核验结果与边界

- `npm run typecheck`：退出0。
- 核心链路现有Vitest：186文件、2030项通过（baseline-core.log）。
- 另行storage/project focused baseline见 baseline-storage.log。
- 新增隔离故障探针：3文件、6项通过。**这些断言确认当前缺陷存在，并非确认修复成功**。
- 重跑：从 apps 执行 `npm test -- build/scripts/project-gap-audit-1017 --maxWorkers=2`。
- 覆盖：当前核心studio业务、UI控制器、queue、storage/project相关代码及对应测试；未覆盖全仓所有功能或所有真实用户操作。
- 未运行 installed/UI smoke、paid generation、整章真实成片，不能据此断言它们可用或损坏。jsdom canvas警告是测试环境限制，不作为产品问题。
- 首次测试命令使用了当前Vitest不支持的minWorkers参数，读help后改用maxWorkers；另一次误从仓库根跑npm未执行任何测试；两者均不计产品缺陷。

## 五项可复现缺口

|编号|当前状态与触发|代码证据|用户影响|影响/战略/可行性/工作量/风险|分数|
|---|---|---|---|---|---|
|G1|IPC写盘false仍resolve；迁移false仍移除唯一浏览器来源|indexed-db-storage.ts:129、168；file-storage-ipc.ts:67|保存失败被隐藏，旧数据迁移失败可能丢唯一副本|5/5/4/2/2|6.25|
|G2|关闭共享→只加载本项目→保存→shared被写空|project-storage.ts:238、251、297|共享资源丢失；独立assets.db不在本项证明范围|5/5/4/2/2|6.25|
|G3|共享开启，删除其他项目最后一条，目标ID不再在payload中|project-storage.ts:270、286；character-library-store.ts:243、455|重载后资源复活，删除结果未持久化|4/4/4/2/2|4.00|
|G4|公开并发enqueue触发相同seq；快照落后时journal replay跳过不同job|remotion-render-queue.ts:538、restoreEvent|恢复可能缺少已提交任务/状态；最新完整snapshot可掩盖此问题|5/5/3/3/3|2.78|
|G5|blocked job取消交给无该任务的executor，返回失败并保持blocked|remotion-render-queue.ts:234；remotion-workspace-state.ts:20|API不能终止blocked job；当前Workbench仅对queued/running显示取消，因此UI影响受限，P2|2/3/4/2/2|1.50|

分数=影响×战略/(工作量×风险)，均为1–5工程判断。G2/G3合并为同一共享范围规格，避免同一适配器双重实现；前三修复规格对应G1、G2+G3、G4。G5作为低优先级API契约缺口保留本地，未单独创建issue。

## 推荐顺序与文件边界

1. 01-storage-ack.md：确认写入与迁移保护。
2. 02-shared-scope.md：已加载范围保存；可与1并行实现，但集成验收依赖1的失败反馈。
3. 03-queue-commit.md：独立队列级提交串行与恢复，文件所有权与1/2分离，可独立开发。

每份规格包含现状、复现、范围、接口/数据形状、MVP步骤、验收和依赖。没有为凑数增加新功能；架构文档还存在版本数字滞后（如Remotion4.0.499对package4.0.534），属文档维护项，本轮不把它计入五个核心缺口。

## 材料

- 三份规格：01-storage-ack.md、02-shared-scope.md、03-queue-commit.md。
- 隔离探针：apps/build/scripts/project-gap-audit-1017/；创建脚本 project-gap-audit-1017.py。
- 探针当前磁盘SHA：probe-sha256.json。
- GitHub issue发布结果：issues.json（发布后生成）。
'''
(out/'report.md').write_text(report)
print(out)
