import { describe, expect, it } from "vitest";
import { ProjectDeletionMutex, withProjectDeletionLock } from "./project-mutex";

describe("ProjectDeletionMutex", () => {
  it("serializes same-project waiters in FIFO order", async () => {
    const mutex = new ProjectDeletionMutex();
    const firstRelease = await mutex.acquire("data-root:project");
    const order: string[] = [];
    const second = mutex.acquire("data-root:project").then(async (release) => {
      order.push("second");
      await release();
    });
    const third = mutex.acquire("data-root:project").then(async (release) => {
      order.push("third");
      await release();
    });

    await Promise.resolve();
    expect(order).toEqual([]);
    await firstRelease();
    await Promise.all([second, third]);
    expect(order).toEqual(["second", "third"]);
  });

  it("makes release idempotent", async () => {
    const mutex = new ProjectDeletionMutex();
    const release = await mutex.acquire("project");
    await release();
    await release();
    const nextRelease = await mutex.acquire("project");
    await nextRelease();
  });

  it("shares the project lock with the helper used by services", async () => {
    const events: string[] = [];
    let unblockFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { unblockFirst = resolve; });

    const first = withProjectDeletionLock("data-root:project", async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
    });
    await Promise.resolve();
    const second = withProjectDeletionLock("data-root:project", async () => {
      events.push("second");
    });

    await Promise.resolve();
    expect(events).toEqual(["first-start"]);
    unblockFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });
});
