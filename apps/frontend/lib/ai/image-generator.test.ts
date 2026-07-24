import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAPIConfigStore } from "@/stores/api-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
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
    await expect(rejection).resolves.toMatchObject({ message: "API 请求超时" });
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
