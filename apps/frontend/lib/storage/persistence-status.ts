/** Volatile failure state. Never persisted alongside the user's data. */
export type PersistenceFailure = {
  key: string;
  operation: 'read' | 'write';
  message: string;
  retry?: () => Promise<void>;
};
const listeners = new Set<() => void>();
let failures: readonly PersistenceFailure[] = [];
const tails = new Map<string, Promise<void>>();
const revisions = new Map<string, object>();
export const getPersistenceFailures = () => failures;
export function subscribePersistenceFailures(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function publish(next: readonly PersistenceFailure[]) {
  failures = next;
  for (const listener of listeners) listener();
}
export function clearPersistenceFailure(key: string) {
  if (failures.some((failure) => failure.key === key)) publish(failures.filter((failure) => failure.key !== key));
}
export function reportPersistenceFailure(failure: PersistenceFailure) {
  publish([...failures.filter((item) => item.key !== failure.key), failure]);
}
/** Serialize each logical save; a retry may never overwrite a newer edit. */
export function persistWithStatus(key: string, action: () => Promise<void>): Promise<void> {
  const revision = {};
  revisions.set(key, revision);
  const run = (tails.get(key) ?? Promise.resolve()).then(async () => {
    try {
      await action();
      if (revisions.get(key) === revision) clearPersistenceFailure(key);
    } catch (error) {
      if (revisions.get(key) === revision) {
        reportPersistenceFailure({
          key, operation: 'write', message: error instanceof Error ? error.message : String(error),
          retry: async () => {
            if (revisions.get(key) === revision) await persistWithStatus(key, action);
          },
        });
      }
      throw error;
    }
  });
  const tail = run.then(() => undefined, () => undefined);
  tails.set(key, tail);
  void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
  return run;
}
