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
  }));
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "").replace(/\/v\d+$/, "");
}

function imageGenerationEndpoint(baseUrl) {
  return `${normalizeBaseUrl(baseUrl)}/v1/images/generations`;
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
  return (
    firstString(record.url) ||
    firstString(record.image_url) ||
    firstString(record.output_url) ||
    dataImageUrl(record.b64_json, record.output_format || data.output_format) ||
    firstString(data.url) ||
    firstString(data.image_url) ||
    firstString(data.output_url) ||
    dataImageUrl(data.b64_json, data.output_format)
  );
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

async function pollImageResult({ baseUrl, apiKey, taskId, signal, timeoutSeconds }) {
  const deadline = Date.now() + Math.max(1, Number(timeoutSeconds) || 180) * 1000;
  const pollUrl = `${imageGenerationEndpoint(baseUrl)}/${encodeURIComponent(taskId)}`;
  let lastData;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    lastData = await fetchJson({ url: pollUrl, apiKey, signal });
    const imageUrl = extractImageUrl(lastData);
    if (imageUrl) return imageUrl;
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
}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(timeoutSeconds) || 180) * 1000;
  const timeout = setTimeout(() => {
    controller.abort(new Error(`Image generation timed out after ${timeoutSeconds}s`));
  }, timeoutMs);
  try {
    const data = await fetchJson({
      url: imageGenerationEndpoint(baseUrl),
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
    const imageUrl = extractImageUrl(data);
    if (imageUrl) return imageUrl;
    const taskId = extractTaskId(data);
    if (taskId) return pollImageResult({ baseUrl, apiKey, taskId, signal: controller.signal, timeoutSeconds });
    throw new Error(`Image generation result did not include an image or task id: ${redactSensitiveText(JSON.stringify(data))}`);
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
  });
  if (!providers.length || providers.some((providerConfig) => !providerConfig.baseUrl || providerConfig.apiKeys.length === 0 || !providerConfig.model)) {
    throw new Error("missing baseUrl/apiKey/model for storyboard image generation");
  }
  const prompt = normalizePrompt(rawPrompt);
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
          referenceImages,
          aspectRatio: providerConfig.aspectRatio,
          resolution: providerConfig.resolution,
          timeoutSeconds: providerConfig.timeoutSeconds,
        });
        await writeStdout(JSON.stringify({ url }));
        process.exit(0);
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        attemptErrors.push(`${providerConfig.providerName} key ${keyIndex + 1}: ${redactSensitiveText(message)}`);
      }
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Failed after ${providers.length} provider(s), ${attemptedKeys} API key(s). Last error: ${redactSensitiveText(message)}. Attempts: ${attemptErrors.join(" | ")}`);
} catch (error) {
  const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
