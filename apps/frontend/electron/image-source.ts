import fs from "node:fs";
import path from "node:path";
import { resolveLocalMediaPath, resolveProjectFileUrl } from "./storage-paths";

export type ImageSource = {
  buffer: Buffer;
  mimeType: string;
};

type ImageSourceFetch = (url: string, init: RequestInit) => Promise<Response>;

const DEFAULT_IMAGE_SOURCE_MAX_BYTES = 512 * 1024 * 1024;
const IMAGE_SOURCE_MAX_BYTES_ENV = "MYSTUDIO_IMAGE_SOURCE_MAX_BYTES";

type ImageSourceReaderOptions = {
  getDataDir: () => string;
  getMediaRoot: () => string;
  fetchImage?: ImageSourceFetch;
  fileExists?: (filePath: string) => boolean;
  readFile?: (filePath: string) => Buffer;
};

function isHttpUrl(value: string) {
  return value.startsWith("http://") || value.startsWith("https://");
}

function getImageSourceMaxBytes() {
  const configured = Number(process.env[IMAGE_SOURCE_MAX_BYTES_ENV]);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_IMAGE_SOURCE_MAX_BYTES;
}

function createImageSourceSizeError(maxBytes: number) {
  return new Error(`图片超过 ${maxBytes} bytes`);
}

function getContentLength(headers: Headers) {
  const rawValue = headers.get("content-length");
  if (!rawValue) return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

async function readBoundedResponseBuffer(response: Response, maxBytes: number) {
  const contentLength = getContentLength(response.headers);
  if (contentLength !== null && contentLength > maxBytes) {
    throw createImageSourceSizeError(maxBytes);
  }

  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw createImageSourceSizeError(maxBytes);
    }
    return buffer;
  }

  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw createImageSourceSizeError(maxBytes);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, totalBytes);
}

function getMimeTypeFromExtension(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".avif": "image/avif",
  };
  return mimeTypes[extension] || "image/png";
}

function parseDataUrl(dataUrl: string): ImageSource | null {
  const matches = dataUrl.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/s);
  if (!matches) return null;
  const buffer = Buffer.from(matches[2], "base64");
  if (buffer.length === 0) return null;
  return { buffer, mimeType: matches[1] || "image/png" };
}

async function fetchImageBuffer(url: string, fetchImage: ImageSourceFetch, timeoutMs = 45000): Promise<ImageSource> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImage(url, {
      headers: { Accept: "image/*, */*;q=0.8" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }

    const buffer = await readBoundedResponseBuffer(response, getImageSourceMaxBytes());
    if (buffer.length === 0) {
      throw new Error("获取到的图片为空");
    }
    return {
      buffer,
      mimeType: response.headers.get("content-type") || "image/png",
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function createImageSourceReader({
  getDataDir,
  getMediaRoot,
  fetchImage = (url, init) => fetch(url, init),
  fileExists = fs.existsSync,
  readFile = fs.readFileSync,
}: ImageSourceReaderOptions) {
  const resolveImageSourcePath = (imagePath: string): string | null => {
    if (imagePath.startsWith("project-file://")) {
      return resolveProjectFileUrl(getDataDir(), imagePath);
    }
    if (imagePath.startsWith("local-image://")) {
      return resolveLocalMediaPath(getMediaRoot(), imagePath);
    }
    if (imagePath.startsWith("file://")) {
      return imagePath.replace(/^file:\/\/\/?/, "");
    }
    return path.isAbsolute(imagePath) ? imagePath : null;
  };

  return async function readImageSource(imageData: string): Promise<ImageSource> {
    if (isHttpUrl(imageData)) {
      return fetchImageBuffer(imageData, fetchImage);
    }

    const parsedDataUrl = parseDataUrl(imageData);
    if (parsedDataUrl) {
      return parsedDataUrl;
    }

    const resolvedPath = resolveImageSourcePath(imageData);
    if (resolvedPath) {
      if (!fileExists(resolvedPath)) {
        throw new Error("本地图片不存在");
      }
      const buffer = readFile(resolvedPath);
      if (buffer.length === 0) {
        throw new Error("本地图片为空文件");
      }
      return { buffer, mimeType: getMimeTypeFromExtension(resolvedPath) };
    }

    const rawBuffer = Buffer.from(imageData, "base64");
    if (rawBuffer.length === 0) {
      throw new Error("图片数据无效");
    }
    return { buffer: rawBuffer, mimeType: "image/png" };
  };
}
