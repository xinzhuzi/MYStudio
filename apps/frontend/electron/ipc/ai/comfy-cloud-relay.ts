import http from "node:http";
import crypto from "node:crypto";
import { ipcMain } from "electron";

/**
 * 漫影云中继(09-10 云端收编):ComfyUI 引擎内「漫影 云端生图」节点 →
 * 本地 127.0.0.1:17596(main 常驻) → 渲染层执行既有云链单源
 * (lib/ai/image-generation-engine.generateImage)→ 响应回引擎。
 *
 * 账号/供应商/兜底链/计费全部留在漫影应用内,画布用户零登录零配置——
 * ComfyUI 自带云端 API 节点/登录随 --disable-api-nodes 退役后,云端
 * 产线的唯一入口即本中继。令牌/端口/env 名与引擎侧
 * engines/comfyui/manying_nodes/bridge/settings.py 配对(双侧测试断言)。
 */

export const COMFY_CLOUD_RELAY_PORT = 17596;
export const COMFY_CLOUD_RELAY_TOKEN = "manying-cloud-relay";
export const COMFY_CLOUD_RELAY_URL = `http://127.0.0.1:${COMFY_CLOUD_RELAY_PORT}`;
export const COMFY_CLOUD_RELAY_TOKEN_HEADER = "x-manying-cloud-token";
export const COMFY_CLOUD_RELAY_GENERATE_PATH = "/v1/cloud/images/generations";
/** main → 渲染层(webContents.send)与渲染层 → main(invoke)的通道名。 */
export const COMFY_CLOUD_RELAY_REQUEST_EVENT = "comfy-cloud-relay-request";
export const COMFY_CLOUD_RELAY_RESPONSE_CHANNEL = "comfy-cloud-relay-response";
/** 侧车 spawn env 注入面(引擎随 os.environ 继承,manying 节点只读)。 */
export const COMFY_CLOUD_RELAY_ENV_URL = "MYSTUDIO_CLOUD_RELAY_URL";
export const COMFY_CLOUD_RELAY_ENV_TOKEN = "MYSTUDIO_CLOUD_RELAY_TOKEN";
/** 引擎侧 buildEnv 注入用(URL+TOKEN 成对)。 */
export const COMFY_CLOUD_RELAY_ENV: Record<string, string> = {
  [COMFY_CLOUD_RELAY_ENV_URL]: COMFY_CLOUD_RELAY_URL,
  [COMFY_CLOUD_RELAY_ENV_TOKEN]: COMFY_CLOUD_RELAY_TOKEN,
};

/** 参考图 base64 列表可到 MB 级,64MB 上限防失控(节点侧已 PNG 化)。 */
const MAX_BODY_BYTES = 64 * 1024 * 1024;
/** 云端生图分钟级:渲染层 undici 长任务代理上限 1800s,中继给 6 分钟。 */
const REQUEST_TIMEOUT_MS = 360_000;

export interface ComfyCloudRelayRequestPayload {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  referenceB64s?: string[];
}

export interface ComfyCloudRelayRendererRequest {
  id: string;
  payload: ComfyCloudRelayRequestPayload;
}

export interface ComfyCloudRelayResponsePayload {
  id: string;
  ok: boolean;
  imageB64?: string;
  mediaId?: string;
  error?: string;
}

type GetWindow = () => BrowserWindowLike | null | undefined;
interface BrowserWindowLike {
  webContents: { send(channel: string, ...args: unknown[]): void };
  /** 已销毁窗口 send 会同步抛错(窗口关闭竞态),转发前护栏。 */
  isDestroyed?: () => boolean;
}

interface PendingEntry {
  resolve: (value: ComfyCloudRelayResponsePayload) => void;
  timer: NodeJS.Timeout;
}

export function createComfyCloudRelay({
  getWindow,
  port = COMFY_CLOUD_RELAY_PORT,
}: {
  getWindow: GetWindow;
  /** 仅测试面覆写;生产恒 17596。 */
  port?: number;
}) {
  const pending = new Map<string, PendingEntry>();
  let server: http.Server | null = null;
  let listening = false;

  const sendJson = (res: http.ServerResponse, status: number, body: Record<string, unknown>) => {
    const data = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(data);
  };

  const settle = (response: ComfyCloudRelayResponsePayload) => {
    const entry = pending.get(response.id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    pending.delete(response.id);
    entry.resolve(response);
    return true;
  };

  const readBody = (req: http.IncomingMessage): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("payload-too-large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

  const handleGenerate = async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const token = req.headers[COMFY_CLOUD_RELAY_TOKEN_HEADER];
    if (token !== COMFY_CLOUD_RELAY_TOKEN) {
      sendJson(res, 401, { error: "漫影云中继令牌不匹配" });
      return;
    }
    let payload: ComfyCloudRelayRequestPayload;
    try {
      const raw = JSON.parse((await readBody(req)).toString("utf-8")) as ComfyCloudRelayRequestPayload;
      if (typeof raw.prompt !== "string") throw new Error("prompt");
      payload = {
        prompt: raw.prompt,
        negativePrompt: typeof raw.negativePrompt === "string" ? raw.negativePrompt : "",
        aspectRatio: typeof raw.aspectRatio === "string" ? raw.aspectRatio : "",
        referenceB64s: Array.isArray(raw.referenceB64s)
          ? raw.referenceB64s.filter((item): item is string => typeof item === "string")
          : [],
      };
    } catch {
      sendJson(res, 400, { error: "请求体不合法(需要 JSON 且含 prompt 字段)" });
      return;
    }
    const win = getWindow();
    if (!win || win.isDestroyed?.()) {
      sendJson(res, 503, { error: "漫影应用未连接(窗口不在场);请在前台使用漫影后重试" });
      return;
    }
    const id = crypto.randomUUID();
    const response = await new Promise<ComfyCloudRelayResponsePayload>((resolve) => {
      pending.set(id, {
        resolve,
        timer: setTimeout(() => {
          pending.delete(id);
          resolve({ id, ok: false, error: "漫影云端生图超时(6 分钟无响应)" });
        }, REQUEST_TIMEOUT_MS),
      });
      win.webContents.send(COMFY_CLOUD_RELAY_REQUEST_EVENT, { id, payload } satisfies ComfyCloudRelayRendererRequest);
    });
    // 引擎侧失败语义=ok:false + error 文案;HTTP 层仍 200(传输本身成功)
    sendJson(res, 200, response.ok
      ? { ok: true, imageB64: response.imageB64 ?? "", mediaId: response.mediaId }
      : { ok: false, error: response.error ?? "漫影云端生图失败(未知错误)" });
  };

  const handleResponse = (_event: unknown, response: ComfyCloudRelayResponsePayload) => {
    if (!response || typeof response.id !== "string") return false as const;
    return settle(response);
  };

  const start = async (): Promise<{ listening: boolean; error?: string }> => {
    if (listening) return { listening: true };
    try {
      await new Promise<void>((resolve, reject) => {
        server = http.createServer((req, res) => {
          if (req.method === "POST" && req.url === COMFY_CLOUD_RELAY_GENERATE_PATH) {
            void handleGenerate(req, res).catch(() => sendJson(res, 500, { error: "漫影云中继内部错误" }));
            return;
          }
          sendJson(res, 404, { error: "not found" });
        });
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => resolve());
      });
    } catch (error) {
      server = null;
      throw error;
    }
    ipcMain.handle(COMFY_CLOUD_RELAY_RESPONSE_CHANNEL, handleResponse);
    listening = true;
    return { listening: true };
  };

  const stop = async () => {
    for (const [, entry] of pending) {
      clearTimeout(entry.timer);
      entry.resolve({ id: "", ok: false, error: "漫影应用正在退出,云端生图已取消" });
    }
    pending.clear();
    ipcMain.removeHandler(COMFY_CLOUD_RELAY_RESPONSE_CHANNEL);
    await new Promise<void>((resolve) => {
      if (!server) return resolve();
      server.close(() => resolve());
    });
    server = null;
    listening = false;
  };

  return {
    start,
    stop,
    isListening: () => listening,
    /** 实际监听端口(port=0 时由内核分配;测试面用)。 */
    getPort: () => {
      const address = server?.address();
      return address && typeof address === "object" ? address.port : null;
    },
    /** 仅测试面:模拟渲染层应答。 */
    _settleForTest: settle,
  };
}
