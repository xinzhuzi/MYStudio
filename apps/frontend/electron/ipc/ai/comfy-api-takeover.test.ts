import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  COMFY_API_TAKEOVER_ENV_BASE,
  COMFY_API_TAKEOVER_ENV_TOKEN,
  comfyApiTakeoverEnv,
} from "./comfy-api-takeover";

describe("comfy-api-takeover 配置位与 python 侧契约", () => {
  it("env 名配对引擎侧读取点(engine_manager/cloud_takeover)防双家漂移", () => {
    const engineManager = readFileSync(
      new URL("../../../../backend/engines/comfyui/engine_manager.py", import.meta.url),
      "utf8",
    );
    const cloudTakeover = readFileSync(
      new URL("../../../../backend/engines/comfyui/my_nodes/cloud_takeover.py", import.meta.url),
      "utf8",
    );
    expect(COMFY_API_TAKEOVER_ENV_BASE).toBe("MYSTUDIO_COMFY_API_BASE");
    expect(COMFY_API_TAKEOVER_ENV_TOKEN).toBe("MYSTUDIO_COMFY_API_TOKEN");
    expect(engineManager).toContain(`MANAGED_COMFY_API_BASE_ENV = "${COMFY_API_TAKEOVER_ENV_BASE}"`);
    expect(engineManager).toContain('COMFY_API_BASE_FLAG = "--comfy-api-base"');
    expect(cloudTakeover).toContain(`TOKEN_ENV = "${COMFY_API_TAKEOVER_ENV_TOKEN}"`);
  });

  it("留空=零干预;填真源=成对注入(参数化验证,不锁死当前配置值)", () => {
    expect(comfyApiTakeoverEnv({ base: "", token: "" })).toEqual({});
    expect(comfyApiTakeoverEnv({ base: " https://gw.example ", token: " sk-x " })).toEqual({
      [COMFY_API_TAKEOVER_ENV_BASE]: "https://gw.example",
      [COMFY_API_TAKEOVER_ENV_TOKEN]: "sk-x",
    });
    // 只填一半=只注入一半(半配置的后果=网关收到无钥请求被拒,配置错误显式暴露)
    expect(comfyApiTakeoverEnv({ base: "https://gw.example", token: "" })).toEqual({
      [COMFY_API_TAKEOVER_ENV_BASE]: "https://gw.example",
    });
  });
});
