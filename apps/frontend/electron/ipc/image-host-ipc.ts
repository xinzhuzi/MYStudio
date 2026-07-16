import path from "node:path";
import { ipcMain } from "electron";
import type { DiagnosticsLogEntryInput } from "../../types/diagnostics";

type ImageHostUploadProvider = {
  name: string;
  platform: string;
  baseUrl?: string;
  uploadPath?: string;
  apiKeyParam?: string;
  apiKeyHeader?: string;
  apiKeyFormField?: string;
  expirationParam?: string;
  imageField?: string;
  imagePayloadType?: "base64" | "file";
  nameField?: string;
  staticFormFields?: Record<string, string>;
  responseUrlField?: string;
  responseDeleteUrlField?: string;
};

type ImageHostUploadRequest = {
  provider: ImageHostUploadProvider;
  apiKey: string;
  imageData: string;
  options?: { name?: string; expiration?: number };
};

type ImageHostUploadResponse = {
  success: boolean;
  url?: string;
  deleteUrl?: string;
  error?: string;
};

type RegisterImageHostIpcHandlersContext = {
  createOperationId: () => string;
  writeDiagnosticsLog: (entry: DiagnosticsLogEntryInput) => void;
  readImageSource: (imageData: string) => Promise<{ buffer: Buffer; mimeType: string }>;
};

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isValidImageHostUploadRequest(value: unknown): value is ImageHostUploadRequest {
  if (!isRecord(value) || Array.isArray(value) || !isRecord(value.provider) || Array.isArray(value.provider)) return false;
  const provider = value.provider;
  if (typeof provider.name !== "string" || typeof provider.platform !== "string") return false;
  if (typeof value.apiKey !== "string" || typeof value.imageData !== "string") return false;
  if (provider.imagePayloadType !== undefined && provider.imagePayloadType !== "base64" && provider.imagePayloadType !== "file") return false;
  if (provider.staticFormFields !== undefined && (Array.isArray(provider.staticFormFields) || !isRecord(provider.staticFormFields)
    || Object.values(provider.staticFormFields).some((field) => typeof field !== "string"))) return false;
  for (const key of ["baseUrl", "uploadPath", "apiKeyParam", "apiKeyHeader", "apiKeyFormField",
    "expirationParam", "imageField", "nameField", "responseUrlField", "responseDeleteUrlField"] as const) {
    if (provider[key] !== undefined && typeof provider[key] !== "string") return false;
  }
  if (value.options !== undefined) {
    if (!isRecord(value.options) || Array.isArray(value.options)) return false;
    if (value.options.name !== undefined && typeof value.options.name !== "string") return false;
    if (value.options.expiration !== undefined && typeof value.options.expiration !== "number") return false;
  }
  return true;
}

function resolveImageHostUploadUrl(provider: ImageHostUploadProvider) {
  const uploadPath = (provider.uploadPath || "").trim();
  if (uploadPath && isHttpUrl(uploadPath)) return uploadPath;
  const baseUrl = (provider.baseUrl || "").trim().replace(/\/*$/, "");
  if (!baseUrl && !uploadPath) return "";
  if (!baseUrl && uploadPath) return "";
  if (!uploadPath) return baseUrl;
  return `${baseUrl}${uploadPath.startsWith("/") ? uploadPath : `/${uploadPath}`}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getByPath(obj: unknown, objectPath?: string): unknown {
  if (!isRecord(obj) || !objectPath) return undefined;
  return objectPath.split(".").reduce<unknown>((acc, key) => (
    isRecord(acc) ? acc[key] : undefined
  ), obj);
}

function extractFirstHttpUrl(value: string) {
  return value.match(/https?:\/\/[^\s"'<>]+/i)?.[0];
}

function getExtensionFromMimeType(mimeType?: string) {
  switch ((mimeType || "").toLowerCase()) {
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    case "image/webp": return "webp";
    case "image/svg+xml": return "svg";
    case "image/bmp": return "bmp";
    case "image/avif": return "avif";
    default: return "png";
  }
}

function parseDataUrl(dataUrl: string) {
  const matches = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
  if (!matches) return null;
  const buffer = Buffer.from(matches[2], "base64");
  if (buffer.length === 0) return null;
  return { buffer, mimeType: matches[1] || "image/png" };
}

async function uploadImageHostFromMain(
  request: ImageHostUploadRequest,
  readImageSource: RegisterImageHostIpcHandlersContext["readImageSource"],
): Promise<ImageHostUploadResponse> {
  const { provider, apiKey, imageData, options } = request;
  try {
    const uploadUrl = resolveImageHostUploadUrl(provider);
    if (!uploadUrl) return { success: false, error: "图床上传地址未配置" };

    const formData = new FormData();
    Object.entries(provider.staticFormFields || {}).forEach(([key, value]) => formData.append(key, value));
    if (provider.apiKeyFormField && apiKey) formData.append(provider.apiKeyFormField, apiKey);

    const fieldName = provider.imageField || "image";
    if ((provider.imagePayloadType || "base64") === "file") {
      const { buffer, mimeType } = await readImageSource(imageData);
      const baseName = (options?.name || "upload").trim() || "upload";
      const filename = /\.[a-z0-9]{2,8}$/i.test(baseName)
        ? baseName
        : `${baseName}.${getExtensionFromMimeType(mimeType)}`;
      formData.append(fieldName, new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    } else if (imageData.startsWith("data:")) {
      const parsed = parseDataUrl(imageData);
      if (!parsed) throw new Error("图片数据无效");
      formData.append(fieldName, parsed.buffer.toString("base64"));
    } else if (isHttpUrl(imageData) || imageData.startsWith("project-file://")
      || imageData.startsWith("local-image://") || imageData.startsWith("file://")
      || path.isAbsolute(imageData)) {
      const { buffer } = await readImageSource(imageData);
      formData.append(fieldName, buffer.toString("base64"));
    } else {
      formData.append(fieldName, imageData);
    }

    if (options?.name) formData.append(provider.nameField || "name", options.name);
    const url = new URL(uploadUrl);
    if (provider.apiKeyParam && apiKey) url.searchParams.set(provider.apiKeyParam, apiKey);
    if (provider.expirationParam && options?.expiration) {
      url.searchParams.set(provider.expirationParam, String(options.expiration));
    }
    const headers: Record<string, string> = { Accept: "application/json, text/plain;q=0.9, */*;q=0.8" };
    if (provider.apiKeyHeader && apiKey) headers[provider.apiKeyHeader] = apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: formData,
        signal: controller.signal,
      });
      const text = await response.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      if (!response.ok) {
        const errorMessage = getByPath(data, "error.message");
        const messageField = getByPath(data, "message");
        const message = typeof errorMessage === "string"
          ? errorMessage
          : typeof messageField === "string" ? messageField : text || `上传失败: ${response.status}`;
        return { success: false, error: message };
      }

      const urlField = getByPath(data, provider.responseUrlField || "url");
      const deleteField = getByPath(data, provider.responseDeleteUrlField || "delete_url");
      const trimmedText = text.trim();
      if (typeof urlField === "string" && isHttpUrl(urlField)) {
        const deleteUrl = typeof deleteField === "string" && isHttpUrl(deleteField) ? deleteField : undefined;
        return {
          success: true,
          url: urlField,
          deleteUrl,
        };
      }
      const extractedTextUrl = extractFirstHttpUrl(trimmedText);
      if (extractedTextUrl) return { success: true, url: extractedTextUrl };
      console.warn("[ImageHost/Main] Upload succeeded but no URL was detected in the response", {
        provider: provider.name,
        platform: provider.platform,
        responsePreview: trimmedText.substring(0, 200),
      });
      return { success: false, error: `图床 ${provider.name} 上传成功但未返回 URL` };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return { success: false, error: "上传超时，请稍后重试" };
      }
      return { success: false, error: error instanceof Error ? error.message : "上传失败" };
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "上传失败" };
  }
}

export function registerImageHostIpcHandlers({
  createOperationId,
  writeDiagnosticsLog,
  readImageSource,
}: RegisterImageHostIpcHandlersContext) {
  ipcMain.handle("image-host-upload", async (_event, payload: unknown) => {
    const operationId = createOperationId();
    if (!isValidImageHostUploadRequest(payload)) {
      writeDiagnosticsLog({ level: "error", category: "ipc", operationId,
        message: "Image host upload rejected invalid payload" });
      return { success: false, error: "图床上传参数无效" } satisfies ImageHostUploadResponse;
    }
    writeDiagnosticsLog({
      level: "info",
      category: "ipc",
      operationId,
      message: "Image host upload IPC started",
      context: {
        providerName: payload.provider.name,
        platform: payload.provider.platform,
        baseUrl: payload.provider.baseUrl,
        imageDataLength: payload.imageData.length,
      },
    });
    try {
      const result = await uploadImageHostFromMain(payload, readImageSource);
      writeDiagnosticsLog({
        level: result.success ? "info" : "error",
        category: "network",
        operationId,
        message: result.success ? "Image host upload completed" : "Image host upload failed",
        context: {
          providerName: payload.provider.name,
          platform: payload.provider.platform,
          hasUrl: Boolean(result.url),
          error: result.error,
        },
      });
      return result;
    } catch (error) {
      writeDiagnosticsLog({
        level: "error",
        category: "network",
        operationId,
        message: "Image host upload errored",
        context: { providerName: payload.provider.name, platform: payload.provider.platform },
        error,
      });
      throw error;
    }
  });
}
