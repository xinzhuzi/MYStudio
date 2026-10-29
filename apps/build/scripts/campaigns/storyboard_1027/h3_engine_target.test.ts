/**
 * h3_engine_target 纯函数门测(10-29 收账:App 外 campaign 直投不得盲打本地引擎)。
 *
 * 铁律:本文件只 import ./h3_engine_target——不得 import 驱动本体
 * h3_matrix_driver.ts!其顶层 main() 是真投链(读 MA store+上传/提交引擎),
 * 失败路径 process.exit(1) 会杀 vitest 进程(驱动现已加 VITEST 守卫,但本
 * 测试零理由触碰它)。fetch/fs 全 mock:零网络零磁盘。
 *
 * 七分支(评审钉死语义):H3_ENGINE 显式→env 胜出且零网络调用;连接拒绝/
 * 超时→缺省 17001(向后兼容);200+source='settings'→报错退出(文案含远端
 * url 与「需本地请显式 H3_ENGINE」);200+其他 source→17001;403(令牌在)
 * →报错退出;空令牌+连接拒绝→17001;空令牌+403→报错退出(文案归因令牌
 * 读取失败)。令牌决议为空串仍照发 GET(空 Authorization 头),由网络结果
 * 定分支——禁止『令牌空即提前报错』误杀 App 未装机机器。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { readFileSyncMock } = vi.hoisted(() => ({ readFileSyncMock: vi.fn() }));

vi.mock("node:fs", () => ({ default: { readFileSync: readFileSyncMock } }));

import {
  DEFAULT_LOCAL_ENGINE,
  SIDECAR_ENGINE_REMOTE_URL,
  driverUserDataRoot,
  resolveControlToken,
  resolveEngineTarget,
  type PrecheckFetch,
  type PrecheckResponse,
} from "./h3_engine_target";

function jsonResponse(status: number, body: unknown): PrecheckResponse {
  return { status, json: () => Promise.resolve(body) };
}

function okStatusFetch(body: unknown): PrecheckFetch {
  return async () => jsonResponse(200, body);
}

beforeEach(() => {
  readFileSyncMock.mockReset();
});

describe("resolveEngineTarget 预检七分支", () => {
  it("H3_ENGINE 显式→env 胜出且零网络调用", async () => {
    const fetchSpy = vi.fn();
    const target = await resolveEngineTarget({ H3_ENGINE: "http://192.168.0.101:17001" }, fetchSpy as PrecheckFetch, () => "tok");
    expect(target).toMatchObject({ kind: "engine", engine: "http://192.168.0.101:17001" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("连接拒绝/超时→缺省 17001(存量独立跑零变化)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const target = await resolveEngineTarget({}, fetchSpy as unknown as PrecheckFetch, () => "tok");
    expect(target).toMatchObject({ kind: "engine", engine: DEFAULT_LOCAL_ENGINE });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(SIDECAR_ENGINE_REMOTE_URL);
  });

  it("200+source='settings'→报错退出(文案含远端 url 与「需本地请显式 H3_ENGINE」)", async () => {
    const target = await resolveEngineTarget(
      {},
      okStatusFetch({ url: "http://192.168.0.101:17000", effective: "http://192.168.0.101:17000", source: "settings" }),
      () => "tok",
    );
    expect(target.kind).toBe("abort");
    if (target.kind === "abort") {
      expect(target.message).toContain("路由已指向 http://192.168.0.101:17000");
      expect(target.message).toContain("需本地请显式 H3_ENGINE");
    }
  });

  it.each(["env", "managed", "fallback"])("200+source='%s'(其他 source)→缺省 17001", async (source) => {
    const target = await resolveEngineTarget(
      {},
      okStatusFetch({ url: null, effective: "http://127.0.0.1:17598", source }),
      () => "tok",
    );
    expect(target).toMatchObject({ kind: "engine", engine: DEFAULT_LOCAL_ENGINE });
  });

  it("403(令牌在)→报错退出", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(403, { error: "invalid_local_token" }));
    const target = await resolveEngineTarget({}, fetchSpy as unknown as PrecheckFetch, () => "real-token");
    expect(target.kind).toBe("abort");
    if (target.kind === "abort") expect(target.message).toContain("403");
    // 令牌在=带 Bearer 头照发预检
    expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe("Bearer real-token");
  });

  it("空令牌+连接拒绝→缺省 17001(禁止『令牌空即提前报错』误杀 App 未装机机器)", async () => {
    const fetchSpy = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const target = await resolveEngineTarget({}, fetchSpy as unknown as PrecheckFetch, () => "");
    expect(target).toMatchObject({ kind: "engine", engine: DEFAULT_LOCAL_ENGINE });
    // 空令牌仍照发 GET,且 Authorization 为空头
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]![0]).toBe(SIDECAR_ENGINE_REMOTE_URL);
    expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe("");
  });

  it("空令牌+403→报错退出(文案归因令牌读取失败)", async () => {
    const fetchSpy = vi.fn(async () => jsonResponse(403, { error: "invalid_local_token" }));
    const target = await resolveEngineTarget({}, fetchSpy as unknown as PrecheckFetch, () => "");
    expect(target.kind).toBe("abort");
    if (target.kind === "abort") {
      expect(target.message).toContain("令牌读取失败");
      expect(target.message).toContain("403");
    }
    expect(fetchSpy.mock.calls[0]![1].headers.Authorization).toBe("");
  });
});

describe("resolveControlToken 令牌决议(bridge_contract.resolve_bridge_token 同款顺序)", () => {
  it("env MANYING_LOCAL_IMAGE_TOKEN 优先,config.json 不被读", () => {
    const token = resolveControlToken({ MANYING_LOCAL_IMAGE_TOKEN: "env-tok" });
    expect(token).toBe("env-tok");
    expect(readFileSyncMock).not.toHaveBeenCalled();
  });

  it("env 缺→{userDataRoot}/python/profiles/image-gen/config.json 的 controlToken", () => {
    readFileSyncMock.mockReturnValueOnce(JSON.stringify({ controlToken: "disk-tok" }));
    const token = resolveControlToken({ MYSTUDIO_USER_DATA: "/tmp/ud-root" });
    expect(token).toBe("disk-tok");
    expect(readFileSyncMock).toHaveBeenCalledWith("/tmp/ud-root/python/profiles/image-gen/config.json", "utf8");
  });

  it("双缺=空串(fail-closed;缺文件/坏 JSON/非字符串 controlToken 同判)", () => {
    readFileSyncMock.mockImplementationOnce(() => {
      throw new Error("ENOENT");
    });
    expect(resolveControlToken({ MYSTUDIO_USER_DATA: "/tmp/ud-root" })).toBe("");
    readFileSyncMock.mockReturnValueOnce("not json{");
    expect(resolveControlToken({ MYSTUDIO_USER_DATA: "/tmp/ud-root" })).toBe("");
    readFileSyncMock.mockReturnValueOnce(JSON.stringify({ controlToken: 12345 }));
    expect(resolveControlToken({ MYSTUDIO_USER_DATA: "/tmp/ud-root" })).toBe("");
  });

  it("driverUserDataRoot:MYSTUDIO_USER_DATA 覆写优先,缺省=~/Library/Application Support/漫影工作室", async () => {
    expect(driverUserDataRoot({ MYSTUDIO_USER_DATA: "/tmp/ud-2" })).toBe("/tmp/ud-2");
    const os = await import("node:os");
    const path = await import("node:path");
    expect(driverUserDataRoot({})).toBe(path.join(os.homedir(), "Library", "Application Support", "漫影工作室"));
  });
});
