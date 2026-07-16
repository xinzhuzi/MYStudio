import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const GPT_IMAGE_SIZE_MAP = {
  "1:1": { "1K": "1024x1024", "2K": "2048x2048", "4K": "2880x2880" },
  "16:9": { "1K": "1280x720", "2K": "2048x1152", "4K": "3840x2160" },
  "9:16": { "1K": "720x1280", "2K": "1152x2048", "4K": "2160x3840" },
  "4:3": { "1K": "1152x864", "2K": "2048x1536", "4K": "3264x2448" },
  "3:4": { "1K": "864x1152", "2K": "1536x2048", "4K": "2448x3264" },
  "3:2": { "1K": "1248x832", "2K": "2016x1344", "4K": "3520x2352" },
  "2:3": { "1K": "832x1248", "2K": "1344x2016", "4K": "2352x3520" },
  "21:9": { "1K": "1280x544", "2K": "2048x880", "4K": "3840x1648" },
  "9:21": { "1K": "544x1280", "2K": "880x2048", "4K": "1648x3840" },
};

const IMAGE_TRANSFER_MAX_BYTES = 1_000_000;
const IMAGE_TRANSFER_MAX_EDGES = [768, 672, 576, 512, 448, 384, 320, 256];
const IMAGE_TRANSFER_JPEG_QUALITIES = [86, 78, 70, 62, 54, 46, 40];

function decodeDataImage(source) {
  const match = /^data:image\/[^;,]+;base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(source);
  if (!match) throw new Error("reference image data URI is malformed");
  const encoded = match[1].replace(/\s+/g, "");
  const payload = Buffer.from(encoded, "base64");
  if (!payload.length || payload.toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) {
    throw new Error("reference image data URI base64 is invalid");
  }
  return payload;
}

async function readReferenceImage(source) {
  if (/^https?:\/\//i.test(source)) return null;
  if (source.startsWith("data:")) return decodeDataImage(source);
  if (source.startsWith("file://")) return readFile(fileURLToPath(source));
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    throw new Error(`unsupported local reference image scheme: ${source.split(":", 1)[0]}`);
  }
  return readFile(source);
}

async function prepareReferenceImage(source) {
  if (/^https?:\/\//i.test(source)) return source;
  let input;
  try {
    input = await readReferenceImage(source);
    await sharp(input, { failOn: "error" }).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`reference image decode failed before request: ${message}`);
  }
  for (const maxEdge of IMAGE_TRANSFER_MAX_EDGES) {
    for (const quality of IMAGE_TRANSFER_JPEG_QUALITIES) {
      const payload = await sharp(input, { failOn: "error" })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (payload.length < IMAGE_TRANSFER_MAX_BYTES) {
        return `data:image/jpeg;base64,${payload.toString("base64")}`;
      }
    }
  }
  throw new Error(`reference image thumbnail must be strictly smaller than ${IMAGE_TRANSFER_MAX_BYTES} bytes`);
}

async function prepareReferenceImages(sources) {
  const prepared = [];
  for (const source of sources) prepared.push(await prepareReferenceImage(String(source || "")));
  return prepared;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function writeStdout(value) {
  return new Promise((resolve, reject) => {
    process.stdout.write(value, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function resolveSize(aspectRatio, resolution) {
  const ratio = GPT_IMAGE_SIZE_MAP[aspectRatio] ? aspectRatio : "16:9";
  const normalizedResolution = String(resolution || "2K").toUpperCase();
  return GPT_IMAGE_SIZE_MAP[ratio][normalizedResolution] || GPT_IMAGE_SIZE_MAP[ratio]["2K"];
}

function normalizePrompt(prompt) {
  const text = String(prompt || "").trim();
  return [
    text,
    "clean image",
    "low visual noise",
    "dirty texture",
    "unwanted calligraphy",
  ].filter(Boolean).join(", ");
}

function parseApiKeys(apiKey, apiKeys = []) {
  const values = [];
  if (Array.isArray(apiKeys)) values.push(...apiKeys);
  if (apiKey) values.push(apiKey);
  const keys = values
    .flatMap((value) => String(value || "").split(/[,\n]/))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(keys)];
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/Bearer\s+[^\r\n"]+/gi, "Bearer <redacted>")
    .replace(/sk-[A-Za-z0-9_\-.]{8,}/g, "sk-<redacted>");
}

function describeError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (!cause || typeof cause !== "object") return error.message;
  const causeCode = String(cause.code || cause.name || "unknown");
  const causeMessage = String(cause.message || "").trim();
  return `${error.message}; cause=${causeCode}${causeMessage ? `: ${causeMessage}` : ""}`;
}

function stopProviderFallback(message, cause) {
  const error = new Error(message);
  error.name = "ProviderFallbackStoppedError";
  error.stopProviderFallback = true;
  if (cause !== undefined) error.cause = cause;
  return error;
}

function shouldStopProviderFallback(error) {
  return Boolean(error && typeof error === "object" && error.stopProviderFallback === true);
}

function isAmbiguousPaidRequestError(error) {
  const message = describeError(error);
  return /fetch failed|timed?\s*out|abort|socket|UND_ERR|ECONNRESET|EPIPE|ETIMEDOUT|Image generation failed:\s*5\d\d/i.test(message);
}

function normalizeProviderConfigs(payload) {
  const rawProviders = Array.isArray(payload.providers) && payload.providers.length
    ? payload.providers
    : [{
      baseUrl: payload.baseUrl,
      apiKey: payload.apiKey,
      apiKeys: payload.apiKeys,
      model: payload.model,
      providerName: payload.providerName,
      aspectRatio: payload.aspectRatio,
      resolution: payload.resolution,
      timeoutSeconds: payload.timeoutSeconds,
    }];
  return rawProviders.map((providerConfig) => ({
    baseUrl: providerConfig.baseUrl,
    apiKeys: parseApiKeys(providerConfig.apiKey, providerConfig.apiKeys),
    model: providerConfig.model,
    providerName: providerConfig.providerName || providerConfig.name || "freedom-image",
    aspectRatio: providerConfig.aspectRatio || payload.aspectRatio || "16:9",
    resolution: providerConfig.resolution || payload.resolution || "2K",
    timeoutSeconds: providerConfig.timeoutSeconds || payload.timeoutSeconds || 180,
    asyncMode: providerConfig.asyncMode === true || payload.asyncMode === true,
  }));
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

function imageGenerationEndpoint(baseUrl, asyncMode = false) {
  return `${normalizeBaseUrl(baseUrl)}/v1/images/generations${asyncMode ? "/async" : ""}`;
}

function imageTaskPollEndpoint(baseUrl, taskId, asyncMode = false) {
  const root = normalizeBaseUrl(baseUrl);
  return asyncMode
    ? `${root}/v1/images/tasks/${encodeURIComponent(taskId)}`
    : `${root}/v1/images/generations/${encodeURIComponent(taskId)}`;
}

function dataImageUrl(b64, format) {
  const value = String(b64 || "").trim();
  if (!value) return "";
  if (value.startsWith("data:image/")) return value;
  const normalizedFormat = String(format || "png").toLowerCase().replace(/[^a-z0-9.+-]/g, "") || "png";
  const mediaFormat = normalizedFormat === "jpg" ? "jpeg" : normalizedFormat;
  return `data:image/${mediaFormat};base64,${value}`;
}

function firstString(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) return firstString(value[0]);
  return "";
}

function extractImageUrl(data) {
  if (!data || typeof data !== "object") return "";
  const dataField = data.data;
  const firstRecord = Array.isArray(dataField) ? dataField[0] : dataField;
  const record = firstRecord && typeof firstRecord === "object" ? firstRecord : {};
  const directImageUrl = (
    firstString(record.url) ||
    firstString(record.image_url) ||
    firstString(record.output_url) ||
    dataImageUrl(record.b64_json, record.output_format || data.output_format) ||
    firstString(data.url) ||
    firstString(data.image_url) ||
    firstString(data.output_url) ||
    dataImageUrl(data.b64_json, data.output_format)
  );
  if (directImageUrl) return directImageUrl;
  if (data.result && data.result !== data) return extractImageUrl(data.result);
  return "";
}

function extractTaskId(data) {
  if (!data || typeof data !== "object") return "";
  const dataField = data.data;
  const firstRecord = Array.isArray(dataField) ? dataField[0] : dataField;
  const record = firstRecord && typeof firstRecord === "object" ? firstRecord : {};
  return firstString(record.task_id) || firstString(record.id) || firstString(data.task_id) || firstString(data.taskId) || firstString(data.id);
}

function buildRequestBody({ model, prompt, referenceImages, aspectRatio, resolution }) {
  const body = {
    model,
    prompt,
    n: 1,
    size: resolveSize(aspectRatio, resolution),
  };
  if (referenceImages.length) body.image_urls = referenceImages;
  return body;
}

async function fetchJson({ url, apiKey, body, signal }) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    throw new Error(`Image generation failed: ${response.status} ${redactSensitiveText(text)}`);
  }
  if (!data) throw new Error(`Image generation returned non-JSON response: ${redactSensitiveText(text)}`);
  return data;
}

async function pollImageResult({ baseUrl, apiKey, taskId, signal, timeoutSeconds, asyncMode }) {
  const deadline = Date.now() + Math.max(1, Number(timeoutSeconds) || 180) * 1000;
  const pollUrl = imageTaskPollEndpoint(baseUrl, taskId, asyncMode);
  let lastData;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    lastData = await fetchJson({ url: pollUrl, apiKey, signal });
    const imageUrl = extractImageUrl(lastData);
    if (imageUrl) return imageUrl;
    const status = firstString(lastData?.status || lastData?.state).toLowerCase();
    if (["error", "failed", "canceled", "cancelled"].includes(status)) {
      const failure = firstString(lastData?.error?.message || lastData?.message) || JSON.stringify(lastData);
      throw new Error(`Image generation task failed: ${redactSensitiveText(failure)}`);
    }
  }
  throw new Error(`Image generation task ${taskId} did not finish before timeout. Last response: ${redactSensitiveText(JSON.stringify(lastData || {}))}`);
}

async function generateWithApiKey({
  baseUrl,
  apiKey,
  model,
  prompt,
  referenceImages,
  aspectRatio,
  resolution,
  timeoutSeconds,
  asyncMode,
}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(timeoutSeconds) || 180) * 1000;
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Image generation timed out after ${timeoutSeconds}s`));
  }, timeoutMs);
  try {
    let data;
    try {
      data = await fetchJson({
        url: imageGenerationEndpoint(baseUrl, asyncMode),
        apiKey,
        body: buildRequestBody({
          model,
          prompt,
          referenceImages,
          aspectRatio,
          resolution,
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (isAmbiguousPaidRequestError(error)) {
        throw stopProviderFallback(
          "Image generation POST outcome is ambiguous; automatic provider/key fallback stopped",
          error,
        );
      }
      throw error;
    }
    const imageUrl = extractImageUrl(data);
    if (imageUrl) return imageUrl;
    const taskId = extractTaskId(data);
    if (taskId) {
      try {
        return await pollImageResult({
          baseUrl,
          apiKey,
          taskId,
          signal: controller.signal,
          timeoutSeconds,
          asyncMode,
        });
      } catch (error) {
        throw stopProviderFallback(
          `Image generation task ${taskId} was accepted; automatic provider/key fallback stopped`,
          error,
        );
      }
    }
    throw stopProviderFallback(
      `Image generation request succeeded without an image or task id; automatic provider/key fallback stopped. Response: ${redactSensitiveText(JSON.stringify(data))}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const payload = JSON.parse(await readStdin());
  const {
    baseUrl,
    apiKey,
    apiKeys: rawApiKeys = [],
    providers: rawProviders = [],
    model,
    providerName = "freedom-image",
    prompt: rawPrompt,
    referenceImages = [],
    aspectRatio = "16:9",
    resolution = "2K",
    timeoutSeconds = 180,
    asyncMode = false,
    singleAttempt = false,
  } = payload;
  const providers = normalizeProviderConfigs({
    baseUrl,
    apiKey,
    apiKeys: rawApiKeys,
    providers: rawProviders,
    model,
    providerName,
    aspectRatio,
    resolution,
    timeoutSeconds,
    asyncMode,
  });
  if (!providers.length || providers.some((providerConfig) => !providerConfig.baseUrl || providerConfig.apiKeys.length === 0 || !providerConfig.model)) {
    throw new Error("missing baseUrl/apiKey/model for storyboard image generation");
  }
  if (singleAttempt && (providers.length !== 1 || providers[0].apiKeys.length !== 1)) {
    throw new Error("single-attempt image generation requires exactly one provider and one API key before request");
  }
  const prompt = normalizePrompt(rawPrompt);
  const transferReferenceImages = await prepareReferenceImages(referenceImages);
  let lastError;
  let attemptedKeys = 0;
  const attemptErrors = [];
  for (const providerConfig of providers) {
    const apiKeys = providerConfig.apiKeys;
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex += 1) {
      const apiKey = apiKeys[keyIndex];
      attemptedKeys += 1;
      try {
        const url = await generateWithApiKey({
          baseUrl: providerConfig.baseUrl,
          apiKey,
          model: providerConfig.model,
          prompt,
          referenceImages: transferReferenceImages,
          aspectRatio: providerConfig.aspectRatio,
          resolution: providerConfig.resolution,
          timeoutSeconds: providerConfig.timeoutSeconds,
          asyncMode: providerConfig.asyncMode,
        });
        await writeStdout(JSON.stringify({ url }));
        process.exit(0);
      } catch (error) {
        lastError = error;
        const message = describeError(error);
        attemptErrors.push(`${providerConfig.providerName} key ${keyIndex + 1}: ${redactSensitiveText(message)}`);
        if (shouldStopProviderFallback(error)) {
          throw new Error(`${providerConfig.providerName} key ${keyIndex + 1}: ${redactSensitiveText(message)}`);
        }
      }
    }
  }
  const message = describeError(lastError);
  throw new Error(`Failed after ${providers.length} provider(s), ${attemptedKeys} API key(s). Last error: ${redactSensitiveText(message)}. Attempts: ${attemptErrors.join(" | ")}`);
} catch (error) {
  const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
