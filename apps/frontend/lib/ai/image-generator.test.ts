import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAPIConfigStore } from "@/stores/api-config-store";
import { useAppSettingsStore } from "@/stores/app-settings-store";
import { resetFeatureRoundRobin } from "./feature-router";
import { generateCharacterImage, generatePropImage, generateSceneImage } from "./image-generator";

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
