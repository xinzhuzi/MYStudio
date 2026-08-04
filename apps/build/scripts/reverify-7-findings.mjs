export const meta = {
  name: 'artifact-plan-reverify-7',
  description: '定向重跑 7 条因 API 429 限流未验证的对抗审查 findings,每条 2 个独立 skeptic',
  phases: [{ title: 'Reverify', detail: '14 个 skeptic 分批验证 7 条 findings' }],
}

const TASK_DIR = '/Users/zhengbingjin/Project/Github/MYStudio/.trellis/tasks/08-04-artifact-output-management'

// 7 条未验证 finding 的精确上下文(problem + proposed-fix + plan 原文锚点)
const FINDINGS = [
  {
    id: 'DEP-2',
    severity: 'high',
    title: "Slice 5/6/7 ordering: Slice 5 completion gate depends on Slice 6 transforms",
    claim: `Slice 5 step 6 (implement.md:67) says 'keep execute disabled behind an internal feature gate until Slice 6 passes' and its Completion gate (implement.md:69) requires 'every destructive entry point produces the same plan for the same chapter, and all confirmation/cancel tests pass with zero physical writes.' Slice 5 step 1-2 (implement.md:62-63) builds the plan service using 'normalized structured and physical fingerprints' and returns 'deterministic grouped delete/migrate/retain/blocker sections'. But computing the migrate/retain next-state shape requires the pure chapter-removal transforms from Slice 6 step 1 (implement.md:73 'Add pure chapter-removal transforms for Studio, Script, Director, Editing, TTS, Media, and Remotion persisted shapes') and the protected-asset migration paths from Slice 6 step 4. If Slice 5 runs before Slice 6, the plan's migrate/retain sections cannot be fingerprinted because the transform that computes the retained-state shape does not exist yet. So Slice 5 is effectively blockedBy Slice 6, but the ordering lists Slice 5 BEFORE Slice 6. The cancel/mismatch path (zero writes) IS testable without Slice 6, but the deterministic-plan gate is not.`,
    planQuotes: [
      "implement.md:62 'Add plan creation to the Electron service using normalized structured and physical fingerprints.'",
      "implement.md:63 'Return deterministic grouped delete/migrate/retain/blocker sections with count and byte totals; never accept raw renderer paths.'",
      "implement.md:67 'Wire Novel and Script/Overview delete buttons only to open the shared plan dialog; keep execute disabled behind an internal feature gate until Slice 6 passes.'",
      "implement.md:69 Completion gate: 'every destructive entry point produces the same plan for the same chapter, and all confirmation/cancel tests pass with zero physical writes.'",
      "implement.md:73 Slice 6 step 1: 'Add pure chapter-removal transforms for Studio, Script, Director, Editing, TTS, Media, and Remotion persisted shapes.'",
    ],
  },
  {
    id: 'CONTR-12',
    severity: 'medium',
    title: "AC 'switching chapter clears selection' has no dedicated implement.md step",
    claim: `PRD Acceptance Criterion (prd.md): '切换章节时已有选择被明确清除或要求用户先取消,且不会静默扩大删除范围.' (R18: batch limited to same chapter). implement.md Slice 4 step 6 (implement.md:56) lists 'same-chapter selection reset' as ONE item among seven in a component-test enumeration ('Add component tests for empty/loading/failure states, hierarchy counts, filters, long paths, metadata validation, same-chapter selection reset, and media-library regression'). Slice 5 step 3 (implement.md:64) says 'Invalidate plans on project, chapter, selection, live/disk revision, or running-job change.' Neither slice has an EXPLICIT tested behavior for: user selects artifacts in chapter A, switches to chapter B, selection MUST be cleared (or user forced to cancel) with no silent scope expansion. Without a dedicated step the AC is only incidentally covered by a single bullet in a 7-item test list.`,
    planQuotes: [
      "implement.md:56 Slice 4 step 6: 'Add component tests for empty/loading/failure states, hierarchy counts, filters, long paths, metadata validation, same-chapter selection reset, and media-library regression.'",
      "implement.md:64 Slice 5 step 3: 'Invalidate plans on project, chapter, selection, live/disk revision, or running-job change.'",
      "implement.md:51 Slice 4 step 1: 'Add the project-scoped artifact store with loading/error state, hierarchy filters, stable selection, metadata overlays, and project-switch fencing.'",
    ],
  },
  {
    id: 'DEP-3',
    severity: 'medium',
    title: "Slice 3 Completion gate 'can be fully classified OR has explicit blockers' is a subjective disjunction",
    claim: `Slice 3 Completion gate (implement.md:47): 'live inventory performs zero writes, path escapes and symlinks fail closed, and the first chapter can be fully classified OR has explicit blockers.' The disjunction 'fully classified OR has explicit blockers' is an escape hatch that lets the slice pass even when classification fails — every unclassifiable artifact can be dumped into a generic 'blocker' bucket and the gate passes vacuously. This is the subjective-gate anti-pattern: a worker cannot fail this gate because any classification failure routes to 'blockers' and still passes. The gate should instead require that every artifact resolves to a known stage OR is returned as an explicit typed 'unknown' blocker with a recorded reason, and that reported category counts match the research baseline (artifact-dependency-inventory.md) with diffs recorded as typed discrepancies, not silently swallowed.`,
    planQuotes: [
      "implement.md:47 Slice 3 Completion gate: 'live inventory performs zero writes, path escapes and symlinks fail closed, and the first chapter can be fully classified or has explicit blockers.'",
      "implement.md:45 Slice 3 step 6: 'Run inventory against the current live Daojie project read-only and compare the reported chapter-001 categories/counts with the research baseline; report differences instead of updating expected values silently.'",
    ],
  },
  {
    id: 'DEP-4',
    severity: 'medium',
    title: "No slice covers the workflow Phase 3.3 spec-update step for net-new infra (C1/C2/C3)",
    claim: `grep for 'spec update' / 'phase 3.3' / '.trellis/spec' edits in implement.md returns nothing. The task introduces net-new infrastructure per the verification report (plan-verification-2026-08-04.md): C1 per-project deletion mutex (none exists; only per-file withFileStorageMutationLocks), C2 resolveProjectRootPath helper (resolveProjectScopedFilePath(dataRoot,projectId,'') throws in normalizeRelativePath), C3 mixed-JSON backup decoder registry (none exists; .bak is junk-filtered). These are exactly the reusable contract/infrastructure the trellis Phase 3.3 spec-update step is meant to capture. implement.jsonl lists spec files only as READ context, not as files to edit. Slice 9 (Verification And Handoff) runs tests/packaging but performs no spec write-back. A worker following the slices literally will never update spec, losing the C1/C2/C3 infra contracts for future tasks.`,
    planQuotes: [
      "implement.md Slice 9 (implement.md:108-119): steps 1-10 are all test/packaging/report runs; no step writes to .trellis/spec/.",
      "implement.jsonl: all entries are READ context (research + spec files as 'reason' for reading), none list spec files as edit targets.",
    ],
  },
  {
    id: 'DEP-5',
    severity: 'low',
    title: "Slice 4 Completion gate 'useful in read-only mode' is not objectively verifiable",
    claim: `Slice 4 Completion gate (implement.md:58): 'the artifact center is useful in read-only mode, all original media workflows remain available, and no delete execute bridge exists in the renderer.' The clause 'useful in read-only mode' is not objectively verifiable — a worker cannot self-assess 'useful.' The other two clauses ARE objective ('all original media workflows remain available' = media-library regression test passes; 'no delete execute bridge exists' = rg for execute handler in frontend/lib/bridge returns nothing). A subjective clause in a completion gate lets a worker declare done without a falsifiable check. The gate should replace 'useful in read-only mode' with: every artifact kind in types/artifacts.ts has a passing component test asserting it renders in the detail panel with non-empty scope/stage/kind/path fields.`,
    planQuotes: [
      "implement.md:58 Slice 4 Completion gate: 'the artifact center is useful in read-only mode, all original media workflows remain available, and no delete execute bridge exists in the renderer.'",
      "implement.md:56 Slice 4 step 6: 'Add component tests for empty/loading/failure states, hierarchy counts, filters, long paths, metadata validation, same-chapter selection reset, and media-library regression.'",
    ],
  },
  {
    id: 'DEP-7',
    severity: 'low',
    title: "Slice 1 baseline tests verified as existing files but plan does not prove they currently PASS",
    claim: `Slice 1 step 1 (implement.md:13-20) runs 7 baseline test files: media/index.test.tsx, studio/novel-tab.test.tsx, stores/studio/studio-store.test.ts, stores/script/script-store.test.ts, stores/editing/editing-store.test.ts, stores/tts/tts-store.test.ts, electron/ipc/files/project-file-ipc.test.ts. plan-verification-2026-08-04.md confirms all 7 files EXIST on disk. But neither the plan nor the verification report records that these tests currently PASS on a clean main checkout. Slice 1 Completion gate (implement.md:25): 'shared types compile, invalid inputs fail closed, and no product entry point changes behavior.' If any baseline test is red on main, the gate 'no product entry point changes behavior' becomes un-falsifiable — a worker cannot distinguish pre-existing red from a regression introduced by Slice 1. The gate should require: record green/red status of each baseline test BEFORE any edit; if any is red on clean main, record it as a pre-existing baseline failure and the gate then requires no NEW failures rather than all-green.`,
    planQuotes: [
      "implement.md:13-20 Slice 1 step 1: runs 7 baseline tests (media/index, novel-tab, studio-store, script-store, editing-store, tts-store, project-file-ipc).",
      "implement.md:25 Slice 1 Completion gate: 'shared types compile, invalid inputs fail closed, and no product entry point changes behavior.'",
    ],
  },
  {
    id: 'VERIF-6',
    severity: 'low',
    title: "Electron main-process test infra is valid but plan does not name the established pattern",
    claim: `Slice 7 transaction/recovery tests (implement.md:84-92) run in the Electron main process (IPC handlers, node:fs, locks). design.md:161 lists 'mixed backup rewrite, rollback bundle recovery, insufficient disk space, lock ordering' as Electron tests. The repo HAS a working main-process test harness: existing tests use '// @vitest-environment node' + 'vi.mock(\"electron\", () => ({ ipcMain: { handle } }))' and capture handlers into a Map (electron/ipc/files/project-file-ipc.test.ts), and real-fs storage tests exist (storage-paths.test.ts uses node:fs/mkdtemp). So the assumption holds — NOT a capability gap. BUT the plan never cites this pattern. vite.config.ts test block sets NO default environment, meaning tests inherit vitest defaults (jsdom in many setups); main-process tests MUST opt into node env explicitly via the directive. An implementer could wrongly assume jsdom where node:fs/real locks would fail. The plan should require each Electron-side transaction/recovery test file to start with '// @vitest-environment node' and use the handler-Map capture pattern, referencing project-file-ipc.test.ts as the template.`,
    planQuotes: [
      "implement.md:84-92 Slice 7 steps 1-9: transaction machinery (mutex, locks, rollback bundle, journal states, recovery).",
      "design.md:161 Verification Strategy Electron tests: 'path containment, symlink rejection, mixed backup rewrite, rollback bundle recovery, insufficient disk space, lock ordering, rollback on each injected failure, physical local-media deletion, and no-residue success.'",
    ],
  },
]

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    findingId: { type: 'string' },
    isReal: { type: 'boolean', description: 'true if the finding identifies a genuine defect that must be fixed before task.py start; false if the plan already handles it or the defect is speculative/overstated' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    reasoning: { type: 'string', description: 'Why isReal. If refuting, cite the exact plan safeguard that already handles it. If confirming, cite the exact plan text that fails.' },
    severityAssessment: { type: 'string', description: 'Agree or adjust the proposed severity, with justification' },
    recommendedFix: { type: 'string', description: 'Concrete minimal edit (which file, which line/section, what text). Empty if isReal=false and no edit needed.' },
    refutationAttempted: { type: 'string', description: 'The strongest argument you tried for the OPPOSITE conclusion, and why it did or did not hold.' },
  },
  required: ['findingId', 'isReal', 'confidence', 'reasoning', 'severityAssessment', 'recommendedFix', 'refutationAttempted'],
}

const COMMON_RULES = `你是 Trellis 任务 .trellis/tasks/08-04-artifact-output-management 的对抗验证 skeptic。任务目录: ${TASK_DIR}

任务背景:把 media 面板升级为产物管理中心 + 安全永久删除。当前在 PLANNING 阶段,规划文档(prd.md/design.md/implement.md)已写好但未经 task.py start。

铁律(必须遵守):
- 只读。禁止编辑任何文件、禁止 git、禁止 worktree、禁止破坏性操作。
- 用 Read 工具读规划文档核实 plan 原文。文件路径:
  - ${TASK_DIR}/prd.md
  - ${TASK_DIR}/design.md
  - ${TASK_DIR}/implement.md
  - ${TASK_DIR}/research/artifact-dependency-inventory.md
  - ${TASK_DIR}/research/plan-verification-2026-08-04.md (ground truth code coords)
  - ${TASK_DIR}/research/plan-adversarial-review.md (前一轮审查,含同 id finding 的 review 原文)
- 必要时可读 apps/frontend 源码核实代码事实(只读)。

你的职责:对给定 finding 尝试**反驳**(证明它不是真缺陷)。默认怀疑 finding 为真——只有当你找到 plan 已存在的明确防护、或 finding 的失败场景是臆测/被代码事实否定时,才判 isReal=false。
- 不要因为「严重度低」就判 false。低严重度的真缺陷仍是 isReal=true。
- 不要因为「实现时自然会处理」就判 false——planning gate 关心的是 plan 文档是否已明确覆盖。
- 证据不足时,带不确定性回答(isReal=true 但 confidence=low),不要把话说满。`

phase('Reverify')

// 每条 finding 派 2 个独立 skeptic(不同视角),共 14 agent,单批全发
const tasks = []
for (const f of FINDINGS) {
  for (let k = 1; k <= 2; k++) {
    const lens = k === 1
      ? '视角A(规划完备性):这个 finding 是否暴露了 plan 文档的真空缺——即一个严格按 slice 顺序执行的 worker 会卡住或产出错误结果?重点查 implement.md 的 slice 顺序、completion gate、step 是否自洽。'
      : '视角B(失败场景真实性):finding 描述的失败场景是否真的会发生?还是 plan 已有防护(交叉引用 design.md 的 Transaction Protocol/Verification Strategy/Risks,以及 plan-verification-2026-08-04.md 的代码事实)?'
    const prompt = `${COMMON_RULES}

=== 待验证 finding ===
ID: ${f.id}
声称严重度: ${f.severity}
标题: ${f.title}

finding 的主张:
${f.claim}

plan 原文锚点(请用 Read 核实这些引用是否准确):
${f.planQuotes.join('\n')}

=== 你的任务 ===
${lens}

1. 用 Read 核实上述 plan 原文引用是否准确(行号、措辞)。
2. 尝试反驳:这个 finding 描述的缺陷是否已由 plan 其它部分覆盖?失败场景是否臆测?
3. 给出 verdict:isReal(是否必须在 task.py start 前修)+ confidence + 严重度评估 + 最小修法(若 isReal)。
4. refutationAttempted:写出你为「相反结论」做的最强论证,以及它为何成立/不成立。

按 schema 输出。`
    tasks.push(() => agent(prompt, {
      label: `reverify:${f.id}#${k}`,
      phase: 'Reverify',
      schema: VERDICT_SCHEMA,
    }))
  }
}

const results = (await parallel(tasks)).filter(Boolean)

// 按 finding 聚合:2 个 skeptic 都判 real 才算 confirmed;否则降级
const byFinding = {}
for (const r of results) {
  if (!byFinding[r.findingId]) byFinding[r.findingId] = []
  byFinding[r.findingId].push(r)
}

const summary = []
for (const f of FINDINGS) {
  const votes = byFinding[f.id] || []
  const reals = votes.filter(v => v.isReal).length
  const verdict = reals === 2 ? 'CONFIRMED'
    : reals === 0 ? 'REFUTED'
    : 'SPLIT'
  summary.push({
    id: f.id,
    severity: f.severity,
    title: f.title,
    verdict,
    realVotes: reals,
    totalVotes: votes.length,
    votes: votes.map(v => ({
      isReal: v.isReal,
      confidence: v.confidence,
      severity: v.severityAssessment,
      reasoning: v.reasoning,
      fix: v.recommendedFix,
      refutation: v.refutationAttempted,
    })),
  })
}

log(`Reverify 完成: ${summary.filter(s => s.verdict === 'CONFIRMED').length} CONFIRMED, ${summary.filter(s => s.verdict === 'REFUTED').length} REFUTED, ${summary.filter(s => s.verdict === 'SPLIT').length} SPLIT`)

return { summary }
