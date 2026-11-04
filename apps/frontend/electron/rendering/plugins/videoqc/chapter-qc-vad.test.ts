import { describe, expect, it } from "vitest";

import {
  parseVadWorkerJson,
  resolveVadPythonExecutable,
  runChapterQcVad,
  VAD_CONF_THRESHOLD,
  type VadCommandRunner,
} from "./chapter-qc-vad";
import { resolveVideoQcRuntimePaths } from "./video-qc-runtime";

const OK_PAYLOAD = JSON.stringify({
  schemaVersion: 1,
  status: "ok",
  durationS: 197.12,
  model: "silero-vad@6.2.3",
  speechSeconds: 143.0,
  segments: [
    { startS: 10.722, endS: 17.982 },
    { startS: 0.098, endS: 6.11 },
    { startS: 19.042, endS: 24.83 },
    { startS: 5, endS: 5 }, // 零长段:非法
    { startS: 7, endS: 6 }, // 倒挂:非法
  ],
});

function recordingRunner(stdout: string, stderr = ""): { runner: VadCommandRunner; calls: Array<{ file: string; args: string[]; cwd: string; pythonPath: string }> } {
  const calls: Array<{ file: string; args: string[]; cwd: string; pythonPath: string }> = [];
  return {
    calls,
    runner: async (file, args, options) => {
      calls.push({ file, args, cwd: options.cwd, pythonPath: options.env.PYTHONPATH ?? "" });
      return { stdout, stderr };
    },
  };
}

const baseInput = {
  videoPath: "/tmp/finalfix_output.mp4",
  pythonExecutable: "/storage/python/bin/python3",
  backendRoot: "/app/apps/backend",
};

describe("resolveVadPythonExecutable(与 video_qc 同一支托管 Python,不建 venv)", () => {
  it("posix 走 bin/python3,win32 走 python.exe,且恒等于 video-qc 运行时解释器", () => {
    expect(resolveVadPythonExecutable("/storage", "darwin")).toBe("/storage/python/bin/python3");
    expect(resolveVadPythonExecutable("/storage", "win32")).toBe("/storage/python/python.exe");
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(resolveVadPythonExecutable("/storage", platform)).toBe(
        resolveVideoQcRuntimePaths("/storage", platform).pythonExecutable,
      );
    }
  });

  it("相对 storageBasePath 直接拒(继承 video-qc 的绝对路径守卫,不猜相对落点)", () => {
    expect(() => resolveVadPythonExecutable("storage", "darwin")).toThrow(/绝对路径/);
  });
});

describe("parseVadWorkerJson", () => {
  it("取末条非空行;垃圾返回 null(不许当「没语音问题」)", () => {
    expect(parseVadWorkerJson(`\n${OK_PAYLOAD}\n`)?.status).toBe("ok");
    expect(parseVadWorkerJson("Traceback ...")).toBeNull();
    expect(parseVadWorkerJson("")).toBeNull();
  });
});

describe("runChapterQcVad", () => {
  it("ok 载荷 → available,段按起点升序且剔掉非法段", async () => {
    const { runner } = recordingRunner(OK_PAYLOAD);
    const outcome = await runChapterQcVad({ ...baseInput, runner });
    expect(outcome.available).toBe(true);
    expect(outcome.segments.map((segment) => segment.startS)).toEqual([0.098, 10.722, 19.042]);
    expect(outcome.speechSeconds).toBe(143);
    expect(outcome.model).toBe("silero-vad@6.2.3");
    expect(outcome.durationS).toBeCloseTo(197.12, 2);
  });

  it("按 -m speech_vad.worker 在 backendRoot 起跑,PYTHONPATH 指回 backend", async () => {
    const { runner, calls } = recordingRunner(OK_PAYLOAD);
    await runChapterQcVad({ ...baseInput, runner });
    expect(calls[0]!.file).toBe(baseInput.pythonExecutable);
    expect(calls[0]!.args.slice(0, 2)).toEqual(["-m", "speech_vad.worker"]);
    expect(calls[0]!.args).toContain("--threshold");
    expect(calls[0]!.args[calls[0]!.args.indexOf("--threshold") + 1]).toBe(String(VAD_CONF_THRESHOLD));
    expect(calls[0]!.args).toContain("--json");
    expect(calls[0]!.cwd).toBe(baseInput.backendRoot);
    expect(calls[0]!.pythonPath).toBe(baseInput.backendRoot);
  });

  it("needs-runtime(silero 未装)→ available=false 带码,不当成通过", async () => {
    const { runner } = recordingRunner(
      JSON.stringify({ status: "needs-runtime", code: "module-missing", message: "No module named 'silero_vad'", segments: [] }),
    );
    const outcome = await runChapterQcVad({ ...baseInput, runner });
    expect(outcome.available).toBe(false);
    expect(outcome.segments).toEqual([]);
    expect(outcome.reason).toContain("needs-runtime(module-missing)");
  });

  it("ok 但零段(全片无人声)也算无证据,原因写明", async () => {
    const { runner } = recordingRunner(JSON.stringify({ status: "ok", segments: [], speechSeconds: 0 }));
    const outcome = await runChapterQcVad({ ...baseInput, runner });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("VAD 出段为 0");
  });

  it("python 起不来(ENOENT/超时)→ 异常兜成 available=false", async () => {
    const outcome = await runChapterQcVad({
      ...baseInput,
      runner: async () => {
        throw new Error("spawn ENOENT");
      },
    });
    expect(outcome.available).toBe(false);
    expect(outcome.reason).toContain("VAD 调用异常");
  });
});
