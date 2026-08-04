export const meta = {
  name: 'phase2-artifact-slices',
  description: 'Trellis Phase 2 实施：严格有序执行 08-04-artifact-output-management 的 9 个 slice，batched to avoid 429',
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

// RULES as string concatenation to avoid template literal issues
const RULES = "Active task: " + TASK + "\n仓库根：" + REPO + "(所有 npm 命令从 apps/ 执行，无根 package.json)\n\n铁律 (全部适用，违反即终止):\n- 禁止任何 git 命令 (add/commit/push/branch/checkout/reset/stash/clean/log/diff 等)。commit 由主代理后续单独获用户同意。\n- 禁止 worktree，禁止在 .claude/worktrees 下写。\n- 禁止对 live Daojie 项目 (项目 ID 49dce4c1-64b1-42de-85c2-9f266698aec0,chapter-001) 做任何写入/删除。live 数据只读盘点;破坏性验证只用生成的临时 fixture。\n- 改已有源文件前，先 cp 到 .trellis/tasks/08-04-artifact-output-management/backups/source/,记录原 SHA-256 到 manifest。新文件无需备份。\n- Edit 的 new_string 不得为空 (除非用户明确要求删该内容)。禁止 rm -rf / 批量删 / 清空文件。\n- 遵守 implement.md「Execution Rules」与「Risky Files And Rollback Points」。\n- 铁律 0:动手前用 Read/Grep 核实接口、字段、符号、路径，绝不猜。改任何值前 grep -r 确认无其它引用。\n- 铁律 1:渐进分段，小步多次。\n- 严禁猜测：不确定的标识符 (键名/变量/路径/字段) 先读源码取精确表述，取不到就报告阻塞，不臆造。\n- 只做本 slice 范围内的改动，不顺手重构/越界。";

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
    checkFocus: '核实:(a) frontend/types/artifacts.ts 存在且导出 finite unions + discriminated types;(b) decoders reject unknown fields;(c) contract tests 覆盖 5 类无效输入;(d) research/baseline-1-green-red.md 记录了 7 文件基线;(e) cd apps && npx tsc --noEmit 对新文件通过 (或仅既存红)。'
  },
  {
    key: '2',
    title: 'Pure Projection And Dependency Graph',
    phase: 'Slice 2',
    steps: 'Slice 2 步骤 (implement.md:27-36),纯内存，零文件系统:\n' +
      '1. 新建 frontend/lib/artifacts/artifact-projection.ts + fixture builders\n' +
      '2. project stable IDs / stages / ownership / physical refs / upstream-downstream\n' +
      '3. legacy mapping rules:episode-1 / numeric TTS sceneId / chapter-${index} trackKey / ScriptData Episode.id\n' +
      '4. 新建 artifact-dependency-graph.ts:exclusive-downstream cascade / shared-reference retention\n' +
      '5. 新建 artifact-metadata.ts:bounded name/tags/notes validation\n' +
      '6. tests:chapter deletion / script-root deletion / single-artifact / shared asset / ambiguous blockers\n' +
      'Completion gate: 纯内存 fixture 产出预期 delete/migrate/retain/blocker sets',
    checkFocus: '核实:(a) 3 个新文件存在;(b) graph 逻辑有 fixture 测试;(c) legacy mapping 全覆盖;(d) 纯内存测试无 fs 访问。'
  },
  {
    key: '3',
    title: 'Read-Only Electron Inventory',
    phase: 'Slice 3',
    steps: 'Slice 3 步骤 (implement.md:38-47):\n' +
      '1. 在 storage-paths.ts 加 resolveProjectRootPath(dataRoot, projectId)，带 containment 测试\n' +
      '2. 新建 artifact-inventory-service.ts 用 resolveProjectRootPath 作 scan root，plus withFileStorageMutationLocks\n' +
      '3. 只扫 project root + referenced local-media。记录 relative path/file type/bytes/mtime/SHA-256/symlink blocker\n' +
      '4. 注册 decoders:active stores / Remotion / chapter-only backups / mixed JSON\n' +
      '5. compare renderer live vs disk snapshots,返回 typed discrepancies\n' +
      '6. 加只读 inventory IPC + preload bridge + global type + tests\n' +
      '7. 对 live Daojie 跑只读 inventory，对比 baseline，报告 diff\n' +
      'Completion gate: 零写入 + path escape/symlink fail closed + 每件产物解析到已知 stage 或 typed unknown blocker + counts 对齐 baseline',
    checkFocus: '核实:(a) resolveProjectRootPath 存在且有 containment 测试;(b) inventory-service 只读 (grep 无 fs.write/fs.unlink);(c) inventory IPC + preload + 测试;(d) live Daojie 零写。'
  },
  {
    key: '4',
    title: 'Artifact Center Read UI And Metadata',
    phase: 'Slice 4',
    steps: 'Slice 4 步骤 (implement.md:49-58):\n' +
      '1. 新建 project-scoped artifact store:loading/error / filters / selection / fencing\n' +
      '2. 拆 media 路由为「工作流产物」+「媒体库」两 tab\n' +
      '3. 建 chapter/stage tree + dense table + detail panel(Radix/Lucide)\n' +
      '4. 展示全部 detail:scope/stage/kind/state/times/bytes/paths/upstream/downstream/delete policy\n' +
      '5. 只允许 name/tags/notes 编辑。typed navigation\n' +
      '6. component tests:empty/loading/failure/hierarchy/filters/paths/metadata/same-chapter-selection-reset + DEDICATED R18 test\n' +
      'Completion gate: 每种 kind 有面板渲染测试 + media-library regression 过 + rg execute 无 handler',
    checkFocus: '核实:(a) artifact store + fencing;(b) media 拆 2 tab 且 regression 过;(c) R18 dedicated 测试;(d) rg execute 无 handler。'
  },
  {
    key: '5',
    title: 'Immutable Deletion Plan And Dialog',
    phase: 'Slice 5',
    steps: 'Slice 5 步骤 (implement.md:60-69),execute 禁用直到 Slice 6:\n' +
      '1. Electron service 加 plan creation(normalized structured + physical fingerprints)\n' +
      '2. 返回 deterministic grouped delete/migrate/retain/blocker sections\n' +
      '3. artifact store 加 plan requests，invalidate on changes\n' +
      '4. 建 ArtifactDeleteDialog.tsx:「删除后无法恢复」警告 + grouped details\n' +
      '5. chapter scope 要求精确 title/ID;cancel/mismatch 零 mutation\n' +
      '6. Novel/Script/Overview delete → open dialog(execute gated)\n' +
      'Completion gate: 各入口同一章产出同一 plan + confirmation/cancel 测试零物理写入',
    checkFocus: '核实:(a) plan deterministic groups;(b) Dialog 有警告+blocker disable;(c) cancel 零写入测试;(d) no execute registered。'
  },
  {
    key: '6',
    title: 'Persisted-State Transforms And Ownership Migration',
    phase: 'Slice 6',
    steps: 'Slice 6 步骤 (implement.md:71-80),纯计算不写盘:\n' +
      '1. pure chapter-removal transforms:Studio/Script/Director/Editing/TTS/Media/Remotion\n' +
      '2. Script 用 deleteEpisodeBundle reindex(script-store.ts:438-439)，assert contiguous index\n' +
      '3. TTS 新数据持久化边界归一化 projectId/chapterId，legacy ambiguous → block\n' +
      '4. protected asset reference collection + asset-generation-orchestrator.ts:696 verification\n' +
      '5. backup decoder registry:net-new(.bak junk-filtered),每 format redacted fixture\n' +
      '6. 每 transform 测 before/after + immutable assertions + malformed + rerun idempotence\n' +
      'Completion gate: next-state JSON + migrations 可计算验证，不写盘',
    checkFocus: '核实:(a) Script 用 deleteEpisodeBundle，index 连续 1-based;(b) TTS 归一化在持久化边界;(c) registry net-new + fixtures cited;(d) 无 fs.write。'
  },
  {
    key: '6.5',
    title: 'Multi-Chapter On-Disk Fixture Generator',
    phase: 'Slice 6.5',
    steps: 'Slice 6.5 步骤 (implement.md:82-87):\n' +
      '1. 新建 apps/build/scripts/build_multichapter_fixture.mjs:temp dir合成>=2 章项目,dynamic IDs,trackKey=chapter-${index}\n' +
      '2. 加 redacted real-shape mixed-backup fixture 到 __fixtures__/\n' +
      'Completion gate: generator 产出有效 >=2 章项目,mixed-backup round-trip byte-identical for untouched chapters',
    checkFocus: '核实:(a) mjs 存在且 node 运行产出差集;(b) dynamic IDs(no hardcode);(c) redacted fixture exists。'
  },
  {
    key: '7',
    title: 'Transactional Execution And Recovery',
    phase: 'Slice 7',
    steps: 'Slice 7 步骤 (implement.md:89-101),CRITICAL 事务引擎:\n' +
      '1. 新建 project-scoped mutex(net-new)+ deadlock-regression-test+ free-space probe(2x margin)+ rollback-bundle(temp+fsync+rename+reverify)+ journals(prepared/commit-ready/committed)\n' +
      '2. protected-asset copy/hash/repoint before source deletion\n' +
      '3. temp + fsync + atomic rename for JSON + mixed-backup\n' +
      '4. Local-media unlinks in-service(batch),not legacy delete-image\n' +
      '5. workflow freeze + post-commit scans(orphan/path/residual/backup/integrity/cross-project)\n' +
      '6. failure:restore bundle + unlink manifest copies + rollback scan + typed result\n' +
      '7. success:re-hash fingerprint; commit point = committed journal rename(temp+fsync+atomic-rename+parent-fsync); deferred GC only after journal==committed\n' +
      '8. recovery 单分支:committed→success;commit-ready-with-bundle→rollback;commit-ready-no-bundle→block;prepared→rollback;missing/corrupt→block;ENOSPC→leave prepared\n' +
      '9. execute IPC only after all rollback/drift/recovery tests green\n' +
      'Completion gate: multi-chapter fixture 通过 success/failure injection/crash recovery/zero-residue,no live write',
    checkFocus: '核实 (最高风险):(a) project-scoped mutex + deadlock test;(b) commit point=journal rename 非 bundle unlink;(c) recovery 6 states 全覆盖;(d) free-space 2x margin;(e) no live Daojie write。'
  },
  {
    key: '8',
    title: 'Route Every Delete Entry Through One Controller',
    phase: 'Slice 8',
    steps: 'Slice 8 步骤 (implement.md:103-113):\n' +
      '1. artifact store 启用 execute，保留单一 requestChapterDeletion controller\n' +
      '2. NovelTab:direct deleteNovelChapters → shared plan/dialog/controller\n' +
      '3. Script CRUD/Overview:direct deleteEpisodeBundle → same chapter controller\n' +
      '4. media context-menu immediate → artifact planning for project-owned\n' +
      '5. success:clear IDs/close dialog/rehydrate/refresh/post-scan clean→success\n' +
      '6. failure:preserve selection/show typed status/fresh replan only\n' +
      '7. source-contract tests:old calls absent from UI,controller used\n' +
      'Completion gate: Novel/Script/Overview/Artifact Center 同一章同一 planId + 不能绕过 confirmation',
    checkFocus: '核实:(a) NovelTab 不调 deleteNovelChapters(grep);(b) Script/Overview 不调 deleteEpisodeBundle(grep);(c) 单一 controller;(d) source-contract tests。'
  },
  {
    key: '9',
    title: 'Verification And Handoff',
    phase: 'Slice 9',
    steps: 'Slice 9 步骤 (implement.md:115-129):\n' +
      '1. cd apps 跑 focused/full/typecheck/lint/test/test:all\n' +
      '2. 对 live Daojie 再跑只读 inventory。报告 counts + blockers;不删不改\n' +
      '3. 用 build_multichapter_fixture.mjs 生成多章 fixture,destructive smoke 只在它上跑\n' +
      '4. 启动本地 app,desktop+narrow 目检 UI\n' +
      '5. macOS 打包：sh ./build/packaging/build-mac.sh --arm64,用 installed smoke\n' +
      '6. 分别报告 focused/full/packaged/live-inventory/destructive-fixture evidence\n' +
      '7. Phase 3.3 spec write-back:C1 mutex + C2 resolveProjectRootPath + C3 decoder registry → state-management.md\n' +
      'Completion gate: typecheck/lint/test 全绿或既存红 + destructive smoke clean + live read-only + specs written',
    checkFocus: '核实:(a) quality-gate-report.json 全绿或既存红;(b) live 只读;(c) smoke 只在 fixture;(d) 打包完整完成;(e) state-management.md 有 C1/C2/C3。'
  }
]

const GATE_SCHEMA = {
  type: 'object',
  properties: {
    sliceKey: { type: 'string' },
    gatePassed: { type: 'boolean' },
    evidence: { type: 'string' },
    newFailures: { type: 'string' },
    liveDaojieTouched: { type: 'boolean' },
    blocker: { type: 'string' },
  },
  required: ['sliceKey', 'gatePassed', 'evidence', 'newFailures', 'liveDaojieTouched', 'blocker'],
}

const IMPL_SCHEMA = {
  type: 'object',
  properties: {
    sliceKey: { type: 'string' },
    done: { type: 'boolean' },
    filesCreated: { type: 'array', items: { type: 'string' } },
    filesModified: { type: 'array', items: { type: 'string' } },
    backupsCreated: { type: 'array', items: { type: 'string' } },
    verification: { type: 'string' },
    liveDaojieTouched: { type: 'boolean' },
    notes: { type: 'string' },
  },
  required: ['sliceKey', 'done', 'filesCreated', 'filesModified', 'verification', 'liveDaojieTouched', 'notes'],
}

const results = []

for (const s of SLICES) {
  log(`▶ ${s.phase}: ${s.title} — implement`)

  // Stage 1: implement
  const implPrompt = `${RULES}\n\n你是 trellis-implement worker。只执行 ${s.phase}(${s.title})。\n\n先 Read: ${TASK}/prd.md, design.md, implement.md(relevant section), research/artifact-dependency-inventory.md(Slice 3/6/9), implement.jsonl, frontend sources.\n\nSteps:\n${s.steps}\n\n完成后按 schema 报告，verification 字段必须是你实际跑过的命令 + 真实输出。`

  const impl = await agent(implPrompt, {
    label: `impl:${s.key}`,
    phase: s.phase,
    agentType: 'trellis-implement',
    schema: IMPL_SCHEMA,
  })

  if (!impl || !impl.done || impl.liveDaojieTouched) {
    log(`✗ ${s.phase} implement failed — stop chain`)
    results.push({ slice: s.key, title: s.title, stage: 'implement-failed', impl })
    break
  }
  log(`✓ ${s.phase} implement done: ${impl.filesCreated.length} created, ${impl.filesModified.length} modified`)

  // Stage 2: check (gate)
  log(`▶ ${s.phase}: ${s.title} — check (gate)`)
  const checkPrompt = `${RULES}\n\n你是 trellis-check worker，独立核实 ${s.phase}(${s.title}) Completion gate。\n\n实现者报告:\n${JSON.stringify(impl, null, 2)}\n\n核实重点:\n${s.checkFocus}\n\nCompletion gate:\n${s.steps.split('Completion gate:')[1]}\n\ngatePassed=true 仅当每条 gate 条件你都亲自用命令/读文件核实过。按 schema 报告。`

  const chk = await agent(checkPrompt, {
    label: `check:${s.key}`,
    phase: s.phase,
    agentType: 'trellis-check',
    schema: GATE_SCHEMA,
  })

  results.push({ slice: s.key, title: s.title, stage: 'checked', impl, check: chk })

  if (!chk || !chk.gatePassed || chk.liveDaojieTouched) {
    log(`✗ ${s.phase} gate FAIL — stop (blocker: ${chk ? chk.blocker : 'no check result'})`)
    break
  }
  log(`✓ ${s.phase} gate PASS`)
}

const passed = results.filter(r => r.stage === 'checked' && r.check && r.check.gatePassed).length
log(`Phase 2 完成：${passed}/${SLICES.length} slice gate PASS`)

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
