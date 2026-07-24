import { describe, expect, it } from 'vitest';

import { createWorkerRunLifecycle } from './worker-run-lifecycle';

describe('worker run lifecycle', () => {
  it('supersedes the prior active run and preserves a monotonic requested run id', () => {
    const lifecycle = createWorkerRunLifecycle();
    const first = lifecycle.begin(4);
    const second = lifecycle.begin(9);

    expect(first.controller.signal.aborted).toBe(true);
    expect(lifecycle.isCurrent(first)).toBe(false);
    expect(lifecycle.isCurrent(second)).toBe(true);
    expect(second.id).toBe(9);
  });

  it('only cancels the current run when the requested id matches', () => {
    const lifecycle = createWorkerRunLifecycle();
    const active = lifecycle.begin(3);

    lifecycle.cancel(2);
    expect(lifecycle.isCurrent(active)).toBe(true);

    lifecycle.cancel(3);
    expect(active.controller.signal.aborted).toBe(true);
    expect(lifecycle.isCurrent(active)).toBe(false);
  });
});
