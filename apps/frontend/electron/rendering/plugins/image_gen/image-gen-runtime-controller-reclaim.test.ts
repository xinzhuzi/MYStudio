// 09-01 实弹根修回归:打包 smoke 隔离实例遗留的 SIGSTOP 冻结 sidecar 占死 17595,
// CONT+TERM 后端口未放行,旧回收「发信号即成功」导致 respawn 再撞 EADDRINUSE、
// 两轮 30s 健康轮询空转。此处 mock lsof/ps + process.kill 语义钉死四级处置。
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    throw new Error("spawn 不在本测试范围");
  }),
  execFile: vi.fn(),
}));

const execFileMock = vi.mocked(execFile);

interface Scenario {
  /** 端口持有人 pid 列表(空=端口空闲) */
  holders: string[];
  /** ps 返回的命令行(决定是否算 image_gen 孤儿) */
  psCommand: string;
  /** 各信号能否真正放行端口 */
  releaseOn: { SIGTERM?: boolean; SIGKILL?: boolean };
}

let scenario: Scenario;
let holding: boolean;

beforeEach(() => {
  scenario = { holders: [], psCommand: "python -m image_gen.main --port 17595", releaseOn: {} };
  holding = false;
  execFileMock.mockImplementation(((cmd: string, _args: string[], cb: (err: Error | null, res?: { stdout: string }) => void) => {
    if (cmd === "lsof") {
      const pids = holding ? scenario.holders : [];
      cb(null, { stdout: pids.join("\n") });
    } else if (cmd === "ps") {
      cb(null, { stdout: scenario.psCommand });
    } else {
      cb(new Error(`unexpected cmd ${cmd}`));
    }
  }) as unknown as typeof execFile);
  vi.spyOn(process, "kill").mockImplementation(((_pid: number, signal: string) => {
    if ((signal === "SIGTERM" && scenario.releaseOn.SIGTERM) || (signal === "SIGKILL" && scenario.releaseOn.SIGKILL)) {
      holding = false;
    }
    return true;
  }) as unknown as typeof process.kill);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function importReclaim() {
  const mod = await import("./image-gen-runtime-controller");
  return mod.reclaimOrphanSidecarPort;
}

describe("reclaimOrphanSidecarPort 回收硬化(端口复验+SIGKILL 升级)", () => {
  it("端口空闲(lsof 无结果)→false 且不发任何信号", async () => {
    const reclaim = await importReclaim();
    await expect(reclaim()).resolves.toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("外来进程占端口(命令行不含 image_gen.main)→false 不误杀", async () => {
    scenario.holders = ["111"];
    scenario.psCommand = "/usr/sbin/httpd -p 17595";
    holding = true;
    const reclaim = await importReclaim();
    await expect(reclaim()).resolves.toBe(false);
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("SIGTERM 即放行→true(常规孤儿路径)", async () => {
    scenario.holders = ["222"];
    holding = true;
    scenario.releaseOn = { SIGTERM: true };
    const reclaim = await importReclaim();
    await expect(reclaim()).resolves.toBe(true);
    const signals = (process.kill as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(signals).toEqual(["SIGCONT", "SIGTERM"]);
  });

  it("TERM 杀不掉的冻结僵尸(09-01 实弹)→升级 SIGKILL 后放行→true", async () => {
    scenario.holders = ["59168"];
    holding = true;
    scenario.releaseOn = { SIGKILL: true };
    const reclaim = await importReclaim();
    await expect(reclaim()).resolves.toBe(true);
    const signals = (process.kill as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(signals).toEqual(["SIGCONT", "SIGTERM", "SIGKILL"]);
  });

  it("SIGKILL 后仍占端口(极端)→false 如实报告未放行", async () => {
    scenario.holders = ["333"];
    holding = true;
    scenario.releaseOn = {};
    const reclaim = await importReclaim();
    await expect(reclaim()).resolves.toBe(false);
    const signals = (process.kill as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
    expect(signals).toEqual(["SIGCONT", "SIGTERM", "SIGKILL"]);
  });
});
