import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SECRET = 'sk-test-only-never-persist'

function redact(value) {
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (/key|token|cookie|secret|credential|authorization/i.test(key)) return [key, '[REDACTED]']
      return [key, redact(child)]
    }))
  }
  return value
}

function assertNoSecret(value) {
  assert.equal(JSON.stringify(value).includes(SECRET), false, 'mock evidence leaked the credential')
}

class MockSelfMediaAdapter {
  constructor({ compatible = true, failAccountId } = {}) {
    this.compatible = compatible
    this.failAccountId = failAccountId
    this.pollCounts = new Map()
    this.calls = []
  }

  listAccounts() {
    this.calls.push('listAccounts')
    if (!this.compatible) return { success: false, error: { code: 'provider-incompatible', message: 'contract mismatch' } }
    return {
      success: true,
      accounts: [
        { id: 'acct-video', provider: 'aitoearn-local', platform: 'douyin', status: 'online', displayName: 'Video fixture' },
        { id: 'acct-image', provider: 'aitoearn-local', platform: 'xhs', status: 'online', displayName: 'Image fixture' },
      ],
    }
  }

  publish({ contentType, accountIds, scheduledAt }) {
    this.calls.push(`publish:${contentType}`)
    if (!this.compatible) return { success: false, error: { code: 'provider-incompatible', message: 'contract mismatch' } }
    return {
      success: true,
      tasks: accountIds.map((accountId) => ({
        id: `task-${contentType}-${accountId}`,
        accountId,
        contentType,
        status: scheduledAt ? 'scheduled' : this.failAccountId === accountId ? 'failure' : 'success',
        scheduledAt: scheduledAt ?? null,
        error: this.failAccountId === accountId ? { code: 'mock-account-failure', message: 'fixture failure' } : null,
      })),
    }
  }

  poll(task) {
    this.calls.push(`poll:${task.id}`)
    const count = this.pollCounts.get(task.id) ?? 0
    this.pollCounts.set(task.id, count + 1)
    if (!this.compatible) return { success: false, error: { code: 'provider-incompatible', message: 'contract mismatch' } }
    return { success: true, task: { ...task, status: count === 0 ? 'running' : 'success', progress: count === 0 ? 50 : 100 } }
  }
}

function executeCase(run) {
  try {
    const evidence = run()
    assertNoSecret(evidence)
    return { ok: true, evidence }
  } catch (error) {
    return { ok: false, evidence: { error: error instanceof Error ? error.message : String(error) } }
  }
}

export function runUpgradeSmoke() {
  const adapter = new MockSelfMediaAdapter()
  const accounts = adapter.listAccounts()
  const cases = {
    accounts: executeCase(() => {
      assert.equal(accounts.success, true)
      assert.equal(accounts.accounts.length, 2)
      assert.equal('token' in accounts.accounts[0], false)
      return { adapterCall: 'listAccounts', accountCount: accounts.accounts.length, statuses: accounts.accounts.map((account) => account.status) }
    }),
    video: executeCase(() => {
      const result = adapter.publish({ contentType: 'video', accountIds: ['acct-video'] })
      assert.equal(result.success, true)
      assert.equal(result.tasks[0].status, 'success')
      return { adapterCall: 'publish', contentType: 'video', taskStatus: result.tasks[0].status }
    }),
    'image-text': executeCase(() => {
      const result = adapter.publish({ contentType: 'image-text', accountIds: ['acct-image'] })
      assert.equal(result.success, true)
      assert.equal(result.tasks[0].status, 'success')
      return { adapterCall: 'publish', contentType: 'image-text', taskStatus: result.tasks[0].status }
    }),
    'schedule-poll': executeCase(() => {
      const scheduled = adapter.publish({ contentType: 'video', accountIds: ['acct-video'], scheduledAt: '2030-01-01T00:00:00.000Z' })
      assert.equal(scheduled.success, true)
      assert.equal(scheduled.tasks[0].status, 'scheduled')
      const running = adapter.poll(scheduled.tasks[0])
      const completed = adapter.poll(running.task)
      assert.equal(running.task.status, 'running')
      assert.equal(completed.task.status, 'success')
      return { scheduledStatus: scheduled.tasks[0].status, pollStatuses: [running.task.status, completed.task.status], progress: completed.task.progress }
    }),
    'partial-failure': executeCase(() => {
      const partialAdapter = new MockSelfMediaAdapter({ failAccountId: 'acct-image' })
      const result = partialAdapter.publish({ contentType: 'video', accountIds: ['acct-video', 'acct-image'] })
      assert.equal(result.success, true)
      const statuses = result.tasks.map((task) => task.status)
      assert.deepEqual(statuses, ['success', 'failure'])
      return { taskStatuses: statuses, normalizedStatus: 'partial' }
    }),
    'credential-redaction': executeCase(() => {
      const rawDiagnostic = { provider: 'aitoearn-local', skKey: SECRET, account: { cookie: SECRET }, result: accounts }
      const sanitized = redact(rawDiagnostic)
      assertNoSecret(sanitized)
      assert.equal(sanitized.skKey, '[REDACTED]')
      assert.equal(sanitized.account.cookie, '[REDACTED]')
      return { persisted: { skKey: false, cookie: false }, diagnostic: sanitized }
    }),
    'provider-incompatibility': executeCase(() => {
      const incompatible = new MockSelfMediaAdapter({ compatible: false })
      const result = incompatible.listAccounts()
      assert.equal(result.success, false)
      assert.equal(result.error.code, 'provider-incompatible')
      assert.deepEqual(incompatible.calls, ['listAccounts'])
      return { errorCode: result.error.code, fallback: false, adapterCalls: incompatible.calls }
    }),
  }
  const failedCases = Object.entries(cases).filter(([, result]) => !result.ok).map(([name]) => name)
  return {
    mode: 'mocked-adapter-no-publish',
    execution: {
      adapter: 'MockSelfMediaAdapter',
      calls: adapter.calls,
      mockPublishOperations: adapter.calls.filter((call) => call.startsWith('publish:')),
      networkRequests: 0,
      externalPublishAttempts: 0,
    },
    publishAttempted: false,
    network: false,
    cases,
    redaction: { secretsPersisted: false, logsRedacted: cases['credential-redaction'].ok },
    incompatibility: { failClosed: cases['provider-incompatibility'].ok, fallback: false },
    passed: failedCases.length === 0,
    failedCases,
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const report = runUpgradeSmoke()
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed || report.publishAttempted || report.network || report.execution.externalPublishAttempts !== 0) process.exitCode = 1
}
