// 1105 桥令牌陈旧 403 根治役:L2 浏览器侧自愈的永久测试。
// 直接驱动引擎侧伺服的 my_nodes/web/bridge-action.js 真源模块(经全局 shim
// 注入 fetch/window),验证 401/403→作废令牌缓存→重取 /my_bridge/config→
// 重试一次的完整链路;含 POST 重放与「重试再败=诚实上抛」两支。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchStub = ReturnType<typeof vi.fn>;

const MODULE_URL = new URL(
  "../../backend/comfyui/my_nodes/web/bridge-action.js",
  import.meta.url,
).href;

interface BridgeActionModule {
  bridgeToken: () => Promise<string>;
  invalidateBridgeToken: () => void;
  bridgeFetch: (url: string, init?: RequestInit) => Promise<{ status: number; ok: boolean }>;
}

async function loadModule(fetchStub: FetchStub, configResponses: Array<Record<string, unknown>>) {
  // /my_bridge/config 依序供答卷;其余 URL 透传给按调用序编排的 fetchStub
  let configIdx = 0;
  const globalFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/my_bridge/config")) {
      const body = JSON.stringify(configResponses[configIdx] ?? {});
      configIdx += 1;
      return Promise.resolve(new Response(body, { status: 200 }));
    }
    return fetchStub(input, init) as Promise<Response>;
  };
  const prevFetch = globalThis.fetch;
  const prevWindow = (globalThis as { window?: unknown }).window;
  globalThis.fetch = globalFetch as typeof fetch;
  (globalThis as { window?: unknown }).window = {};
  vi.resetModules();
  const mod = (await import(MODULE_URL)) as BridgeActionModule;
  return {
    mod,
    restore: () => {
      globalThis.fetch = prevFetch;
      (globalThis as { window?: unknown }).window = prevWindow;
    },
  };
}

describe("my_nodes bridge-action 401/403 令牌自愈(1105 根治 L2)", () => {
  let restore: (() => void) | undefined;

  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("403→作废缓存→重取 config(新令牌)→重试一次成功", async () => {
    const fetchStub: FetchStub = vi.fn()
      .mockResolvedValueOnce(new Response("denied", { status: 403 })) // 陈令牌首发
      .mockResolvedValueOnce(new Response('{"items":[]}', { status: 200 })); // 新令牌重试
    const ctx = await loadModule(fetchStub, [
      { bridgeUrl: "http://x", bridgeToken: "tok-stale" },
      { bridgeUrl: "http://x", bridgeToken: "tok-fresh" },
    ]);
    restore = ctx.restore;
    const { mod } = ctx;

    const response = await mod.bridgeFetch("http://x/comfy/workflows?light=1");
    expect(response.status).toBe(200);
    // 首发陈令牌→重试新令牌,两次业务调用各带对令牌
    const calls = fetchStub.mock.calls as Array<[string, RequestInit?]>;
    const headerOf = (i: number) => new Headers(calls[i]![1]!.headers as HeadersInit);
    expect(headerOf(0).get("X-Manying-Image-Token")).toBe("tok-stale");
    expect(headerOf(1).get("X-Manying-Image-Token")).toBe("tok-fresh");
  });

  it("401 同走自愈;POST 体重放(403=请求被拒未执行,重放安全)", async () => {
    const fetchStub: FetchStub = vi.fn()
      .mockResolvedValueOnce(new Response("denied", { status: 401 }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    const ctx = await loadModule(fetchStub, [
      { bridgeUrl: "http://x", bridgeToken: "tok-a" },
      { bridgeUrl: "http://x", bridgeToken: "tok-b" },
    ]);
    restore = ctx.restore;

    const response = await mod_post(ctx.mod, "http://x/comfy/bridge/actions");
    expect(response.status).toBe(200);
    const calls = fetchStub.mock.calls as Array<[string, RequestInit?]>;
    expect(calls[1]![0]).toContain("/comfy/bridge/actions");
    expect(calls[1]![1]!.method).toBe("POST");
    expect(calls[1]![1]!.body).toBe('{"kind":"k"}');
  });

  it("重试仍 403=诚实上抛响应(不无限自愈)", async () => {
    const fetchStub: FetchStub = vi.fn()
      .mockResolvedValue(new Response("denied", { status: 403 }));
    const ctx = await loadModule(fetchStub, [
      { bridgeUrl: "http://x", bridgeToken: "tok-old" },
      { bridgeUrl: "http://x", bridgeToken: "tok-new" },
    ]);
    restore = ctx.restore;

    const response = await ctx.mod.bridgeFetch("http://x/comfy/workflows?light=1");
    expect(response.status).toBe(403);
    expect(fetchStub).toHaveBeenCalledTimes(2); // 恰一次重试,不循环
  });
});

function mod_post(mod: BridgeActionModule, url: string) {
  return mod.bridgeFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"kind":"k"}',
  });
}
