import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  appendLedgerEvent,
  assertRequestNotAlreadyPaid,
  canonicalJson,
  hashReferenceImage,
  sha256,
} from "./paid-image-request-ledger.mjs";

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
const V2_STYLE_CONTRACT_VERSION = "daojie-gongbi-v2";
const REFERENCE_CAPABILITY_SCHEMA_VERSION = "daojie-reference-capability-v1";
const REQUEST_MODE_GENERATIONS_JSON = "openai-image-generations-json";
const REQUEST_MODE_IMAGE_EDITS = "openai-image-edits";
const REQUEST_MODES = new Set([REQUEST_MODE_GENERATIONS_JSON, REQUEST_MODE_IMAGE_EDITS]);
const REFERENCE_ROLE_ORDER = [
  "scene-viewpoint",
  "canonical",
  "prop-state",
  "previous-approved-frame",
  "style-reference",
];

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

function resolveEditSizeAndQuality(aspectRatio, resolution) {
  const normalizedResolution = String(resolution || "1K").toUpperCase();
  const presets = {
    "1K": { square: "1024x1024", landscape: "1536x1024", portrait: "1024x1536", quality: "low" },
    "2K": { square: "2048x2048", landscape: "2048x1152", portrait: "1152x2048", quality: "medium" },
    "4K": { square: "2880x2880", landscape: "3840x2160", portrait: "2160x3840", quality: "high" },
  };
  const preset = presets[normalizedResolution] || presets["1K"];
  const [width, height] = String(aspectRatio || "1:1").split(":").map(Number);
  const ratio = Number.isFinite(width) && Number.isFinite(height) && height !== 0 ? width / height : 1;
  const size = ratio > 1.12 ? preset.landscape : ratio < 0.88 ? preset.portrait : preset.square;
  return { size, quality: preset.quality };
}

function normalizeRequestMode(value) {
  const requestMode = String(value || REQUEST_MODE_GENERATIONS_JSON).trim();
  if (!REQUEST_MODES.has(requestMode)) {
    throw new Error(`unsupported storyboard image requestMode: ${requestMode}`);
  }
  return requestMode;
}

function normalizePrompt(prompt, styleContractVersion) {
  const text = String(prompt || "").trim();
  if (styleContractVersion === V2_STYLE_CONTRACT_VERSION) return text;
  return [
    text,
    "clean image",
    "low visual noise",
    "do not render any calligraphy, visible text, watermark, signature, or logo",
  ].filter(Boolean).join(", ");
}

function semanticRoleEvidence(referenceCapability) {
  const evidence = referenceCapability?.semanticRoleEvidence;
  if (!evidence || typeof evidence !== "object") {
    return {
      status: "unverified",
      providerRoleMetadataSent: false,
      bindingMechanism: "prompt-markers-plus-ordered-images",
      detail: "Provider capacity evidence does not prove native reference-role interpretation.",
    };
  }
  return {
    status: String(evidence.status || "unverified"),
    providerRoleMetadataSent: evidence.providerRoleMetadataSent === true,
    bindingMechanism: String(evidence.bindingMechanism || ""),
    detail: String(evidence.detail || ""),
  };
}

function assertV2ReferenceCapability({
  styleContractVersion,
  referenceImages,
  referenceRoles,
  referenceCapability,
  requestMode,
}) {
  if (styleContractVersion !== V2_STYLE_CONTRACT_VERSION) return;
  if (!Array.isArray(referenceRoles) || referenceRoles.length !== referenceImages.length) {
    throw new Error("V2 storyboard reference roles must match the supplied image count");
  }
  if (!referenceCapability || referenceCapability.schemaVersion !== REFERENCE_CAPABILITY_SCHEMA_VERSION) {
    throw new Error("V2 storyboard reference capability schema is missing or invalid");
  }
  if (referenceCapability.status !== "verified") {
    throw new Error(`V2 storyboard reference capability is unverified: ${referenceCapability.reason || "missing evidence"}`);
  }
  if (
    referenceCapability.requestMode
    && referenceCapability.requestMode !== requestMode
  ) {
    throw new Error(`V2 reference capability requestMode mismatch: ${referenceCapability.requestMode} != ${requestMode}`);
  }
  if (requestMode === REQUEST_MODE_IMAGE_EDITS && referenceCapability.requestMode !== REQUEST_MODE_IMAGE_EDITS) {
    throw new Error("openai-image-edits requires matching V2 capability evidence");
  }
  if (!Number.isInteger(referenceCapability.supportedReferenceCount) || referenceCapability.supportedReferenceCount < 1) {
    throw new Error("V2 storyboard reference capability is missing supportedReferenceCount");
  }
  if (referenceImages.length > referenceCapability.supportedReferenceCount) {
    throw new Error(
      `V2 storyboard reference count ${referenceImages.length} exceeds verified capacity ${referenceCapability.supportedReferenceCount}; references cannot be dropped to continue`,
    );
  }
  if (JSON.stringify(referenceCapability.referenceRoleOrder) !== JSON.stringify(REFERENCE_ROLE_ORDER)) {
    throw new Error("V2 storyboard reference capability has an unsupported reference-role order");
  }
  const roleRanks = new Map(REFERENCE_ROLE_ORDER.map((role, index) => [role, index]));
  if (referenceRoles.some((role) => !roleRanks.has(role))) {
    throw new Error(`V2 storyboard reference capability rejects roles: ${referenceRoles.join(",")}`);
  }
  if (referenceRoles.some((role, index) => index > 0 && roleRanks.get(referenceRoles[index - 1]) > roleRanks.get(role))) {
    throw new Error(`V2 storyboard reference role order is invalid: ${referenceRoles.join(",")}`);
  }
  if (!referenceCapability.evidence || !["kind", "checkedAt", "detail"].every((key) => String(referenceCapability.evidence[key] || "").trim())) {
    throw new Error("V2 storyboard reference capability is missing auditable evidence");
  }
  const hasStyleReference = referenceRoles.includes("style-reference");
  const styleReference = referenceCapability.styleReference;
  if (!styleReference || typeof styleReference !== "object") {
    throw new Error("V2 storyboard reference capability is missing style-reference provenance");
  }
  if (hasStyleReference) {
    if (styleReference.enabled !== true || !/^[a-f0-9]{64}$/.test(String(styleReference.sha256 || ""))) {
      throw new Error("V2 style-reference lacks verified capacity or SHA-256 provenance");
    }
    if (referenceRoles.at(-1) !== "style-reference") {
      throw new Error("V2 style-reference must be the final reference and cannot displace continuity references");
    }
  } else if (styleReference.enabled === true) {
    throw new Error("V2 capability enables a style-reference but the request did not supply it");
  }
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
      requestMode: payload.requestMode,
    }];
  return rawProviders.map((providerConfig) => {
    const requestMode = normalizeRequestMode(providerConfig.requestMode || payload.requestMode);
    const asyncMode = providerConfig.asyncMode === true || payload.asyncMode === true;
    if (requestMode === REQUEST_MODE_IMAGE_EDITS && asyncMode) {
      throw new Error("openai-image-edits requires asyncMode=false");
    }
    return {
      baseUrl: providerConfig.baseUrl,
      apiKeys: parseApiKeys(providerConfig.apiKey, providerConfig.apiKeys),
      model: providerConfig.model,
      providerName: providerConfig.providerName || providerConfig.name || "freedom-image",
      aspectRatio: providerConfig.aspectRatio || payload.aspectRatio || "16:9",
      resolution: providerConfig.resolution || payload.resolution || "2K",
      timeoutSeconds: providerConfig.timeoutSeconds || payload.timeoutSeconds || 180,
      asyncMode,
      requestMode,
    };
  });
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

function imageGenerationEndpoint(baseUrl, asyncMode = false, requestMode = REQUEST_MODE_GENERATIONS_JSON) {
  if (requestMode === REQUEST_MODE_IMAGE_EDITS) {
    if (asyncMode) throw new Error("openai-image-edits requires asyncMode=false");
    return `${normalizeBaseUrl(baseUrl)}/v1/images/edits`;
  }
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

function parsePreparedDataImage(source) {
  const match = /^data:(image\/[^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(source || ""));
  if (!match) throw new Error("openai-image-edits requires local prepared data URI references");
  return {
    mimeType: match[1].toLowerCase(),
    payload: decodeDataImage(source),
  };
}

function buildImageEditFormData({ model, prompt, referenceImages, aspectRatio, resolution }) {
  if (!referenceImages.length) throw new Error("openai-image-edits requires at least one reference image");
  const { size, quality } = resolveEditSizeAndQuality(aspectRatio, resolution);
  const formData = new FormData();
  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("size", size);
  formData.append("quality", quality);
  referenceImages.forEach((source, index) => {
    const { mimeType, payload } = parsePreparedDataImage(source);
    formData.append("image", new Blob([payload], { type: mimeType }), `reference-${index + 1}.png`);
  });
  return { formData, size, quality };
}

function buildProviderRequest({ requestMode, model, prompt, referenceImages, referenceSha256, aspectRatio, resolution }) {
  if (requestMode === REQUEST_MODE_IMAGE_EDITS) {
    const { formData, size, quality } = buildImageEditFormData({
      model,
      prompt,
      referenceImages,
      aspectRatio,
      resolution,
    });
    return {
      body: formData,
      descriptor: {
        requestMode,
        model,
        prompt,
        size,
        quality,
        orderedReferenceSha256: referenceSha256,
      },
    };
  }
  const body = buildRequestBody({ model, prompt, referenceImages, aspectRatio, resolution });
  return { body, descriptor: body };
}

async function fetchJson({ url, apiKey, body, signal, requestMode = REQUEST_MODE_GENERATIONS_JSON }) {
  const isMultipart = requestMode === REQUEST_MODE_IMAGE_EDITS;
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      ...(!isMultipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: isMultipart ? body : JSON.stringify(body) } : {}),
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
  ledgerPath,
  attemptId,
  logicalJob,
  logicalShot,
  styleContractVersion,
  styleContractFingerprint,
  promptAuditVersion,
  referenceRoles,
  referenceCapability,
  requestMode,
}) {
  const endpoint = imageGenerationEndpoint(baseUrl, asyncMode, requestMode);
  const referenceSha256 = referenceImages.map((image) => hashReferenceImage(image));
  const providerRequest = buildProviderRequest({
    requestMode,
    model,
    prompt,
    referenceImages,
    referenceSha256,
    aspectRatio,
    resolution,
  });
  const providerHost = new URL(baseUrl).host;
  const promptSha256 = sha256(prompt);
  const payloadSha256 = sha256(canonicalJson(providerRequest.descriptor));
  const requestFingerprint = sha256(canonicalJson({
    logicalJob,
    logicalShot,
    providerHost,
    model,
    endpoint,
    promptSha256,
    referenceSha256,
    payloadSha256,
    styleContractVersion,
    styleContractFingerprint,
    promptAuditVersion,
    referenceCapabilityFingerprint: referenceCapability?.fingerprint || null,
  }));
  const ledgerBase = {
    attemptId,
    logicalJob,
    logicalShot,
    providerHost,
    model,
    asyncMode,
    requestMode,
    endpoint,
    promptSha256,
    referenceSha256,
    payloadSha256,
    requestFingerprint,
    styleContractVersion,
    styleContractFingerprint,
    promptAuditVersion,
    referenceRoles,
    referenceCapabilityFingerprint: referenceCapability?.fingerprint || null,
  };
  const record = (status, extra = {}) => {
    if (!ledgerPath) return;
    appendLedgerEvent(ledgerPath, {
      ...ledgerBase,
      status,
      recordedAt: new Date().toISOString(),
      ...extra,
    });
  };
  assertRequestNotAlreadyPaid(ledgerPath, requestFingerprint);
  record("POST_SENT");
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(timeoutSeconds) || 180) * 1000;
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Image generation timed out after ${timeoutSeconds}s`));
  }, timeoutMs);
  let completed = false;
  try {
    let data;
    try {
      data = await fetchJson({
        url: endpoint,
        apiKey,
        body: providerRequest.body,
        signal: controller.signal,
        requestMode,
      });
    } catch (error) {
      record(isAmbiguousPaidRequestError(error) ? "AMBIGUOUS" : "FAILED", {
        errorType: error?.name || "Error",
        error: redactSensitiveText(describeError(error)).slice(0, 1000),
      });
      if (isAmbiguousPaidRequestError(error)) {
        throw stopProviderFallback(
          "Image generation POST outcome is ambiguous; automatic provider/key fallback stopped",
          error,
        );
      }
      throw error;
    }
    const imageUrl = extractImageUrl(data);
    if (imageUrl) {
      completed = true;
      record("COMPLETED", { taskId: null });
      return { url: imageUrl, request: { ...ledgerBase, taskId: null } };
    }
    const taskId = extractTaskId(data);
    if (taskId) {
      if (requestMode === REQUEST_MODE_IMAGE_EDITS) {
        record("AMBIGUOUS", { taskId, errorType: "UnexpectedAsyncImageEditResponse" });
        throw stopProviderFallback("openai-image-edits returned an unexpected asynchronous task id", taskId);
      }
      record("TASK_ACCEPTED", { taskId });
      try {
        const polledImageUrl = await pollImageResult({
          baseUrl,
          apiKey,
          taskId,
          signal: controller.signal,
          timeoutSeconds,
          asyncMode,
        });
        completed = true;
        record("COMPLETED", { taskId });
        return { url: polledImageUrl, request: { ...ledgerBase, taskId } };
      } catch (error) {
        record("AMBIGUOUS", {
          taskId,
          errorType: error?.name || "Error",
          error: redactSensitiveText(describeError(error)).slice(0, 1000),
        });
        throw stopProviderFallback(
          `Image generation task ${taskId} was accepted; automatic provider/key fallback stopped`,
          error,
        );
      }
    }
    record("AMBIGUOUS", {
      errorType: "MissingResultOrTaskId",
      error: "response contained neither image nor task id",
    });
    throw stopProviderFallback(
      `Image generation request succeeded without an image or task id; automatic provider/key fallback stopped. Response: ${redactSensitiveText(JSON.stringify(data))}`,
    );
  } catch (error) {
    if (!completed && !shouldStopProviderFallback(error) && isAmbiguousPaidRequestError(error)) {
      record("AMBIGUOUS", {
        errorType: error?.name || "Error",
        error: redactSensitiveText(describeError(error)).slice(0, 1000),
      });
    }
    throw error;
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
    requestMode: rawRequestMode = REQUEST_MODE_GENERATIONS_JSON,
    singleAttempt = false,
    paidRequestLedgerPath = "",
    paidAuthorization = false,
    attemptId = "",
    logicalJob = "",
    logicalShot = "",
    styleContractVersion = "",
    styleContractFingerprint = "",
    promptAuditVersion = "",
    referenceRoles = [],
    referenceCapability = null,
    dryRun = false,
  } = payload;
  const prompt = normalizePrompt(rawPrompt, styleContractVersion);
  const requestMode = normalizeRequestMode(rawRequestMode);
  if (requestMode === REQUEST_MODE_IMAGE_EDITS && asyncMode) {
    throw new Error("openai-image-edits requires asyncMode=false");
  }
  assertV2ReferenceCapability({
    styleContractVersion,
    referenceImages,
    referenceRoles,
    referenceCapability,
    requestMode,
  });
  if (dryRun) {
    const roleEvidence = semanticRoleEvidence(referenceCapability);
    await writeStdout(JSON.stringify({
      dryRun: true,
      prompt,
      promptSha256: sha256(prompt),
      promptPolicy: styleContractVersion === V2_STYLE_CONTRACT_VERSION ? "exact-reviewed-v2" : "legacy-enhanced",
      styleContractVersion,
      styleContractFingerprint,
      promptAuditVersion,
      referenceRoles,
      referenceCapability,
      requestMode,
      referenceCount: referenceImages.length,
      semanticRoleEvidence: roleEvidence,
      providerRoleMetadataSent: roleEvidence.providerRoleMetadataSent,
      generationEndpointCalled: false,
    }));
    process.exit(0);
  }
  if (process.env.MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN === "1") {
    throw new Error("MYSTUDIO_DAOJIE_IMAGE_GENERATION_FROZEN=1: storyboard image generation is frozen; no provider request was sent");
  }
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
    requestMode,
  });
  if (
    styleContractVersion === V2_STYLE_CONTRACT_VERSION
    && providers.some((providerConfig) => providerConfig.requestMode !== requestMode)
  ) {
    throw new Error("V2 provider requestMode must match the reviewed top-level capability contract");
  }
  if (!providers.length || providers.some((providerConfig) => !providerConfig.baseUrl || providerConfig.apiKeys.length === 0 || !providerConfig.model)) {
    throw new Error("missing baseUrl/apiKey/model for storyboard image generation");
  }
  if (singleAttempt && (providers.length !== 1 || providers[0].apiKeys.length !== 1)) {
    throw new Error("single-attempt image generation requires exactly one provider and one API key before request");
  }
  if (paidRequestLedgerPath && (!paidAuthorization || !attemptId || !logicalJob || !logicalShot)) {
    throw new Error("paid image generation requires explicit authorization and logical attempt metadata before request");
  }
  if (paidRequestLedgerPath && !singleAttempt) {
    throw new Error("paid image generation ledger requires singleAttempt=true; provider/key fallback is disabled");
  }
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
        const result = await generateWithApiKey({
          baseUrl: providerConfig.baseUrl,
          apiKey,
          model: providerConfig.model,
          prompt,
          referenceImages: transferReferenceImages,
          aspectRatio: providerConfig.aspectRatio,
          resolution: providerConfig.resolution,
          timeoutSeconds: providerConfig.timeoutSeconds,
          asyncMode: providerConfig.asyncMode,
          ledgerPath: paidRequestLedgerPath,
          attemptId,
          logicalJob,
          logicalShot,
          styleContractVersion,
          styleContractFingerprint,
          promptAuditVersion,
          referenceRoles,
          referenceCapability,
          requestMode: providerConfig.requestMode,
        });
        await writeStdout(JSON.stringify(paidRequestLedgerPath ? result : { url: result.url }));
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
