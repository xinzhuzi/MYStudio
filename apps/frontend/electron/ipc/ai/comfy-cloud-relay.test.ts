import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock("electron", () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
    removeHandler: vi.fn((channel: string) => {
      handlers.delete(channel);
    }),
  },
}));

import {
  COMFY_CLOUD_RELAY_ENV,
  COMFY_CLOUD_RELAY_ENV_TOKEN,
  COMFY_CLOUD_RELAY_ENV_URL,
  COMFY_CLOUD_RELAY_GENERATE_PATH,
  COMFY_CLOUD_RELAY_REQUEST_EVENT,
  COMFY_CLOUD_RELAY_RESPONSE_CHANNEL,
  COMFY_CLOUD_RELAY_TOKEN,
  COMFY_CLOUD_RELAY_TOKEN_HEADER,
  COMFY_CLOUD_RELAY_URL,
  createComfyCloudRelay,
} from "./comfy-cloud-relay";

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("comfy-cloud-relay 契约常量", () => {
  it("配对引擎侧 settings.py(env 名/默认 URL/端口)防双家漂移", () => {
    const pythonSource = readFileSync(
      new URL("../../../../backend/engines/comfyui/manying_nodes/bridge/settings.py", import.meta.url),
      "utf8",
    );
    expect(COMFY_CLOUD_RELAY_URL).toBe("http://127.0.0.1:17596");
    expect(pythonSource).toContain(`DEFAULT_CLOUD_RELAY_URL = "${COMFY_CLOUD_RELAY_URL}"`);
    expect(pythonSource).toContain(`os.environ.get("${COMFY_CLOUD_RELAY_ENV_URL}"`);
    expect(pythonSource).toContain(`os.environ.get("${COMFY_CLOUD_RELAY_ENV_TOKEN}"`);
    // 引擎节点请求头与令牌同源(节点侧测试对拍)
    expect(COMFY_CLOUD_RELAY_TOKEN_HEADER).toBe("x-manying-cloud-token");
  });

  it("配对 preload 门面硬编码通道名(preload 轻打包不引本模块,靠源文本对拍)", () => {
    const preloadSource = readFileSync(
      new URL("../../preload/preload-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(preloadSource).toContain(`ipcRenderer.on('${COMFY_CLOUD_RELAY_REQUEST_EVENT}'`);
    expect(preloadSource).toContain(`ipcRenderer.removeListener('${COMFY_CLOUD_RELAY_REQUEST_EVENT}'`);
    expect(preloadSource).toContain(`ipcRenderer.invoke('${COMFY_CLOUD_RELAY_RESPONSE_CHANNEL}'`);
  });

  it("侧车 env 注入面 URL+TOKEN 成对", () => {
    expect(COMFY_CLOUD_RELAY_ENV).toEqual({
      [COMFY_CLOUD_RELAY_ENV_URL]: COMFY_CLOUD_RELAY_URL,
      [COMFY_CLOUD_RELAY_ENV_TOKEN]: COMFY_CLOUD_RELAY_TOKEN,
    });
  });
});

describe("createComfyCloudRelay", () => {
  let relay: ReturnType<typeof createComfyCloudRelay> | null = null;

  afterEach(async () => {
    await relay?.stop();
    relay = null;
  });

  function startRelay(getWindow: () => unknown) {
    relay = createComfyCloudRelay({ getWindow: getWindow as never, port: 0 });
    return relay.start().then(() => {
      const port = relay!.getPort();
      expect(port).toBeTruthy();
      return `http://127.0.0.1:${port}`;
    });
  }

  it("错误令牌 401 / 未知路径 404 / 窗口不在场 503", async () => {
    const base = await startRelay(() => ({ webContents: { send: vi.fn() } }));

    const wrongToken = await post(base + COMFY_CLOUD_RELAY_GENERATE_PATH, { prompt: "x" }, {
      [COMFY_CLOUD_RELAY_TOKEN_HEADER]: "wrong",
    });
    expect(wrongToken.status).toBe(401);

    const notFound = await post(base + "/v1/other", { prompt: "x" }, {
      [COMFY_CLOUD_RELAY_TOKEN_HEADER]: COMFY_CLOUD_RELAY_TOKEN,
    });
    expect(notFound.status).toBe(404);

    const noWindow = await startRelay(() => null);
    const noWin = await post(noWindow + COMFY_CLOUD_RELAY_GENERATE_PATH, { prompt: "x" }, {
      [COMFY_CLOUD_RELAY_TOKEN_HEADER]: COMFY_CLOUD_RELAY_TOKEN,
    });
    expect(noWin.status).toBe(503);
    expect((await noWin.json()).error).toContain("漫影应用未连接");
  });

  it("缺 prompt 400;合法请求转发渲染层并回传 imageB64", async () => {
    const sent: Array<{ id: string; payload: Record<string, unknown> }> = [];
    const base = await startRelay(() => ({
      webContents: {
        send: (_channel: string, request: { id: string; payload: Record<string, unknown> }) => {
          sent.push(request);
          // 模拟渲染层完成生图:经 invoke 通道回 settle
          const respond = handlers.get(COMFY_CLOUD_RELAY_RESPONSE_CHANNEL)!;
          void Promise.resolve(
            respond(null, { id: request.id, ok: true, imageB64: "QUJD", mediaId: "m1" }),
          );
        },
      },
    }));

    const bad = await post(base + COMFY_CLOUD_RELAY_GENERATE_PATH, { negativePrompt: "y" }, {
      [COMFY_CLOUD_RELAY_TOKEN_HEADER]: COMFY_CLOUD_RELAY_TOKEN,
    });
    expect(bad.status).toBe(400);

    const ok = await post(base + COMFY_CLOUD_RELAY_GENERATE_PATH, {
      prompt: "一只猫",
      negativePrompt: "模糊",
      aspectRatio: "16:9",
      referenceB64s: ["QUJD", 42],
    }, { [COMFY_CLOUD_RELAY_TOKEN_HEADER]: COMFY_CLOUD_RELAY_TOKEN });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, imageB64: "QUJD", mediaId: "m1" });
    // 渲染层收到的载荷=引擎节点语义(prompt 直传+非串参考项被滤掉)
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({
      prompt: "一只猫", negativePrompt: "模糊", aspectRatio: "16:9", referenceB64s: ["QUJD"],
    });
  });

  it("渲染层报错时传输 200 + ok:false(引擎侧据此抛大白话)", async () => {
    const base = await startRelay(() => ({
      webContents: {
        send: (_channel: string, request: { id: string }) => {
          const respond = handlers.get(COMFY_CLOUD_RELAY_RESPONSE_CHANNEL)!;
          void Promise.resolve(respond(null, { id: request.id, ok: false, error: "图片生成未配置：请在设置中配置服务" }));
        },
      },
    }));
    const res = await post(base + COMFY_CLOUD_RELAY_GENERATE_PATH, { prompt: "x" }, {
      [COMFY_CLOUD_RELAY_TOKEN_HEADER]: COMFY_CLOUD_RELAY_TOKEN,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: "图片生成未配置：请在设置中配置服务" });
  });

  it("stop 后不再监听且应答通道注销", async () => {
    const base = await startRelay(() => ({ webContents: { send: vi.fn() } }));
    const current = relay!;
    await current.stop();
    expect(current.isListening()).toBe(false);
    expect(handlers.has(COMFY_CLOUD_RELAY_RESPONSE_CHANNEL)).toBe(false);
    await expect(post(base + COMFY_CLOUD_RELAY_GENERATE_PATH, { prompt: "x" })).rejects.toThrow();
  });
});
