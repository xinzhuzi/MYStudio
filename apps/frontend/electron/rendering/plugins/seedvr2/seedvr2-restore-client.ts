// SeedVR2 修复客户端(主进程直连 ComfyUI REST)— 09-01-seedvr2-restore-upsell-chain。
//
// 链路(与 08-30~09-01 ComfyUI 实测五节点图一致):上传(≤1MP 护栏后)→ /prompt 提交
// LoadImage→LoadDiT(mps)→LoadVAE(mps)→SeedVR2VideoUpscaler(直收 IMAGE 单图)→SaveImage
// → 轮询 /history → /view 取回产物。任何一步失败 fail-closed 返回可操作错误码,
// 绝不静默降级。硬护栏:输入上传前缩到 ≤1MP —— 4K 原生直喂 SeedVR2 曾致整机
// 重启(09-01 事故,MPS 内存压爆),此护栏有单测锁定,严禁移除。

export interface SeedVr2RestoreFailure {
  ok: false;
  code: "seedvr2-unreachable" | "seedvr2-input-invalid" | "seedvr2-workflow-rejected" | "seedvr2-failed" | "seedvr2-timeout" | "seedvr2-no-output";
  message: string;
}

export interface SeedVr2RestoreSuccess {
  ok: true;
  filePath: string;
  seconds: number;
}

/** ≤1MP 护栏常量(单测锁定引用)。 */
export const SEEDVR2_MAX_INPUT_PIXELS = 1_048_576;

type Resizer = (buffer: Buffer, maxPixels: number) => Buffer;

export interface SeedVr2RestoreDeps {
  fetchImpl?: typeof fetch;
  /** 图像缩放器(生产=seedvr2-native-resizer 的 nativeImageResizer;测试注入假实现)。
   *  未提供时不缩放——此时 >1MP 输入会被护栏直接拒绝(fail-closed,绝不带大图上行)。 */
  resize?: Resizer;
  baseUrl?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 轮询上限,默认 10 分钟(修复实测 20-35s/张,留足余量)。 */
  timeoutMs?: number;
  log?: (message: string) => void;
}

function defaultBaseUrl(): string {
  const override = process.env.MYSTUDIO_COMFYUI_BRIDGE_URL;
  // 17598:8 千段端口撞车高发(08-31 用户裁定换冷门口);ComfyUI 侧需以 --port 17598 启动
  return (override ?? "http://127.0.0.1:17598").replace(/\/$/, "");
}

function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function httpJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  errorMessage: string,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (error) {
    throw new SeedVr2Error("seedvr2-unreachable", `${errorMessage}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok && response.status !== 400) {
    throw new SeedVr2Error("seedvr2-unreachable", `${errorMessage}: HTTP ${response.status}`);
  }
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new SeedVr2Error("seedvr2-unreachable", `${errorMessage}: 响应不是 JSON`);
  }
}

class SeedVr2Error extends Error {
  constructor(public code: SeedVr2RestoreFailure["code"], message: string) {
    super(message);
  }
}

/** 实测配方图(09-01 全链验证):device 必须 mps(default 会被 ComfyUI 校验拒绝)。
 * 模型=7B sharp(09-01 升级裁定:同等洁净度下保笔触墨线无磨皮,44.8s vs 3B 33s,
 * 帧1 对拍+VLM 判读优于 3B;见 .trellis/tasks/09-01-seedvr2-7bsharp-rollout)。 */
export const SEEDVR2_RESTORE_MODEL = "seedvr2_7b_sharp_fp8_e4m3fn.safetensors";

function buildGraph(uploadedName: string, shortestEdge: number): Record<string, unknown> {
  return {
    "1": { class_type: "LoadImage", inputs: { image: uploadedName } },
    "2": { class_type: "SeedVR2LoadDiTModel", inputs: { model: SEEDVR2_RESTORE_MODEL, device: "mps" } },
    "3": { class_type: "SeedVR2LoadVAEModel", inputs: { model: "ema_vae_fp16.safetensors", device: "mps" } },
    "4": {
      class_type: "SeedVR2VideoUpscaler",
      inputs: {
        image: ["1", 0],
        dit: ["2", 0],
        vae: ["3", 0],
        seed: 42,
        resolution: Math.max(2, shortestEdge - (shortestEdge % 2)),
        max_resolution: 4096,
        batch_size: 1,
        uniform_batch_size: false,
        color_correction: "lab",
      },
    },
    "5": { class_type: "SaveImage", inputs: { images: ["4", 0], filename_prefix: "MYStudio_SeedVR2" } },
  };
}

export async function runSeedVr2Restore(
  input: { imagePath: string; outputDir: string },
  deps: SeedVr2RestoreDeps = {},
): Promise<SeedVr2RestoreSuccess | SeedVr2RestoreFailure> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const resize = deps.resize ?? ((buffer: Buffer) => buffer);
  const baseUrl = deps.baseUrl ?? defaultBaseUrl;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((message: string) => process.stdout.write(`[seedvr2] ${message}\n`));
  const timeoutMs = deps.timeoutMs ?? 10 * 60_000;

  const started = now();
  try {
    // 前置:ComfyUI 活着吗(2s 快速失败,报人话)
    try {
      await fetchImpl(`${baseUrl()}/system_stats`, { signal: AbortSignal.timeout(2000) });
    } catch {
      return { ok: false, code: "seedvr2-unreachable", message: "ComfyUI 没在运行，请先打开它再试" };
    }

    const fs = await import("node:fs");
    const path = await import("node:path");

    let raw: Buffer;
    try {
      raw = fs.readFileSync(input.imagePath);
    } catch (error) {
      return { ok: false, code: "seedvr2-input-invalid", message: `修复输入读取失败: ${error instanceof Error ? error.message : String(error)}` };
    }
    // 硬护栏:上传前缩到 ≤1MP(整机重启事故教训;缩放失败则拒绝,不许带大图上行)
    let uploadBuffer: Buffer;
    try {
      uploadBuffer = resize(raw, SEEDVR2_MAX_INPUT_PIXELS);
    } catch (error) {
      return { ok: false, code: "seedvr2-input-invalid", message: `修复输入预处理失败: ${error instanceof Error ? error.message : String(error)}` };
    }
    const size = readPngSize(uploadBuffer);
    if (!size || size.width * size.height <= 0) {
      return { ok: false, code: "seedvr2-input-invalid", message: "修复输入不是有效 PNG" };
    }
    if (size.width * size.height > SEEDVR2_MAX_INPUT_PIXELS * 1.05) {
      return { ok: false, code: "seedvr2-input-invalid", message: "修复输入未通过 ≤1MP 缩放护栏" };
    }

    // 上传(Node 24 原生 FormData/Blob)
    const form = new FormData();
    form.append("image", new Blob([new Uint8Array(uploadBuffer)], { type: "image/png" }), "mystudio-seedvr2-input.png");
    const uploadReply = await httpJson(fetchImpl, `${baseUrl()}/upload/image`, { method: "POST", body: form }, "修复图上传失败");
    const uploadedName = typeof uploadReply.name === "string" ? uploadReply.name : "";
    if (!uploadedName) {
      return { ok: false, code: "seedvr2-failed", message: "ComfyUI 未返回上传文件名" };
    }
    const subfolder = typeof uploadReply.subfolder === "string" ? uploadReply.subfolder : "";
    const reference = subfolder ? `${subfolder}/${uploadedName}` : uploadedName;

    // 提交工作流
    const submitted = await httpJson(fetchImpl, `${baseUrl()}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: buildGraph(reference, Math.min(size.width, size.height)), client_id: "mystudio-seedvr2-restore" }),
    }, "修复任务提交失败");
    if (submitted.node_errors && Object.keys(submitted.node_errors as object).length > 0) {
      return { ok: false, code: "seedvr2-workflow-rejected", message: `ComfyUI 拒绝修复工作流: ${JSON.stringify(submitted.node_errors).slice(0, 300)}` };
    }
    const promptId = typeof submitted.prompt_id === "string" ? submitted.prompt_id : "";
    if (!promptId) {
      return { ok: false, code: "seedvr2-failed", message: "ComfyUI 未返回任务编号" };
    }
    log(`submitted ${promptId} (${size.width}x${size.height})`);

    // 轮询
    const deadline = now() + timeoutMs;
    let outputImage: { filename: string; subfolder?: string; type?: string } | null = null;
    while (now() < deadline) {
      await sleep(2000);
      const history = await httpJson(fetchImpl, `${baseUrl()}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) }, "修复进度查询失败");
      const entry = history[promptId] as { status?: { status_str?: string; messages?: unknown }; outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }> } | undefined;
      if (entry) {
        const state = entry.status?.status_str;
        if (state === "error") {
          return { ok: false, code: "seedvr2-failed", message: `ComfyUI 修复执行失败: ${JSON.stringify(entry.status?.messages).slice(0, 300)}` };
        }
        if (state === "success") {
          for (const out of Object.values(entry.outputs ?? {})) {
            if (out.images && out.images.length > 0) {
              outputImage = out.images[0];
              break;
            }
          }
          if (outputImage) break;
          return { ok: false, code: "seedvr2-no-output", message: "ComfyUI 修复完成但没有输出图片" };
        }
      }
    }
    if (!outputImage) {
      return { ok: false, code: "seedvr2-timeout", message: `SeedVR2 修复超时(>${Math.round(timeoutMs / 1000)}秒)` };
    }

    // 取回产物
    const query = new URLSearchParams({
      filename: outputImage.filename,
      subfolder: outputImage.subfolder ?? "",
      type: outputImage.type ?? "output",
    });
    let bytes: Buffer;
    try {
      const response = await fetchImpl(`${baseUrl()}/view?${query.toString()}`, { signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
    } catch (error) {
      return { ok: false, code: "seedvr2-failed", message: `修复产物读取失败: ${error instanceof Error ? error.message : String(error)}` };
    }
    fs.mkdirSync(input.outputDir, { recursive: true });
    const filePath = path.join(input.outputDir, "seedvr2-restored.png");
    fs.writeFileSync(filePath, bytes);
    log(`restored → ${filePath} in ${((now() - started) / 1000).toFixed(1)}s`);
    return { ok: true, filePath, seconds: (now() - started) / 1000 };
  } catch (error) {
    if (error instanceof SeedVr2Error) {
      return { ok: false, code: error.code, message: error.message };
    }
    return { ok: false, code: "seedvr2-failed", message: `SeedVR2 修复失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}
