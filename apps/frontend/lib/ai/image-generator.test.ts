import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAPIConfigStore } from "@/stores/ai/api-config-store";
import { useAppSettingsStore } from "@/stores/app/app-settings-store";
import { resetFeatureRoundRobin } from "./feature-router";
import {
  generateCharacterImage,
  generatePropImage,
  generateSceneImage,
  submitGridImageRequest,
  pollTaskStatus,
} from "./image-generator";
import {
  extractDirectImageUrl,
  normalizeResponseUrl,
  toDataImageUrl,
} from "./image-response";
import { setLocalImageTokenForTests } from "@/lib/assist/image-studio/local-image-token";
import { IMAGE_SUBMIT_TIMEOUT_MS, LOCAL_IMAGE_SUBMIT_TIMEOUT_MS, imageSubmitTimeoutForProvider } from "./image-generator-shared";

describe("image response normalization", () => {
  it("normalizes direct URLs across provider response shapes", () => {
    expect(normalizeResponseUrl(["  https://cdn.example/image.png  "])).toBe("  https://cdn.example/image.png  ");
    expect(normalizeResponseUrl("  ")).toBeUndefined();
    expect(extractDirectImageUrl({ data: [{ image_url: "https://cdn.example/image.png" }] })).toBe("https://cdn.example/image.png");
    expect(extractDirectImageUrl({ output_url: "https://cdn.example/output.png" })).toBe("https://cdn.example/output.png");
  });

  it("normalizes base64 payloads with provider formats", () => {
    expect(toDataImageUrl("aGVsbG8=", "jpg")).toBe("data:image/jpeg;base64,aGVsbG8=");
    expect(extractDirectImageUrl({ data: [{ b64_json: "aGVsbG8=" }], output_format: "webp" })).toBe("data:image/webp;base64,aGVsbG8=");
    expect(toDataImageUrl("data:image/png;base64,aGVsbG8=", "jpg")).toBe("data:image/png;base64,aGVsbG8=");
  });
});

const provider = {
  id: "fanren",
  platform: "custom",
  name: "凡人",
  baseUrl: "https://console.fanrenapi.eu.cc/v1",
  apiKey: "sk-test",
  model: ["gpt-image-2"],
};

function configureImageProvider() {
  useAPIConfigStore.setState({
    providers: [provider],
    featureBindings: {
      character_generation: ["fanren:gpt-image-2"],
    },
    modelEndpointTypes: {
      "gpt-image-2": ["openai"],
    },
  } as never);
}

function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }) {
  const text = JSON.stringify(body);
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: "",
    text: async () => text,
    json: async () => JSON.parse(text),
    clone: () => ({ text: async () => text }),
  };
}

describe("generateCharacterImage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetFeatureRoundRobin();
    configureImageProvider();
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fails with a precise configuration error before fetch when no character provider is bound", async () => {
    const fetchMock = vi.fn();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    useAPIConfigStore.setState({
      providers: [],
      featureBindings: {},
      modelEndpointTypes: {},
    } as never);

    await expect(generateCharacterImage({
      prompt: "unconfigured character",
    })).rejects.toThrow("请先在设置中为「角色生成」功能绑定 API 供应商");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith("[FeatureRouter] No provider bound for feature: character_generation");
  });

  it("accepts OpenAI-compatible b64_json image responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "aGVsbG8=" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({
      prompt: "simple stone",
      aspectRatio: "16:9",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://console.fanrenapi.eu.cc/v1/images/generations",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("falls back to chat/completions when the images endpoint gateway-fails (502 non-JSON)", async () => {
    // 08-24 qkmss 实态: images 端点 502 非 JSON,chat/completions 返回
    // markdown 内嵌 base64 图;链B 经 tryGptImageFallbackChannels(job→chat)兜底
    const fetchMock = vi.fn().mockImplementation(async (url: string | URL) => {
      const target = String(url);
      if (target.endsWith("/chat/completions")) {
        return jsonResponse({
          choices: [{ message: { role: "assistant", content: "![image_1](data:image/png;base64,aGVsbG8=)" } }],
        });
      }
      return {
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: async () => "error code: 502",
        json: async () => { throw new SyntaxError("Unexpected token in JSON"); },
        clone: () => ({ text: async () => "error code: 502" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({
      prompt: "gateway fallback asset",
      aspectRatio: "16:9",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    const chatCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/chat/completions"));
    expect(chatCalls.length).toBeGreaterThan(0);
    const chatBody = JSON.parse(String(chatCalls[0]?.[1]?.body));
    expect(chatBody.model).toBe("gpt-image-2");
  }, 30000);

  it("does not try chat fallback on auth failures (401)", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => JSON.stringify({ error: { message: "Invalid API key" } }),
      json: async () => ({ error: { message: "Invalid API key" } }),
      clone: () => ({ text: async () => "{}" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateCharacterImage({
      prompt: "auth failure asset",
      aspectRatio: "16:9",
    })).rejects.toThrow();

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/chat/completions"))).toBe(false);
  }, 30000);

  it("blocks malformed references before ordinary generation reaches fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateCharacterImage({
      prompt: "broken reference",
      referenceImages: ["data:image/png;base64,%%%"],
    })).rejects.toThrow("data URI 格式无效");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks malformed references before grid generation reaches fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitGridImageRequest({
      model: "gpt-image-2",
      prompt: "broken grid reference",
      apiKey: "sk-test",
      baseUrl: "https://console.fanrenapi.eu.cc/v1",
      referenceImages: ["data:image/png;base64,%%%"],
    })).rejects.toThrow("data URI 格式无效");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks reference images when the selected Kling adapter cannot consume them", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitGridImageRequest({
      model: "kling-image",
      prompt: "identity locked character",
      apiKey: "sk-test",
      baseUrl: "https://relay.example.com/v1",
      referenceImages: ["https://cdn.example.com/reference.png"],
    })).rejects.toThrow("Kling 图片适配器不支持参考图");

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the standard size field for gpt-image models", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "aGVsbG8=" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({
      prompt: "old laborer character",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({
      model: "gpt-image-2",
      size: "2048x1152",
    });
    expect(requestBody.prompt).toContain("old laborer character");
    expect(requestBody.prompt).toContain("clean image");
    expect(requestBody.prompt).toContain("low visual noise");
    expect(requestBody).not.toHaveProperty("aspect_ratio");
    expect(requestBody).not.toHaveProperty("resolution");
  });

  it("uses global image size settings when a request omits size options", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "3:2",
      defaultResolution: "2K",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "aGVsbG8=" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({ prompt: "global default character" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.size).toBe("2016x1344");
  });

  it("keeps custom negative prompts in the gpt-image SDK request text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "aGVsbG8=" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({
      prompt: "old laborer character",
      negativePrompt: "no basket, no ragged backpack",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.prompt).toContain("Negative constraints");
    expect(requestBody.prompt).toContain("no basket");
    expect(requestBody.prompt).toContain("no ragged backpack");
    expect(requestBody.prompt).toContain("dirty texture");
    expect(requestBody.prompt).toContain("unwanted calligraphy");
  });

  it("retries gpt-image transport failures with a compact 1024 request before failing the binding", async () => {
    const longPrompt = [
      "男性角色四视图设定图，水墨国风，修仙古韵，工笔线描，写意晕染，宣纸绢本质感。",
      "年轻苦力，年轻男性，长期搬运灵矿，肩背紧绷，神情警惕，粗布短衫。",
      "character design sheet, character turnaround, front view, side view, back view.",
      "plain background, high quality production asset, no text, no watermark.",
    ].join("\n");
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          data: [{ b64_json: "aGVsbG8=" }],
          output_format: "png",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({
      prompt: longPrompt,
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(firstBody.size).toBe("2048x1152");
    expect(retryBody.size).toBe("1024x1024");
    expect(retryBody.prompt).toContain("避免文字和水印");
    expect(retryBody.prompt).toContain("dirty texture");
    expect(retryBody.prompt).toContain("unwanted calligraphy");
  });

  it("rotates to the next provider key when the gpt-image standard channel rejects the current key's group", async () => {
    const multiKeyProvider = {
      ...provider,
      id: "fanren-multi",
      apiKey: "sk-keyA\nsk-keyB",
    };
    useAPIConfigStore.setState({
      providers: [multiKeyProvider],
      featureBindings: {
        character_generation: ["fanren-multi:gpt-image-2"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
      },
    } as never);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      const auth = String(headers?.Authorization ?? headers?.authorization ?? "");
      if (auth.includes("sk-keyA")) {
        return jsonResponse(
          { error: { message: "分组 A 下模型 gpt-image-2 无可用渠道（distributor）" } },
          { ok: false, status: 503 },
        );
      }
      return jsonResponse({ data: [{ b64_json: "aGVsbG8=" }], output_format: "png" });
    });
    vi.stubGlobal("fetch", fetchMock);
    // 钉死 keyManager 的随机起始索引=0,确定性从 keyA(无渠道)起步,轮转分支必被覆盖
    vi.spyOn(Math, "random").mockReturnValue(0);

    const result = await generateCharacterImage({
      prompt: "管事",
      aspectRatio: "1:1",
      resolution: "1K",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    const auths = fetchMock.mock.calls.map((call) => {
      const headers = call[1]?.headers as Record<string, string> | undefined;
      return String(headers?.Authorization ?? headers?.authorization ?? "");
    });
    // 起步 keyA 必然被拒,轮转后 keyB(有生图渠道)必须接手并成功
    expect(auths.some((a) => a.includes("sk-keyA"))).toBe(true);
    expect(auths.some((a) => a.includes("sk-keyB"))).toBe(true);
    expect(auths[auths.length - 1]).toContain("sk-keyB");
  });

  it("uses the configured compatibility retry size for gpt-image transport failures", async () => {
    useAppSettingsStore.getState().setImageGenerationSettings({
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "3:4",
      compatibilityRetryResolution: "1K",
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          data: [{ b64_json: "aGVsbG8=" }],
          output_format: "png",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({
      prompt: "retry with configured size",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(retryBody.size).toBe("864x1152");
  });

  it("stops Mikoto after an ambiguous paid transport failure without compatibility or provider fallback", async () => {
    const mikotoProvider = {
      ...provider,
      id: "mikoto",
      name: "mikoto",
      baseUrl: "https://api.mikoto.vip/v1",
    };
    const backupProvider = {
      ...provider,
      id: "backup",
      name: "备用",
      baseUrl: "https://backup.example.com/v1",
      apiKey: "sk-backup",
      model: ["gpt-image-backup"],
    };
    useAPIConfigStore.setState({
      providers: [mikotoProvider, backupProvider],
      featureBindings: {
        character_generation: ["mikoto:gpt-image-2", "backup:gpt-image-backup"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
        "gpt-image-backup": ["openai"],
      },
    } as never);
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(generateCharacterImage({ prompt: "ambiguous paid transport" })).rejects.toThrow(
      "Mikoto 图片请求结果不确定",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.mikoto.vip/v1/images/generations");
  });

  it("stops Mikoto grid generation after one ambiguous paid transport request", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitGridImageRequest({
      model: "gpt-image-2",
      prompt: "ambiguous paid grid transport",
      apiKey: "sk-test",
      baseUrl: "https://api.mikoto.vip/v1",
    })).rejects.toThrow("Mikoto 图片请求结果不确定");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.mikoto.vip/v1/images/generations");
  });

  it("keeps a known Mikoto 403 diagnosable instead of marking it ambiguous", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: {
        message: "订阅额度不足或未配置订阅: subscription quota insufficient",
        code: "insufficient_user_quota",
      },
    }, { ok: false, status: 403 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitGridImageRequest({
      model: "gpt-image-2",
      prompt: "known paid grid rejection",
      apiKey: "sk-test",
      baseUrl: "https://api.mikoto.vip/v1",
    })).rejects.toThrow("订阅额度不足或未配置订阅");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not abort slow synchronous image generation at 60 seconds", async () => {
    vi.useFakeTimers();
    const capturedSignals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      const capturedSignal = init?.signal as AbortSignal | undefined;
      if (capturedSignal) capturedSignals.push(capturedSignal);
      return new Promise((_resolve, reject) => {
        capturedSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });
    }));

    const generation = generateCharacterImage({
      prompt: "slow image",
      aspectRatio: "16:9",
    });
    const rejection = generation.catch((error) => error);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(capturedSignals[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(120_000);
    await vi.waitFor(() => expect(capturedSignals.length).toBe(2));
    await vi.advanceTimersByTimeAsync(180_000);
    // 兜底链(job 提交 180s + chat 通道重试)也要在 fake timers 下走完,最终仍抛原始错误
    await vi.advanceTimersByTimeAsync(900_000);
    await expect(rejection).resolves.toMatchObject({ message: expect.stringContaining("API 请求超时(180s)") });
    await expect(rejection).resolves.toMatchObject({ message: expect.stringContaining("兜底通道也失败") });
  });

  it("surfaces subscription quota errors from OpenAI-compatible image providers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
        error: {
          message: "订阅额度不足或未配置订阅: subscription quota insufficient, need=5000",
          code: "insufficient_user_quota",
        },
      }, { ok: false, status: 403 })));

    await expect(generateCharacterImage({
      prompt: "old laborer character",
      aspectRatio: "16:9",
    })).rejects.toThrow("订阅额度不足或未配置订阅");
  });

  it("falls back to the async job channel when sync images has no channel", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((url: unknown) => {
      const target = String(url);
      if (target.includes("/v1/images/jobs/")) {
        return Promise.resolve(jsonResponse({
          job: { id: "task_job_x", status: "succeeded", assets: [{ proxy_url: "https://cdn.fanrenapi.com/x.png" }] },
        }));
      }
      if (target.endsWith("/v1/images/jobs")) {
        return Promise.resolve(jsonResponse({ job: { id: "task_job_x", status: "queued" } }));
      }
      return Promise.resolve(jsonResponse({
        error: {
          code: "model_not_found",
          message: "No available channel for model gpt-image-2 under group Codex-Pro (distributor)",
          type: "new_api_error",
        },
      }, { ok: false, status: 503 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateCharacterImage({
      prompt: "no channel fallback",
      aspectRatio: "16:9",
    });
    const assertion = expect(generation).resolves.toMatchObject({
      imageUrl: "https://cdn.fanrenapi.com/x.png",
      taskId: "task_job_x",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;

    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.endsWith("/v1/images/jobs"))).toBe(true);
    expect(calledUrls.some((url) => url.includes("/v1/images/jobs/task_job_x"))).toBe(true);
  });

  it("does not fall back to job or chat channels when the key is rejected", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: unknown) => Promise.resolve(jsonResponse({
      error: { message: "Invalid API key" },
    }, { ok: false, status: 401 })));
    vi.stubGlobal("fetch", fetchMock);

    const generation = generateCharacterImage({
      prompt: "rejected key",
      aspectRatio: "16:9",
    });
    const rejection = generation.catch((error) => error);
    await vi.advanceTimersByTimeAsync(30_000);
    const error = await rejection;

    expect(error.message).toContain("API Key");
    const calledUrls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(calledUrls.some((url) => url.includes("/v1/images/jobs"))).toBe(false);
    expect(calledUrls.some((url) => url.includes("chat/completions"))).toBe(false);
  });

  it("tries the next bound image model when the current binding cannot generate", async () => {
    const backupProvider = {
      id: "backup",
      platform: "custom",
      name: "备用",
      baseUrl: "https://backup.example.com/v1",
      apiKey: "sk-backup",
      model: ["gpt-image-backup"],
    };
    useAPIConfigStore.setState({
      providers: [provider, backupProvider],
      featureBindings: {
        character_generation: ["fanren:gpt-image-2", "backup:gpt-image-backup"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
        "gpt-image-backup": ["openai"],
      },
    } as never);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
          error: {
            message: "订阅额度不足或未配置订阅: subscription quota insufficient, need=5000",
            code: "insufficient_user_quota",
          },
        }, { ok: false, status: 403 }))
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({
          data: [{ b64_json: "aGVsbG8=" }],
          output_format: "png",
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({
      prompt: "old laborer character",
      aspectRatio: "16:9",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://console.fanrenapi.eu.cc/v1/images/generations");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://backup.example.com/v1/images/generations");
  });

  it("uses the scene_generation binding for scene image generation", async () => {
    const sceneProvider = {
      ...provider,
      id: "scene-provider",
      name: "场景供应商",
      baseUrl: "https://scene.example.com/v1",
      model: ["scene-image-model"],
    };
    useAPIConfigStore.setState({
      providers: [provider, sceneProvider],
      featureBindings: {
        character_generation: ["fanren:gpt-image-2"],
        scene_generation: ["scene-provider:scene-image-model"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
        "scene-image-model": ["image-generation"],
      },
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "c2NlbmU=" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSceneImage({
      prompt: "ancient mine scene",
      aspectRatio: "16:9",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,c2NlbmU=");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://scene.example.com/v1/images/generations");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.model).toBe("scene-image-model");
  });

  it("uses the prop_generation binding for prop image generation", async () => {
    const propProvider = {
      ...provider,
      id: "prop-provider",
      name: "道具供应商",
      baseUrl: "https://prop.example.com/v1",
      model: ["prop-image-model"],
    };
    useAPIConfigStore.setState({
      providers: [provider, propProvider],
      featureBindings: {
        character_generation: ["fanren:gpt-image-2"],
        prop_generation: ["prop-provider:prop-image-model"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
        "prop-image-model": ["image-generation"],
      },
    } as never);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "cHJvcA==" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generatePropImage({
      prompt: "ancient broken sword prop",
      aspectRatio: "16:9",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,cHJvcA==");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://prop.example.com/v1/images/generations");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.model).toBe("prop-image-model");
  });

  it("falls back to the image generation binding when scene_generation is not separately bound", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({
        data: [{ b64_json: "c2NlbmU=" }],
        output_format: "png",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateSceneImage({
      prompt: "ancient inn room",
      aspectRatio: "16:9",
      resolution: "2K",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,c2NlbmU=");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://console.fanrenapi.eu.cc/v1/images/generations");
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.model).toBe("gpt-image-2");
    expect(requestBody.prompt).toContain("ancient inn room");
  });
});

describe("feature 口本地通道令牌注入(1011 断点A)", () => {
  const localImageProvider = {
    id: "manying-local-image",
    platform: "manying-local-image",
    name: "本地图片生成",
    baseUrl: "http://127.0.0.1:17595",
    apiKey: "manying-local-image",
    model: ["qwen-image-2-1"],
    capabilities: ["image_generation"],
  };

  function configureLocalImageProvider() {
    useAPIConfigStore.setState({
      providers: [localImageProvider],
      featureBindings: {
        character_generation: ["manying-local-image:qwen-image-2-1"],
      },
      modelEndpointTypes: {
        "qwen-image-2-1": ["image-generation"],
      },
    } as never);
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    resetFeatureRoundRobin();
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setLocalImageTokenForTests(null);
  });

  it("本地通道请求携带装机随机真令牌,不再发占位 key(mock 桥)", async () => {
    configureLocalImageProvider();
    // mock 桥:模拟 imageGenRuntime.localImageToken IPC 返回装机随机 UUID
    setLocalImageTokenForTests(() => "uuid-token-from-bridge");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: "bG9jYWw=", output_format: "png" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({
      prompt: "资产生图走本地通道",
      aspectRatio: "1:1",
    });

    expect(result.imageUrl).toBe("data:image/png;base64,bG9jYWw=");
    // 1011 sidecar 自愈进 feature 口后,本地链会先打一发 /health 探活——
    // 按 URL 定位生图调用(引擎测试同款约定),并锁全部流量不出本地口
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes("17595"))).toBe(true);
    const genCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/images/generations"));
    expect(genCall).toBeTruthy();
    const [url, init] = genCall!;
    // T2 装机实弹形态:POST 127.0.0.1:17595/v1/images/generations
    expect(String(url)).toBe("http://127.0.0.1:17595/v1/images/generations");
    const requestBody = JSON.parse(String(init?.body));
    expect(requestBody.model).toBe("qwen-image-2-1");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer uuid-token-from-bridge");
    expect(headers.get("Authorization")).not.toContain("manying-local-image");
  });

  it("桥缺席(非 Electron)保留占位 key,fail-closed 语义不回退", async () => {
    configureLocalImageProvider();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: "bG9jYWw=", output_format: "png" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({ prompt: "无桥保留占位", aspectRatio: "1:1" });

    // /health 探活之外的生图调用仍持占位 key(探活不带鉴权,不在断言列)
    const genCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/v1/images/generations"));
    const headers = new Headers(genCall?.[1]?.headers);
    expect(headers.get("Authorization")).toBe("Bearer manying-local-image");
  });

  it("云端绑定不受本地令牌替换影响", async () => {
    useAPIConfigStore.setState({
      providers: [provider],
      featureBindings: {
        character_generation: ["fanren:gpt-image-2"],
      },
      modelEndpointTypes: {
        "gpt-image-2": ["openai"],
      },
    } as never);
    setLocalImageTokenForTests(() => "uuid-token-from-bridge");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      data: [{ b64_json: "aGVsbG8=", output_format: "png" }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateCharacterImage({ prompt: "云端不受影响", aspectRatio: "16:9" });

    expect(result.imageUrl).toBe("data:image/png;base64,aGVsbG8=");
    // SDK 通道头是小写 authorization(与既有 key 轮转用例同款取法)
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    const auth = headers.Authorization ?? headers.authorization;
    expect(auth).toBe("Bearer sk-test");
  });
});

describe("daojie ma-gongbi-v1 exact/raw provider transport", () => {
  const daojieProviderPrompt = "人物题材正文。风格底座（硬）：中国水彩水墨工笔画。\nAvoid: 水印、视觉噪点";

  beforeEach(() => {
    vi.restoreAllMocks();
    resetFeatureRoundRobin();
    useAppSettingsStore.getState().setImageGenerationSettings({
      defaultAspectRatio: "16:9",
      defaultResolution: "2K",
      compatibilityRetryEnabled: true,
      compatibilityRetryAspectRatio: "1:1",
      compatibilityRetryResolution: "1K",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gpt-image 标准通道 byte-exact 传输已编译道劫提示词", async () => {
    configureImageProvider();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: "aGVsbG8=" }], output_format: "png" }));
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({ prompt: daojieProviderPrompt, promptPolicy: "raw", aspectRatio: "16:9" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.prompt).toBe(daojieProviderPrompt);
    expect(requestBody.prompt).not.toContain("Negative constraints");
    expect(requestBody.prompt).not.toContain("clean image");
  });

  it("provider-extension 通道传输同一正文且不另发 negative_prompt", async () => {
    useAPIConfigStore.setState({
      providers: [{ ...provider, model: ["aigc-image-qwen"] }],
      featureBindings: { character_generation: ["fanren:aigc-image-qwen"] },
      modelEndpointTypes: { "aigc-image-qwen": ["aigc-image"] },
    } as never);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ url: "https://cdn.example/done.png" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({ prompt: daojieProviderPrompt, promptPolicy: "raw", aspectRatio: "16:9" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.prompt).toBe(daojieProviderPrompt);
    expect(requestBody.prompt).not.toContain("clean image");
    expect(requestBody.negative_prompt ?? "").toBe("");
  });

  it("chat completions 通道收到同一 provider-visible 正文", async () => {
    useAPIConfigStore.setState({
      providers: [{ ...provider, model: ["gemini-image-preview"] }],
      featureBindings: { character_generation: ["fanren:gemini-image-preview"] },
      modelEndpointTypes: { "gemini-image-preview": ["openai"] },
    } as never);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: [{ type: "image_url", image_url: { url: "https://cdn.example/chat.png" } }] } }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateCharacterImage({ prompt: daojieProviderPrompt, promptPolicy: "raw", aspectRatio: "16:9" });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const text = requestBody.messages[0].content[0].text;
    expect(text).toBe(daojieProviderPrompt);
  });

  it("grid 通道 raw 策略 byte-exact 传输已编译道劫分镜帧", async () => {
    configureImageProvider();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: [{ b64_json: "aGVsbG8=" }], output_format: "png" }));
    vi.stubGlobal("fetch", fetchMock);

    await submitGridImageRequest({
      model: "gpt-image-2",
      prompt: daojieProviderPrompt,
      promptPolicy: "raw",
      apiKey: "sk-test",
      baseUrl: "https://console.fanrenapi.eu.cc/v1",
      aspectRatio: "16:9",
    });

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.prompt).toBe(daojieProviderPrompt);
    expect(requestBody.prompt).not.toContain("clean image");
    expect(requestBody.prompt).not.toContain("Negative constraints");
  });

  it("raw 道劫提示词不触发兼容性改写重试", async () => {
    configureImageProvider();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }))
      .mockResolvedValue(jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      generateCharacterImage({ prompt: daojieProviderPrompt, promptPolicy: "raw", aspectRatio: "16:9" }),
    ).rejects.toThrow();

    // 无兼容性改写:所有已捕获请求(标准通道失败→job/chat 兜底通道)都携带原样 providerPrompt
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse(String(call[1]?.body));
      const promptText: string = typeof body.prompt === "string"
        ? body.prompt
        : String(body.messages?.[0]?.content?.[0]?.text ?? "");
      expect(promptText).toContain(daojieProviderPrompt);
      expect(promptText).not.toContain("clean image");
      expect(promptText).not.toContain("主体完整，构图简洁");
    }
  });
});

describe("pollTaskStatus contract", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the completed image URL", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "success", result: { images: [{ url: "https://cdn.test/a.png" }] } }),
    }));
    await expect(pollTaskStatus("task-1", "sk-test", "https://api.test/v1")).resolves.toBe("https://cdn.test/a.png");
  });

  it("surfaces provider task failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "failed", error: "render failed" }),
    }));
    await expect(pollTaskStatus("task-2", "sk-test", "https://api.test/v1")).rejects.toThrow("render failed");
  });

  it("does not retry non-idempotent polling failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "bad request" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(pollTaskStatus("task-400", "sk-test", "https://api.test/v1")).rejects.toThrow("400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out after the bounded polling window", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "processing" }),
    }));
    const pending = pollTaskStatus("task-3", "sk-test", "https://api.test/v1");
    const rejection = expect(pending).rejects.toThrow("图片生成超时");
    await vi.advanceTimersByTimeAsync(120 * 2000);
    await rejection;
  });

  it("passes AbortSignal to polling and aborts promptly", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    vi.stubGlobal("fetch", vi.fn((_url, init) => {
      signals.push(init?.signal as AbortSignal);
      return Promise.reject(controller.signal.reason);
    }));
    const pending = pollTaskStatus("task-4", "sk-test", "https://api.test/v1", undefined, undefined, undefined, controller.signal);
    controller.abort(new Error("cancelled"));
    await expect(pending).rejects.toThrow("cancelled");
    expect(signals[0]).toBe(controller.signal);
  });

  it("passes the caller signal to grid task polling GET", async () => {
    const controller = new AbortController();
    const previousEndpointTypes = useAPIConfigStore.getState().modelEndpointTypes;
    useAPIConfigStore.setState({
      modelEndpointTypes: { "grid-model": ["standard", "aigc-image"] },
    } as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ task_id: "grid-1" }] }),
      })
      .mockImplementationOnce((_url, init) => {
        expect(init?.signal).toBe(controller.signal);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "completed", url: "https://cdn.test/grid.png" }),
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(submitGridImageRequest({
        model: "grid-model",
        prompt: "grid prompt",
        apiKey: "sk-test",
        baseUrl: "https://api.test/v1",
        signal: controller.signal,
      })).resolves.toMatchObject({ imageUrl: "https://cdn.test/grid.png", taskId: "grid-1" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      useAPIConfigStore.setState({ modelEndpointTypes: previousEndpointTypes } as never);
    }
  });

  it("passes the caller signal to Kling submit and polling", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const previousEndpointTypes = useAPIConfigStore.getState().modelEndpointTypes;
    useAPIConfigStore.setState({ modelEndpointTypes: {} } as never);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: { task_id: "kling-1" } }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { task_status: "succeed", task_result: { images: [{ url: "https://cdn.test/kling.png" }] } } }),
      });
    vi.stubGlobal("fetch", fetchMock);

    try {
      const pending = submitGridImageRequest({
        model: "kling-image",
        prompt: "kling prompt",
        apiKey: "sk-test",
        baseUrl: "https://api.test/v1",
        signal: controller.signal,
      });
      await vi.advanceTimersByTimeAsync(2000);
      await expect(pending).resolves.toMatchObject({ imageUrl: "https://cdn.test/kling.png", taskId: "kling-1" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
      expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
    } finally {
      useAPIConfigStore.setState({ modelEndpointTypes: previousEndpointTypes } as never);
    }
  });
});

describe("imageSubmitTimeoutForProvider (1011 断点C:本地通道提交超时豁免)", () => {
  it("本地 platform 口径豁免 900s", () => {
    expect(imageSubmitTimeoutForProvider({ platform: "manying-local-image", baseUrl: "http://127.0.0.1:17595" })).toBe(900_000);
  });

  it("本地 baseUrl 口径(带尾斜杠/空白)同样豁免", () => {
    expect(imageSubmitTimeoutForProvider({ platform: "custom", baseUrl: "http://127.0.0.1:17595/" })).toBe(900_000);
    expect(imageSubmitTimeoutForProvider({ platform: undefined, baseUrl: "  http://127.0.0.1:17595//  " })).toBe(900_000);
  });

  it("云端与其他/缺省维持 180s", () => {
    expect(imageSubmitTimeoutForProvider({ platform: "openai", baseUrl: "https://api.openai.com" })).toBe(180_000);
    expect(imageSubmitTimeoutForProvider(undefined)).toBe(180_000);
    expect(imageSubmitTimeoutForProvider(null)).toBe(180_000);
  });

  it("导出常量口径:云端 180s / 本地 900s(对齐自由口本地链)", () => {
    expect(IMAGE_SUBMIT_TIMEOUT_MS).toBe(180_000);
    expect(LOCAL_IMAGE_SUBMIT_TIMEOUT_MS).toBe(900_000);
  });
});
