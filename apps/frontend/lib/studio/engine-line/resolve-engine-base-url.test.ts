// @vitest-environment jsdom
// 生效引擎 BaseURL 统一出口契约测(1102 remote-engine-takeover S1):
// 四路=远端配置/无配置本机/sidecar 未跑本机/port null 空串;附远端 sidecar
// base 提取与引擎地址变更通知面。

import { afterEach, describe, expect, it, vi } from "vitest";

const getRemoteEngineMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/assist/image-studio/comfy-sidecar-bridge", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getRemoteEngine: getRemoteEngineMock };
});

import {
  REMOTE_SIDECAR_PORT,
  getRemoteEngineVersion,
  notifyRemoteEngineChanged,
  resetRemoteEngineVersionForTests,
  resolveEngineBase,
  resolveEngineBaseUrl,
  resolveRemoteSidecarBaseUrl,
  subscribeRemoteEngineChanged,
} from "./resolve-engine-base-url";

/** 侧车默认=未跑(getRemoteEngine 抛错)→ 本机回落,测试隔离起步态。 */
function sidecarDown() {
  getRemoteEngineMock.mockImplementation(async () => {
    throw new Error("本地生图服务未运行:请在 设置→本地配置 点击『按优先级准备基础运行时』");
  });
}

afterEach(() => {
  vi.clearAllMocks();
  resetRemoteEngineVersionForTests();
});

describe("resolveEngineBaseUrl(生效引擎 base 四路契约)", () => {
  it("远端配置(source=settings 且有 url)→ 远端 url,本机 port 不参与", async () => {
    getRemoteEngineMock.mockResolvedValue({
      url: "http://192.168.0.101:17000",
      effective: "http://192.168.0.101:17000",
      source: "settings",
    });
    await expect(resolveEngineBaseUrl(17001)).resolves.toBe("http://192.168.0.101:17000");
    await expect(resolveEngineBaseUrl(null)).resolves.toBe("http://192.168.0.101:17000");
  });

  it("无远端配置(source≠settings 或 url=null)→ 本机 127.0.0.1:port", async () => {
    getRemoteEngineMock.mockResolvedValue({ url: null, effective: "http://127.0.0.1:17001", source: "managed" });
    await expect(resolveEngineBaseUrl(17001)).resolves.toBe("http://127.0.0.1:17001");
    // source=settings 但 url 空(=设置页清空回本机)同样回落
    getRemoteEngineMock.mockResolvedValue({ url: null, effective: "http://127.0.0.1:17002", source: "settings" });
    await expect(resolveEngineBaseUrl(17002)).resolves.toBe("http://127.0.0.1:17002");
  });

  it("sidecar 未跑(getRemoteEngine 抛错)→ 本机 127.0.0.1:port", async () => {
    sidecarDown();
    await expect(resolveEngineBaseUrl(17003)).resolves.toBe("http://127.0.0.1:17003");
  });

  it("两侧皆无(无远端+port null/非法)→ 空串(调用方自判态)", async () => {
    getRemoteEngineMock.mockResolvedValue({ url: null, effective: "", source: "fallback" });
    await expect(resolveEngineBaseUrl(null)).resolves.toBe("");
    await expect(resolveEngineBaseUrl(Number.NaN)).resolves.toBe("");
    await expect(resolveEngineBaseUrl(0)).resolves.toBe("");
    sidecarDown();
    await expect(resolveEngineBaseUrl(null)).resolves.toBe("");
  });

  it("resolveEngineBase 详情:远端生效带 remoteActive=true;本机/false", async () => {
    getRemoteEngineMock.mockResolvedValue({
      url: "http://192.168.0.101:17000",
      effective: "http://192.168.0.101:17000",
      source: "settings",
    });
    await expect(resolveEngineBase(17001)).resolves.toEqual({
      base: "http://192.168.0.101:17000",
      remoteActive: true,
    });
    getRemoteEngineMock.mockResolvedValue({ url: null, effective: "http://127.0.0.1:17001", source: "managed" });
    await expect(resolveEngineBase(17001)).resolves.toEqual({
      base: "http://127.0.0.1:17001",
      remoteActive: false,
    });
    sidecarDown();
    await expect(resolveEngineBase(null)).resolves.toEqual({ base: "", remoteActive: false });
  });
});

describe("resolveRemoteSidecarBaseUrl(远端 sidecar base 提取,C4:17595 固定口)", () => {
  it("从远端引擎 URL 提取主机名+17595(引擎自身端口被剥)", () => {
    expect(resolveRemoteSidecarBaseUrl("http://192.168.0.101:17000")).toBe(
      `http://192.168.0.101:${REMOTE_SIDECAR_PORT}`,
    );
    expect(resolveRemoteSidecarBaseUrl("http://win-host:8188/")).toBe(`http://win-host:${REMOTE_SIDECAR_PORT}`);
    expect(REMOTE_SIDECAR_PORT).toBe(17595);
  });

  it("非 URL 形态兜底:剥协议前缀/路径尾/端口;空入=空串", () => {
    expect(resolveRemoteSidecarBaseUrl("192.168.0.101:17000")).toBe(`http://192.168.0.101:${REMOTE_SIDECAR_PORT}`);
    expect(resolveRemoteSidecarBaseUrl("win-host/")).toBe(`http://win-host:${REMOTE_SIDECAR_PORT}`);
    expect(resolveRemoteSidecarBaseUrl("  ")).toBe("");
  });
});

describe("引擎地址变更通知面(R1 补订阅)", () => {
  it("notify → 版本号递增+监听者收到;退订后不再收", () => {
    expect(getRemoteEngineVersion()).toBe(0);
    const calls: number[] = [];
    const unsubscribe = subscribeRemoteEngineChanged(() => calls.push(getRemoteEngineVersion()));
    notifyRemoteEngineChanged();
    expect(getRemoteEngineVersion()).toBe(1);
    expect(calls).toEqual([1]);
    unsubscribe();
    notifyRemoteEngineChanged();
    expect(getRemoteEngineVersion()).toBe(2);
    expect(calls).toEqual([1]);
  });

  it("单个监听者抛错不拦其余广播", () => {
    const second = vi.fn();
    subscribeRemoteEngineChanged(() => {
      throw new Error("listener boom");
    });
    subscribeRemoteEngineChanged(second);
    expect(() => notifyRemoteEngineChanged()).not.toThrow();
    expect(second).toHaveBeenCalled();
  });
});
