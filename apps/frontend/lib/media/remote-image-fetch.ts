const DEFAULT_REMOTE_IMAGE_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_REMOTE_IMAGE_TIMEOUT_MS = 45_000;
const IMAGE_ACCEPT_HEADER = "image/*, */*;q=0.8";

type RemoteImageFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RemoteImageFetchOptions = {
  fetchImage?: RemoteImageFetch;
  maxBytes?: number;
  timeoutMs?: number;
};

function getMaxBytes(configured?: number): number {
  if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }
  return DEFAULT_REMOTE_IMAGE_MAX_BYTES;
}

function getContentLength(headers: Headers): number | null {
  const rawValue = headers.get("content-length");
  if (!rawValue) return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function createRemoteImageSizeError(maxBytes: number): Error {
  return new Error(`图片超过 ${maxBytes} bytes`);
}

async function readBoundedResponseBlob(response: Response, maxBytes: number): Promise<Blob> {
  const contentLength = getContentLength(response.headers);
  if (contentLength !== null && contentLength > maxBytes) {
    throw createRemoteImageSizeError(maxBytes);
  }

  const body = response.body as ReadableStream<Uint8Array> | null;
  const mimeType = response.headers.get("content-type") || "image/png";
  if (!body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) {
      throw createRemoteImageSizeError(maxBytes);
    }
    if (blob.size === 0) {
      throw new Error("获取到的图片为空");
    }
    return blob;
  }

  const reader = body.getReader();
  const chunks: ArrayBuffer[] = [];
  let totalBytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw createRemoteImageSizeError(maxBytes);
    }
    const chunk = new Uint8Array(value.byteLength);
    chunk.set(value);
    chunks.push(chunk.buffer);
  }

  if (totalBytes === 0) {
    throw new Error("获取到的图片为空");
  }
  return new Blob(chunks, { type: mimeType });
}

export async function fetchRemoteImageBlob(url: string, options: RemoteImageFetchOptions = {}): Promise<Blob> {
  const fetchImage = options.fetchImage ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_REMOTE_IMAGE_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImage(url, {
      headers: { Accept: IMAGE_ACCEPT_HEADER },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status}`);
    }
    return await readBoundedResponseBlob(response, getMaxBytes(options.maxBytes));
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("图片读取结果无效"));
      }
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

export async function fetchRemoteImageDataUrl(url: string, options?: RemoteImageFetchOptions): Promise<string> {
  return readBlobAsDataUrl(await fetchRemoteImageBlob(url, options));
}
