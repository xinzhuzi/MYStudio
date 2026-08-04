export const meta = {
  name: 'phase2-artifact-slices',
  description: 'Trellis Phase 2 实施：严格有序执行 08-04-artifact-output-management 的 9 个 slice，每 slice = trellis-implement + trellis-check 门控',
  phases: [
    { title: 'Slice 1', detail: 'Baseline + Contracts' },
    { title: 'Slice 2', detail: 'Projection + Dependency Graph' },
    { title: 'Slice 3', detail: 'Read-Only Electron Inventory' },
    { title: 'Slice 4', detail: 'Artifact Center Read UI' },
    { title: 'Slice 5', detail: 'Immutable Deletion Plan + Dialog' },
    { title: 'Slice 6', detail: 'Persisted-State Transforms' },
    { title: 'Slice 6.5', detail: 'Multi-Chapter Fixture Generator' },
    { title: 'Slice 7', detail: 'Transactional Execution + Recovery' },
    { title: 'Slice 8', detail: 'Route Deletes Through One Controller' },
    { title: 'Slice 9', detail: 'Verification + Handoff' },
  ],
}

const TASK = '/Users/zhengbingjin/Project/Github/MYStudio/.trellis/tasks/08-04-artifact-output-management'
const REPO = '/Users/zhengbingjin/Project/Github/MYStudio'

// 每个 slice 的精确 worker brief(从 implement.md 提取，无占位符)
const SLICES = [
  {
    key: '1',
    title: 'Baseline And Contracts',
    phase: 'Slice 1',
    steps: 'Slice 1 步骤 (implement.md:11-25):\n' +
      '1. 从 apps/ 跑 7 个基线测试，RECORD green/red 到 research/baseline-1-green-red.md(先建文件)\n' +
      '   - npm test -- frontend/components/panels/media/index.test.tsx\n' +
      '   - npm test -- frontend/components/panels/studio/novel-tab.test.tsx\n' +
      '   - npm test -- frontend/stores/studio/studio-store.test.ts\n' +
      '   - npm test -- frontend/stores/script/script-store.test.ts\n' +
      '   - npm test -- frontend/stores/editing/editing-store.test.ts\n' +
      '   - npm test -- frontend/stores/tts/tts-store.test.ts\n' +
      '   - npm test -- frontend/electron/ipc/files/project-file-ipc.test.ts\n' +
      '2. 新建 frontend/types/artifacts.ts:finite stage/kind/status unions + discriminated IPC result types\n' +
      '3. 新建 runtime decoders(每个 IPC request + persisted snapshot boundary);reject unknown fields\n' +
      '4. 新建 contract tests:invalid project IDs / empty scopes / cross-chapter batch / path-bearing execute payloads / malformed confirmation\n' +
      'Completion gate: shared types compile + invalid inputs fail closed + 7 基线文件无新增失败 (既存红允许)',
    checkFocus: '核实:(a) frontend/types/artifacts.ts 存在且导出 finite unions + discriminated types;(b) decoders reject unknown fields;(c) contract tests 覆盖 5 类无效输入;(d) research/baseline-1-green-red.md 记录了 7 文件基线;(e) cd apps && npx tsc --noEmit 对新文件通过 (或仅既存红)。禁止只看实现者自报。',
  },
  {
    key: '2',
    title: 'Pure Projection And Dependency Graph',
    phase: 'Slice 2',
    steps: 'Slice 2 步骤 (implement.md:27-36),纯内存，零文件系统:\n' +
      '1. 新建 frontend/lib/artifacts/artifact-projection.ts + fixture builders(Studio/Script/Director/Editing/TTS/Media/libraries/Remotion summaries)\n' +
      '2. project stable IDs / stages / ownership / physical refs / upstream-downstream / edit routes / delete policies\n' +
      '3. legacy mapping rules:episode-1 / numeric TTS sceneId / missing media ownership / continuity 无 episodeId / chapter-${index} trackKey(经 ProductionTrack.episodeId → VideoCandidate.trackId)/ ScriptData 无顶层 episodeId(经 scriptData.episodes[].Episode.id)。每条 rule 有 fixture,ambiguous → block\n' +
      '4. 新建 artifact-dependency-graph.ts:exclusive-downstream cascade / shared-reference retention / blocker propagation / deterministic ordering\n' +
      '5. 新建 artifact-metadata.ts:bounded name/tags/notes validation + project-scoped overlays only\n' +
      '6. tests:chapter deletion / script-root deletion / single-artifact / shared asset preservation / derived asset / ambiguous legacy blockers / cross-project rejection\n' +
      'Completion gate: 纯内存 fixture 产出预期 delete/migrate/retain/blocker sets,无文件系统访问',
    checkFocus: '核实:(a) 3 个新文件 (projection/dependency-graph/metadata) 存在;(b) graph 的 cascade/retention/blocker 逻辑有 fixture 测试通过;(c) legacy mapping 覆盖 episode-1/numeric-sceneId/trackKey/Episode.id 全部;(d) 纯内存测试无 fs 访问。跑 cd apps && npm test -- frontend/lib/artifacts 验证。',
  },
  {
    key: '3',
    title: 'Read-Only Electron Inventory',
    phase: 'Slice 3',
    steps: 'Slice 3 步骤 (implement.md:38-47):\n' +
      '1. 在 frontend/electron/storage/storage-paths.ts 加 resolveProjectRootPath(dataRoot, projectId):normalizePathSegment(projectId) → path.resolve(dataRoot, "_p", normalized) → 经 assertInsideRoot realpath containment。带测试(empty/normalization/realpath-containment)。已知:resolveProjectScopedFilePath 在 :101,normalizePathSegment 需在文件里确认确切名。然后新建 frontend/electron/artifacts/artifact-inventory-service.ts 用 resolveProjectRootPath 作 scan root(不用 resolveProjectScopedFilePath(...,"") 它会抛，不用 main.ts 内联 path.join)+ 现有 withFileStorageMutationLocks\n' +
      '2. 只扫 project root + referenced local-media。记录 relative path/file type/bytes/mtime/SHA-256/symlink blocker\n' +
      '3. 注册 decoders:active project stores / Remotion records / chapter-only backups / mixed JSON backups。Unknown mixed content → block\n' +
      '4. compare renderer live snapshot vs disk snapshot,返回 typed discrepancies\n' +
      '5. 加只读 inventory IPC + preload bridge + global type + SSR-safe accessor + source-surface tests + main registration test\n' +
      '6. 对 live Daojie 跑只读 inventory，对比 chapter-001 categories/counts 与 research baseline，报告 diff(不静默更新 expected)\n' +
      'Completion gate: 零写入 + path escape/symlink fail closed + 每件第一章产物解析到已知 stage 或 typed unknown blocker(带 reason)+ category counts 对齐 research/artifact-dependency-inventory.md baseline,diff 记为 typed discrepancy',
    checkFocus: '核实:(a) resolveProjectRootPath 在 storage-paths.ts 且有 containment 测试;(b) inventory-service 只读 (无 fs.write/fs.unlink 调用,grep 核实);(c) inventory IPC 注册 + preload bridge + 测试;(d) 对 live Daojie 跑只读 (零写入),counts 对齐 baseline 或 diff 记录。重点反查：有无任何写操作混入。',
  },
  {
    key: '4',
    title: 'Artifact Center Read UI And Metadata',
    phase: 'Slice 4',
    steps: 'Slice 4 步骤 (implement.md:49-58):\n' +
      '1. 新建 project-scoped artifact store:loading/error state / hierarchy filters / stable selection / metadata overlays / project-switch fencing\n' +
      '2. 拆 media 路由为「工作流产物」+「媒体库」两 tab;现有 media 组件行为放第二 tab 后保留\n' +
      '3. 建 chapter/stage tree + dense artifact table + detail panel(用现有 Radix/UI primitives + Lucide icons)\n' +
      '4. 展示全部 detail:scope/stage/kind/state/times/bytes/paths/upstream/downstream/delete policy/retained-shared reason/blocker reason\n' +
      '5. 只允许 name/tags/notes 编辑。typed workflow-focus navigation，核实每种 artifact kind 路由到 owning tab/episode/stage\n' +
      '6. component tests:empty/loading/failure/hierarchy counts/filters/long paths/metadata validation/same-chapter selection reset/media-library regression。DEDICATED 测试 AC R18:在 A 章选产物 → 切 B 章 → 断言 selection 清空 (或强制取消)+ 无删除计划静默跨章扩范围\n' +
      'Completion gate: types/artifacts.ts 每种 kind 有通过的面板渲染测试 (scope/stage/kind/path 非空)+ media-library regression 通过 + rg "execute" over frontend/lib/bridge 无 execute handler',
    checkFocus: '核实:(a) artifact store 存在 + project-switch fencing;(b) media 路由拆 2 tab 且原 media 行为保留 (media-library regression 过);(c) R18 dedicated 测试存在且通过 (切章清选择 + 无跨章扩范围);(d) rg "execute" 在 frontend/lib/bridge 无 handler(delete bridge 此时不应存在)。',
  },
  {
    key: '5',
    title: 'Immutable Deletion Plan And Dialog',
    phase: 'Slice 5',
    steps: 'Slice 5 步骤 (implement.md:60-69),execute 必须禁用直到 Slice 6:\n' +
      '1. 在 Electron service 加 plan creation(用 normalized structured + physical fingerprints)\n' +
      '2. 返回 deterministic grouped delete/migrate/retain/blocker sections(含 count + byte totals);绝不接受 raw renderer paths\n' +
      '3. artifact store 加 chapter + artifact/batch plan requests。 Invalidate plans on project/chapter/selection/live-disk revision/running-job change\n' +
      '4. 建 ArtifactDeleteDialog.tsx:确切「删除后无法恢复」警告 + 完整 grouped details + blocker 时 confirmation 禁用\n' +
      '5. chapter scope 要求精确 chapter title 或 ID;普通 artifact scope 用 explicit second confirmation。Cancel/mismatch 路径零 mutation 调用\n' +
      '6. Novel + Script/Overview delete 按钮只接 open shared plan dialog;execute 禁用在 internal feature gate 后直到 Slice 6 通过\n' +
      'Completion gate: 每个破坏性入口对同一章产出同一 plan + 全部 confirmation/cancel 测试通过且零物理写入',
    checkFocus: '核实:(a) plan service 返回 deterministic grouped sections;(b) ArtifactDeleteDialog 有「删除后无法恢复」+ blocker 禁用 confirmation;(c) cancel/mismatch 零写入测试通过;(d) Novel/Script/Overview delete 按钮只 open dialog(execute 仍 gated，无 execute handler 注册)。反查：有无任何 execute IPC 注册 (Slice 5 不应有)。',
  },
  {
    key: '6',
    title: 'Persisted-State Transforms And Ownership Migration',
    phase: 'Slice 6',
    steps: 'Slice 6 步骤 (implement.md:71-80),纯计算不写盘:\n' +
      '1. 加 pure chapter-removal transforms:Studio/Script/Director/Editing/TTS/Media/Remotion persisted shapes。保留 Zustand envelopes/versions/unrelated fields。Script 用 deleteEpisodeBundle reindex 算法 (script-store.ts:438-439)——按 stable Episode.id 删 target episode,reindex 剩余 episode 到连续 1-based index,reindex episodeRawScripts.episodeIndex;断言剩余 episode.index 连续 1-based。deleteEpisode 不重排，禁用。Remotion 按 chapterId join(无 Remotion record 有 episodeId)\n' +
      '2. 从 retained records 重建 secondary indexes(不 ad hoc 删 index entry)\n' +
      '3. 新 SceneVoiceLine 在持久化边界归一化 projectId/chapterId(deletion planning 用);不改 live TTS 生成/写路径 (只加 ownership 字段)。只迁移唯一可解析的 legacy numeric-sceneId;ambiguous → block\n' +
      '4. protected asset reference collection + 运行时解析真实 stable asset root(asset-generation-orchestrator.ts:696 的 workflow-images/assets/${assetType}/${filename},运行时解析到 character/scene/prop——核验存在 else block)。测试动态生成 derived-asset fixtures，禁断言 Python-fixture ids(var-chapter-001-*)或 toonflow_derived_assets\n' +
      '5. backup decoder registry:每个 Daojie inventory 观察到的 active + .bak format。registry 是 net-new(无 decoder 存在,.bak 在 studio-skills-storage.ts:280 被 junk-filtered)。Unknown format → block。每个注册 format 配 redacted regression fixture(Slice 6.5 step 2),在这些 transform 测试 + Slice 7 mixed-backup rewrite 测试里 cite 其 path;合成 mixed-backup JSON 禁作唯一 decoder 回归输入\n' +
      '6. 每 transform 测 before/after fixtures + immutable unrelated chapter assertions + malformed envelopes + duplicate IDs + ambiguous legacy ownership + rerun idempotence\n' +
      'Completion gate: 全部 next-state JSON + reference migration 可计算且可验证，不写盘',
    checkFocus: '核实:(a) Script transform 用 deleteEpisodeBundle reindex(非 deleteEpisode),剩余 episode.index 连续 1-based;(b) TTS 归一化在持久化边界 (非 live 写路径),legacy ambiguous → block;(c) decoder registry net-new + 每 format 有 redacted fixture cite;(d) 测试动态 fixture，无 Python-fixture id 断言。反查：transform 有无任何 fs.write(应为纯函数)。',
  },
  {
    key: '6.5',
    title: 'Multi-Chapter On-Disk Fixture Generator',
    phase: 'Slice 6.5',
    steps: 'Slice 6.5 步骤 (implement.md:82-87):\n' +
      '1. 新建 apps/build/scripts/build_multichapter_fixture.mjs:在 temp dir 合成临时项目，>=2 章，每章有 novel/script/storyboard/continuity/exports/remotion records，章独占 + 跨章共享 assets，章独占 backup，注册的多章 mixed-JSON backup。用动态 ID(ground-truth B6:无硬编码 chapter-001 contract names;trackKey=chapter-${index};derived-asset 名动态生成，非 Python-fixture ids)。emit project root path\n' +
      '2. 加 redacted real-shape mixed-backup regression fixture(剥 binary/large-text，保结构 shape + key ordering)到 apps/frontend/electron/artifacts/__fixtures__/,源自真实 Daojie backup\n' +
      'Completion gate: generator 在 temp dir 产出有效 >=2 章项目，每 category 行两章都 populated,mixed-backup fixture 经 normalization round-trip 且未触章 byte-identical',
    checkFocus: '核实:(a) build_multichapter_fixture.mjs 存在且可 node 运行，产出 >=2 章;(b) 用动态 ID(无硬编码 chapter-001/Python-fixture id);(c) __fixtures__ 有 redacted mixed-backup;(d) round-trip 未触章 byte-identical。实跑：node apps/build/scripts/build_multichapter_fixture.mjs 验证产出。',
  },
  {
    key: '7',
    title: 'Transactional Execution And Recovery',
    phase: 'Slice 7',
    steps: 'Slice 7 步骤 (implement.md:89-101),CRITICAL 事务引擎:\n' +
      '1. 新建 project-scoped deletion mutex(repo 当前无——不要假设 withFileStorageMutationLocks 覆盖，它是 per-file)。强制 project-lock-before-sorted-file-locks 获取顺序 + dedicated deadlock-regression test。lock set 从 full projector registry 派生 (每个 store file，非只 mutated)。加 free-space probe(>= rollback_bundle_bytes + protected_asset_copy_bytes + max_tempfile_bytes,2x margin,step 4 前 + step 3 rename batch 前复探)、rollback-bundle writer(temp+fsync+parent-fsync+rename，再 re-read+reverify SHA before prepared)、SHA verification、expected pre/post fingerprints、migration manifest、durable prepared/commit-ready/committed journal states\n' +
      '2. protected-asset copy/hash/repoint 在 source deletion 前;每 stable-path copy 的 path+hash append 到 journal migration manifest\n' +
      '3. temp + fsync + atomic rename 用于 project JSON + mixed-backup rewrites\n' +
      '4. 仅在 verified rollback bundle 包含 planned physical files 后才删;drift/symlink/special file/cross-root path 立即 reject。Local-media unlinks 直接在本 service 内事务执行 (bundle capture 后，与其他 physical targets 批量),不走 legacy lockless delete-image IPC\n' +
      '5. workflow freeze 下 rehydrate affected stores,commit 前跑 orphan/invalid-path/residual-chapter/backup/transaction-integrity/cross-project scans\n' +
      '6. 任一 injected failure:restore bundle + unlink 每 migration-manifest stable-path copy + rollback 路径跑同 no-residue scan + verify original fingerprint + rehydrate + 返回 typed rollback result\n' +
      '7. success:re-hash post-state fingerprint(journal transition 前;drift → rollback);durable mark commit-ready。单一 commit point = durable committed journal record(temp+fsync+atomic-rename+parent-fsync;APFS-atomic rename IS commit point,非 bundle unlink)。bundle removal 延后到 post-commit GC(先确认 journal 读 committed)。commit point 后不做 deferred business validation\n' +
      '8. startup/inventory recovery 单分支 on journal state:committed(有无 bundle)→ committed-success，删 stale journal 幂等，best-effort POST fingerprint(不 block);commit-ready WITH bundle → restore + verify PRE(rollback);commit-ready WITHOUT bundle → impossible/corrupt，block;prepared WITH bundle → restore + verify PRE(rollback);missing/corrupt bundle before committed → block;ENOSPC during restore → 留 bundle + journal 在 prepared 供人工恢复。每 state transition 测 crash\n' +
      '9. 仅在全部 rollback/drift/recovery 测试绿后注册 execute IPC\n' +
      'Completion gate: build_multichapter_fixture.mjs(Slice 6.5)产出的临时多章 fixture 通过 success/failure injection/crash recovery/zero-residue 检查，不触 live project data',
    checkFocus: '核实 (最高风险 slice):(a) project-scoped mutex 存在 + deadlock-regression test;(b) commit point 是 committed journal rename(非 bundle unlink);(c) recovery 单分支 6 种 journal state 全覆盖 + 测试;(d) free-space 2x margin + 复探;(e) local-media unlink 在事务内 (非 legacy delete-image);(f) execute IPC 仅在测试绿后注册;(g) 全部测试只跑 fixture(零 live Daojie 写)。跑 cd apps && npm test -- frontend/electron/artifacts 验证事务/recovery 测试绿。',
  },
  {
    key: '8',
    title: 'Route Every Delete Entry Through One Controller',
    phase: 'Slice 8',
    steps: 'Slice 8 步骤 (implement.md:103-113):\n' +
      '1. artifact store 启用 execute，保留单一 requestChapterDeletion controller 作唯一 chapter-delete UI path\n' +
      '2. NovelTab 直接 deleteNovelChapters 执行 → 换 shared async plan/dialog/controller\n' +
      '3. Script CRUD + Overview 直接 deleteEpisodeBundle 执行 → 换同一 chapter controller + stable chapter identity mapping\n' +
      '4. media context-menu 立即删除 → media 有 project ownership 时走 artifact planning;只非项目 ephemeral cleanup 留在 service 外\n' +
      '5. success 后:clear selected IDs + close dialog + rehydrate 每 affected store + refresh inventory + post-scan clean 才显 success\n' +
      '6. failure 后:保 selection + dialog evidence + 显 typed failure/rollback status + 只允许 fresh replan\n' +
      '7. source-contract tests 证明旧直接 delete calls 从 UI entry points 消失 + shared controller 被用\n' +
      'Completion gate: Novel/Script/Overview/Artifact Center 对一章返回同一 planId/scope + 不能绕过 confirmation',
    checkFocus: '核实:(a) NovelTab 不再直接调 deleteNovelChapters(grep);\n(b) Script/Overview 不再直接调 deleteEpisodeBundle 执行 (grep);\n(c) 单一 requestChapterDeletion controller;\n(d) source-contract 测试证明旧直接调用消失;\n(e) success/failure 路径 (post-scan clean 才显 success)。',
  },
  {
    key: '9',
    title: 'Verification And Handoff',
    phase: 'Slice 9',
    steps: 'Slice 9 步骤 (implement.md:115-129):\n' +
      '1. cd apps 跑全部 focused artifact/store/component/preload/IPC/transaction/recovery tests\n' +
      '2. npm run typecheck\n' +
      '3. npm run lint\n' +
      '4. npm test\n' +
      '5. npm run test:all -- --skip-release,inspect output/automation/quality-gate-report.json\n' +
      '6. 对 live Daojie 再跑只读 inventory。报告 counts + blockers;不删不改 live data\n' +
      '7. 用 build_multichapter_fixture.mjs(Slice 6.5)生成临时多章 fixture,destructive smoke 只在它上跑。核实 protected asset hashes/untouched chapter hashes/mixed backups/no chapter residue/no transaction residue\n' +
      '8. 启动本地 app,desktop + narrow 窗口目检 artifact center + delete dialog;长名/路径不重叠 + 键盘焦点可见\n' +
      '9. 因 UI + Electron IPC 改动，从 apps/ 跑唯一 macOS 打包入口：sh ./build/packaging/build-mac.sh --arm64。用其 installed smoke 结果;不做手动 app copying\n' +
      '10. 分别报告 focused/full/packaged/live-inventory/destructive-fixture evidence。绝不安称 fixture 删除为 live-project 删除\n' +
      '11. Phase 3.3 spec write-back(必需):把 per-project deletion mutex(C1) + resolveProjectRootPath(C2) + mixed-JSON backup decoder registry(C3) 加到 .trellis/spec/frontend/state-management.md。cite 本 task 为引入变更。不删/弱化 spec;已覆盖则 cross-reference\n' +
      'Completion gate: 全部 focused/full/typecheck/lint/packaging evidence 绿或既存红 + destructive-fixture smoke clean + live Daojie 只读未改 + C1/C2/C3 net-new infra contracts 记录在 .trellis/spec/ 带可审 diff',
    checkFocus: '核实:(a) typecheck/lint/npm test 全绿或仅既存红 (看 quality-gate-report.json);\n(b) live Daojie 只读 (零写);\n(c) destructive smoke 只在 fixture 上;\n(d) 打包 sh ./build/packaging/build-mac.sh --arm64 完成 (不只停安装包);\n(e) state-management.md 有 C1/C2/C3 write-back;\n(f) evidence 分类报告。这是最终 slice，需最严格核验。',
  },
]

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    sliceKey: { type: 'string' },
    gatePassed: { type: 'boolean', description: 'true 仅当 Completion gate 的每一条客观条件都由你亲自核实 (读文件/跑命令),非实现者自报' },
    evidence: { type: 'string', description: '逐条 gate 条件 + 你核实的命令输出/文件坐标 (file:line)。空泛「看起来对了」不接受。' },
    newFailures: { type: 'string', description: '本 slice 引入的新失败 (typecheck/test/lint)。无则填 none。' },
    liveDaojieTouched: { type: 'boolean', description: '本 slice 是否对 live Daojie 写入/删除 (必须 false;Slice 3/6/9 只读)' },
    blocker: { type: 'string', description: '若 gatePassed=false，具体阻塞点 + 建议主代理如何处理 (重跑/缩范围/人工)。无则填 none。' },
  },
  required: ['sliceKey', 'gatePassed', 'evidence', 'newFailures', 'liveDaojieTouched', 'blocker'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    sliceKey: { type: 'string' },
    done: { type: 'boolean', description: 'true 仅当本 slice 全部 step 完成' },
    filesCreated: { type: 'array', items: { type: 'string' }, description: '新建文件路径 (repo-relative)' },
    filesModified: { type: 'array', items: { type: 'string' }, description: '修改的已有文件路径 (repo-relative)' },
    backupsCreated: { type: 'array', items: { type: 'string' }, description: '改已有源文件前 cp 到 backups/source/ 的文件' },
    verification: { type: 'string', description: '本 slice 跑的验证命令 + 结果 (通过/失败 + 关键输出摘要)' },
    liveDaojieTouched: { type: 'boolean' },
    notes: { type: 'string', description: '偏离 implement.md 的地方、假设、待主代理裁决项。无则 none。' },
  },
  required: ['sliceKey', 'done', 'filesCreated', 'filesModified', 'verification', 'liveDaojieTouched', 'notes'],
}

const RULES = `Active task: ${TASK}
仓库根：${REPO}(所有 npm 命令从 apps/ 执行，无根 package.json)

铁律 (全部适用，违反即终止):
- 禁止任何 git 命令 (add/commit/push/branch/checkout/reset/stash/clean/log/diff 等)。commit 由主代理后续单独获用户同意。
- 禁止 worktree，禁止在 .claude/worktrees 下写。
- 禁止对 live Daojie 项目 (项目 ID 49dce4c1-64b1-42de-85c2-9f266698aec0,chapter-001) 做任何写入/删除。live 数据只读盘点;破坏性验证只用生成的临时 fixture。
- 改已有源文件前，先 cp 到 .trellis/tasks/08-04-artifact-output-management/backups/source/,记录原 SHA-256 到 manifest。新文件无需备份。
- Edit 的 new_string 不得为空 (除非用户明确要求删该内容)。禁止 rm -rf / 批量删 / 清空文件。
- 遵守 implement.md「Execution Rules」与「Risky Files And Rollback Points」。
- 铁律 0:动手前用 Read/Grep 核实接口、字段、符号、路径，绝不猜。改任何值前 grep -r 确认无其它引用。
- 铁律 1:渐进分段，小步多次。
- 严禁猜测：不确定的标识符 (键名/变量/路径/字段) 先读源码取精确表述，取不到就报告阻塞，不臆造。
- 只做本 slice 范围内的改动，不顺手重构/越界。`;

const results = []

for (const s of SLICES) {
  log(`▶ ${s.phase}: ${s.title} — implement`)

  // ── Stage 1: implement ──
  const implPrompt = `${RULES}

你是 trellis-implement worker。只执行 ${s.phase}(${s.title}),不碰其它 slice。

先 Read 这些文件建立上下文 (若 hook 已注入可跳过):
- ${TASK}/prd.md
- ${TASK}/design.md
- ${TASK}/implement.md(只看你负责的 slice 段)
- ${TASK}/research/artifact-dependency-inventory.md(Slice 3/6/9 必读)
- ${TASK}/implement.jsonl 列出的 spec/research 文件
- apps/frontend 相关源码 (用 Read/Grep,精确取符号)

${s.steps}

执行完毕后按 schema 报告。verification 字段必须是你实际跑过的命令 + 真实输出摘要，不是计划。`

  const impl = await agent(implPrompt, {
    label: `impl:slice-${s.key}`,
    phase: s.phase,
    agentType: 'trellis-implement',
    schema: IMPL_SCHEMA,
  })

  if (!impl || !impl.done || impl.liveDaojieTouched) {
    log(`✗ ${s.phase} implement 未完成或触 live Daojie — 停链`)
    results.push({ slice: s.key, title: s.title, stage: 'implement-failed', impl })
    break
  }
  log(`✓ ${s.phase} implement done: ${impl.filesCreated.length} created, ${impl.filesModified.length} modified`)

  // ── Stage 2: check (gate) ──
  log(`▶ ${s.phase}: ${s.title} — check (gate)`)
  const checkPrompt = `${RULES}

你是 trellis-check worker，独立核实 ${s.phase}(${s.title}) 是否真正满足 Completion gate。你不是实现者的复述者——你的职责是**找哪里可能错**。

实现者报告 (IMPL):
${JSON.stringify(impl, null, 2)}

核实重点:
${s.checkFocus}

Completion gate(必须逐条客观核实):
${s.steps.split('Completion gate:')[1] || '(见 implement.md)'}

核实方法:
1. Read 实现者声称创建/修改的文件，确认存在且内容符合 gate。
2. 实跑验证命令 (cd apps && ...),看真实输出，不只信报告。
3. 反查破坏性约束:grep fs.write/fs.unlink/git/delete-image 等是否在不应出现的地方;grep 确认旧调用已移除。
4. live Daojie 必须零写 (Slice 3/6/9)。

gatePassed=true 仅当每条 gate 条件你都亲自用命令/读文件核实过。任一条只能凭实现者自报 → gatePassed=false + blocker 说明。

按 schema 报告。`

  const chk = await agent(checkPrompt, {
    label: `check:slice-${s.key}`,
    phase: s.phase,
    agentType: 'trellis-check',
    schema: GATE_SCHEMA,
  })

  results.push({ slice: s.key, title: s.title, stage: 'checked', impl, check: chk })

  if (!chk || !chk.gatePassed || chk.liveDaojieTouched) {
    log(`✗ ${s.phase} gate FAIL — 停链 (blocker: ${chk ? chk.blocker : 'no check result'})`)
    break
  }
  log(`✓ ${s.phase} gate PASS`)
}

const passed = results.filter(r => r.stage === 'checked' && r.check && r.check.gatePassed).length
const failed = results.filter(r => r.stage !== 'checked' || !r.check || !r.check.gatePassed)
log(`Phase 2 完成：${passed}/${SLICES.length} slice gate PASS${failed.length ? `, 停在 ${results[results.length - 1].slice}` : ''}`)

return {
  totalSlices: SLICES.length,
  passed,
  results: results.map(r => ({
    slice: r.slice,
    title: r.title,
    stage: r.stage,
    gatePassed: r.check ? r.check.gatePassed : false,
    filesCreated: r.impl ? r.impl.filesCreated : [],
    filesModified: r.impl ? r.impl.filesModified : [],
    verification: r.impl ? r.impl.verification : '',
    checkEvidence: r.check ? r.check.evidence : '',
    blocker: r.check ? r.check.blocker : (r.stage === 'implement-failed' ? 'implement did not complete' : 'no check'),
    newFailures: r.check ? r.check.newFailures : '',
  })),
}
