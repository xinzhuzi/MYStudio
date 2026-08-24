// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useStudioStore } from "@/stores/studio/studio-store";
import {
  compileActiveDaojieStoryboardFramePrompt,
  resetExtendedManualContentCache,
  warmExtendedManualStyleTokens,
} from "./visual-manual-style-tokens";

const DAOJIE_MANUAL = [
  "<!-- storyboard-image-style-tokens:start -->",
  "Chinese ink wash painting style, gongbi linework",
  "<!-- storyboard-image-style-tokens:end -->",
  "<!-- storyboard-frame-negative:start -->",
  "watermark, low quality",
  "<!-- storyboard-frame-negative:end -->",
].join("\n");

describe("compileActiveDaojieStoryboardFramePrompt", () => {
  beforeEach(() => {
    resetExtendedManualContentCache();
    const { workflowConfig } = useStudioStore.getState();
    useStudioStore.setState({
      workflowConfig: { ...workflowConfig, visualManualId: "daojie_ink_guofeng" },
    });
  });

  it("道劫手册:分镜帧编译共享唯一 Avoid 与通用负面,产物带合同指纹", async () => {
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);

    const compiled = await compileActiveDaojieStoryboardFramePrompt("【画面】题材正文");

    expect(compiled).not.toBeNull();
    expect(compiled!.providerPrompt).toContain("【画面】题材正文");
    expect(compiled!.providerPrompt.match(/Avoid:/g)).toHaveLength(1);
    expect(compiled!.negative).toContain("watermark");
    expect(compiled!.negative).toContain("压缩伪影");
    expect(compiled!.contractVersion).toBe("ma-gongbi-v1");
  });

  it("非道劫手册返回 null,保持既有 enhanced 传输", async () => {
    const { workflowConfig } = useStudioStore.getState();
    useStudioStore.setState({
      workflowConfig: { ...workflowConfig, visualManualId: "2d_shonen" },
    });

    expect(await compileActiveDaojieStoryboardFramePrompt("正文")).toBeNull();
  });

  it("超 800 在网络前以可读错误拒绝", async () => {
    await warmExtendedManualStyleTokens(DAOJIE_MANUAL);

    await expect(compileActiveDaojieStoryboardFramePrompt("长".repeat(900))).rejects.toThrow("800");
  });

  it("手册未预热时帧负面 fail-empty,仅剩通用负面", async () => {
    const compiled = await compileActiveDaojieStoryboardFramePrompt("【画面】题材正文");

    expect(compiled).not.toBeNull();
    expect(compiled!.negative).not.toContain("watermark");
    expect(compiled!.negative).toContain("压缩伪影");
  });
});
