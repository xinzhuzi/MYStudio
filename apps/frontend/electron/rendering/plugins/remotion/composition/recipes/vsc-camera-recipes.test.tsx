// @vitest-environment jsdom
// vsc camera 配方分发测试(10-10 批B):id→组件闭集分发 + fail-closed 未知 id
// 渲染前拒;video 形态走 OffthreadVideo(章节装配路径的 current shot MP4)。
// 与 crash-zoom-punch.test.tsx 同式:mock remotion React 边界。

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

const currentFrame = { value: 0 };

vi.mock("remotion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("remotion")>()),
  useCurrentFrame: () => currentFrame.value,
  useVideoConfig: () => ({ width: 1920, height: 1080, fps: 30, durationInFrames: 90 }),
  AbsoluteFill: ({ children, style }: { children?: unknown; style?: unknown }) =>
    <div data-testid="absolute-fill" data-style={JSON.stringify(style)}>
      {children as never}
    </div>,
  Img: ({ src }: { src: string }) =>
    <img data-testid="img" src={src} alt="" />,
  OffthreadVideo: (props: { src: string; muted?: boolean; volume?: number }) =>
    <div data-testid="offthread-video" data-src={props.src} data-muted={String(props.muted)} data-volume={String(props.volume)} />,
}));

vi.mock("@remotion/motion-blur", () => ({
  CameraMotionBlur: ({ children }: { children?: unknown }) =>
    <div data-testid="motion-blur">{children as never}</div>,
}));

const { VscCameraRecipeClip, VSC_CAMERA_RECIPE_IDS } = await import("./vsc-camera-recipes");
const { VSC_CRASH_ZOOM_PUNCH_ID } = await import("./crash-zoom-punch");
const { VSC_DRONE_DIVE_LANDING_ID } = await import("./drone-dive-landing");

const SRC = "http://127.0.0.1:1/tok/storyboard-still";

describe("VscCameraRecipeClip 分发(能力矩阵真源)", () => {
  afterEach(() => cleanup());

  it("camera 五卡闭集与组件 id 常量一致(每 id 一组件,每组件一 id)", () => {
    expect(VSC_CAMERA_RECIPE_IDS).toContain(VSC_CRASH_ZOOM_PUNCH_ID);
    expect(VSC_CAMERA_RECIPE_IDS).toContain(VSC_DRONE_DIVE_LANDING_ID);
    expect(VSC_CAMERA_RECIPE_IDS).toHaveLength(5);
  });

  it("image 形态渲染组件媒体位(Img 消费 capability URL)", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(
      <VscCameraRecipeClip vsc={{ id: VSC_CRASH_ZOOM_PUNCH_ID }} src={SRC} kind="image" />,
    );
    expect(getByTestId("img").getAttribute("src")).toBe(SRC);
  });

  it("video 形态走 OffthreadVideo 且音轨参数透传(muted=false 章节镜语音)", () => {
    currentFrame.value = 0;
    const { getByTestId } = render(
      <VscCameraRecipeClip
        vsc={{ id: VSC_DRONE_DIVE_LANDING_ID }}
        src={SRC}
        kind="video"
        trimStartFrames={3}
        playbackRate={1}
        muted={false}
        volume={0.8}
      />,
    );
    const video = getByTestId("offthread-video");
    expect(video.getAttribute("data-src")).toBe(SRC);
    expect(video.getAttribute("data-muted")).toBe("false");
    expect(video.getAttribute("data-volume")).toBe("0.8");
  });

  it("未知 id fail-closed:渲染前 throw(spec §3;props 校验是第一闸,此为最后一闸)", () => {
    expect(() =>
      render(
        <VscCameraRecipeClip
          vsc={{ id: "vsc:bogus" as never }}
          src={SRC}
          kind="image"
        />,
      ),
    ).toThrow("fail-closed");
  });

  it("缺 vsc 字段同样拒(不静默回落默认配方)", () => {
    expect(() => render(<VscCameraRecipeClip src={SRC} kind="image" />)).toThrow("fail-closed");
  });
});
