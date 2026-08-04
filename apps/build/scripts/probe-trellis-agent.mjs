export const meta = {
  name: 'probe-trellis-implement-schema',
  description: '最小探针:验证 trellis-implement agentType + schema 在 Workflow 里能组合工作(铁律0:不假设能力存在)',
  phases: [{ title: 'Probe', detail: '1 agent 测 agentType+schema 组合' }],
}

const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    agentTypeWorks: { type: 'boolean', description: 'true 若你是 trellis-implement agent 且能按 schema 输出' },
    canReadAndReport: { type: 'boolean', description: 'true 若你能 Read 文件并报告精确符号' },
    symbolFound: { type: 'string', description: 'Read apps/frontend/electron/storage/storage-paths.ts:101 附近,报告 resolveProjectScopedFilePath 的精确签名' },
    sawRecursionGuard: { type: 'boolean', description: 'true 若你的系统提示含 trellis-implement recursion guard(说明 agentType 生效)' },
  },
  required: ['agentTypeWorks', 'canReadAndReport', 'symbolFound', 'sawRecursionGuard'],
}

const r = await agent(
  `Read apps/frontend/electron/storage/storage-paths.ts 第 95-115 行,报告 resolveProjectScopedFilePath 的精确函数签名(参数名+类型+返回)。这是只读探针,不要改任何文件。按 schema 输出。`,
  { label: 'probe:trellis-implement', phase: 'Probe', agentType: 'trellis-implement', schema: PROBE_SCHEMA },
)

return { probe: r, comboWorks: !!(r && r.agentTypeWorks && r.canReadAndReport && r.sawRecursionGuard) }
