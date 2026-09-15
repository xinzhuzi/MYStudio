// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  ABVideoCompare,
  resolveVideoAlignment,
  seekVideoElement,
  startVideoSyncLoop,
  type ABVideoMeta,
} from "./ab-video-compare";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubMediaElementPlay() {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockReturnValue(Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
}

describe("resolveVideoAlignment(帧对齐裁定)", () => {
  const known = (frameCount: number, fps = 30): ABVideoMeta => ({ durationS: 6, fps, frameCount, frameCountEstimated: false });

  it("双源 frame_count 已知且相同 → 帧对齐", () => {
    const alignment = resolveVideoAlignment(known(180), known(180, 24));
    expect(alignment.mode).toBe("frame");
    expect(alignment.fpsA).toBe(30);
    expect(alignment.fpsB).toBe(24);
    expect(alignment.note).toBeUndefined();
  });

  it("帧数不同 → 按时间(注明);任一侧缺失/估算 → 按时间对齐(估)", () => {
    expect(resolveVideoAlignment(known(180), known(240)).mode).toBe("time");
    expect(resolveVideoAlignment(known(180), known(240)).note).toContain("帧数不同");
    const estimated: ABVideoMeta = { durationS: 6, fps: 30, frameCount: 180, frameCountEstimated: true };
    expect(resolveVideoAlignment(known(180), estimated).mode).toBe("time-estimated");
    expect(resolveVideoAlignment(known(180), estimated).note).toContain("估");
    expect(resolveVideoAlignment(null, known(180)).mode).toBe("time-estimated");
    expect(resolveVideoAlignment().mode).toBe("time-estimated");
  });
});

describe("seekVideoElement", () => {
  it("seeked 事件即解决;超时兜底也解决(不抛)", async () => {
    const video = document.createElement("video");
    const early = seekVideoElement(video, 3, 100);
    video.dispatchEvent(new Event("seeked"));
    await expect(early).resolves.toBeUndefined();

    vi.useFakeTimers();
    try {
      const video2 = document.createElement("video");
      const late = seekVideoElement(video2, 3, 50);
      await vi.advanceTimersByTimeAsync(60);
      await expect(late).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startVideoSyncLoop(纯逻辑)", () => {
  function makeFakeRaf() {
    const queue: Array<() => void> = [];
    const requestFrame = vi.fn((callback: () => void) => {
      queue.push(callback);
      return queue.length;
    });
    const cancelFrame = vi.fn((handle: number) => {
      queue.splice(handle - 1, 1);
    });
    const flush = () => {
      const pending = queue.splice(0, queue.length);
      for (const callback of pending) callback();
    };
    return { queue, requestFrame, cancelFrame, flush };
  }

  it("漂移超阈值校正 B;帧对齐模式经 frame 换算", () => {
    const raf = makeFakeRaf();
    const master = document.createElement("video");
    const follower = document.createElement("video");
    master.currentTime = 2.0;
    follower.currentTime = 0;
    const loop = startVideoSyncLoop({
      master,
      follower,
      alignment: { mode: "time" },
      isCancelled: () => false,
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });
    raf.flush();
    expect(follower.currentTime).toBeCloseTo(2.0, 3);
    loop.stop();

    // 帧对齐:A 30fps 2.0s=60 帧 → B 24fps=2.5s
    const masterA = document.createElement("video");
    const followerB = document.createElement("video");
    masterA.currentTime = 2.0;
    followerB.currentTime = 0;
    startVideoSyncLoop({
      master: masterA,
      follower: followerB,
      alignment: { mode: "frame", fpsA: 30, fpsB: 24 },
      isCancelled: () => false,
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });
    raf.flush();
    expect(followerB.currentTime).toBeCloseTo(2.5, 3);
  });

  it("阈值内不校正;令牌失效即退出不再排程", () => {
    const raf = makeFakeRaf();
    const master = document.createElement("video");
    const follower = document.createElement("video");
    master.currentTime = 1.0;
    follower.currentTime = 1.02;
    let cancelled = false;
    const loop = startVideoSyncLoop({
      master,
      follower,
      alignment: { mode: "time" },
      isCancelled: () => cancelled,
      requestFrame: raf.requestFrame,
      cancelFrame: raf.cancelFrame,
    });
    raf.flush();
    expect(follower.currentTime).toBe(1.02); // 20ms 漂移在阈值内
    expect(raf.queue).toHaveLength(1); // 仍在排程
    cancelled = true; // 令牌失效
    raf.flush();
    expect(raf.queue).toHaveLength(0); // 旧循环退出,不再排程
    loop.stop();
  });
});

describe("ABVideoCompare 组件", () => {
  beforeEach(() => {
    stubMediaElementPlay();
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      width: 400, height: 240, x: 0, y: 0, top: 0, left: 0, bottom: 240, right: 400, toJSON: () => ({}),
    } as DOMRect));
  });

  it("双 video 叠放+滑帘:拖动更新分割线,clipPath 只露 A 的左半", () => {
    const { container } = render(<ABVideoCompare urlA="https://t/a.mp4" urlB="https://t/b.mp4" labelA="旧版" labelB="新版" />);
    const stage = screen.getByRole("slider", { name: "对比分割线位置" });
    expect(container.querySelector("[data-ab-video-a]")?.getAttribute("src")).toBe("https://t/a.mp4");
    expect(container.querySelector("[data-ab-video-b]")?.getAttribute("src")).toBe("https://t/b.mp4");
    expect(container.querySelector('[data-ab-video-label="a"]')?.textContent).toBe("旧版");
    expect(container.querySelector('[data-ab-video-label="b"]')?.textContent).toBe("新版");
    expect(stage.getAttribute("data-ab-video-stage")).toBe("50");

    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 120, clientY: 80 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 120, clientY: 80 });
    expect(stage.getAttribute("data-ab-video-stage")).toBe("30");
    const videoA = container.querySelector("[data-ab-video-a]") as HTMLVideoElement;
    expect(videoA.style.clipPath).toBe("inset(0 70% 0 0)");
  });

  it("无元数据=按时间对齐(估)提示;双源 frame_count 相同=帧对齐无提示", async () => {
    const { rerender } = render(<ABVideoCompare urlA="a.mp4" urlB="b.mp4" />);
    expect(screen.getByText("按时间对齐（估）")).toBeTruthy();

    rerender(
      <ABVideoCompare
        urlA="a.mp4"
        urlB="b.mp4"
        probeVideo={vi.fn(async (url) => (url === "a.mp4"
          ? { durationS: 6, fps: 30, frameCount: 180, frameCountEstimated: false }
          : { durationS: 6, fps: 30, frameCount: 180, frameCountEstimated: false }))}
      />,
    );
    await vi.waitFor(() => {
      expect(screen.queryByText("按时间对齐（估）")).toBeNull();
    });
    const stage = screen.getByRole("slider", { name: "对比分割线位置" });
    expect(stage.getAttribute("data-ab-video-align-mode")).toBe("frame");
  });

  it("播放按钮驱动双视频;声道三态与倍速作用到双 video", () => {
    const { container } = render(<ABVideoCompare urlA="a.mp4" urlB="b.mp4" />);
    const playButton = screen.getByText("播放");
    fireEvent.click(playButton);
    expect(screen.getByText("暂停")).toBeTruthy();
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);

    const videoA = container.querySelector("[data-ab-video-a]") as HTMLVideoElement;
    const videoB = container.querySelector("[data-ab-video-b]") as HTMLVideoElement;
    // 初始声道=A:B 静音
    expect(videoA.muted).toBe(false);
    expect(videoB.muted).toBe(true);

    fireEvent.change(screen.getByLabelText("声音来源"), { target: { value: "b" } });
    expect(videoA.muted).toBe(true);
    expect(videoB.muted).toBe(false);
    fireEvent.change(screen.getByLabelText("声音来源"), { target: { value: "mute" } });
    expect(videoA.muted).toBe(true);
    expect(videoB.muted).toBe(true);

    fireEvent.change(screen.getByLabelText("播放倍速"), { target: { value: "2" } });
    expect(videoA.playbackRate).toBe(2);
    expect(videoB.playbackRate).toBe(2);
  });

  it("播放/暂停切换后同步循环仍在岗(重播换令牌须重启循环,漂移校正不失效)", () => {
    stubMediaElementPlay();
    // 手动 rAF 队列:量化「循环是否死透」(死透=flush 后无人再排程)
    const queue: Array<() => void> = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: () => void) => {
      queue.push(callback);
      return queue.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => {
      queue.splice(handle - 1, 1);
    }));
    const flush = () => {
      const pending = queue.splice(0, queue.length);
      for (const callback of pending) callback();
    };

    const view = render(<ABVideoCompare urlA="a.mp4" urlB="b.mp4" />);
    flush();
    expect(queue).toHaveLength(1); // 初始循环在岗

    // 播放:togglePlay 令牌+1 杀旧循环——若无新循环接手,同步在播放中失效
    fireEvent.click(screen.getByText("播放"));
    flush();
    expect(queue).toHaveLength(1);

    const videoA = view.container.querySelector("[data-ab-video-a]") as HTMLVideoElement;
    const videoB = view.container.querySelector("[data-ab-video-b]") as HTMLVideoElement;
    videoA.currentTime = 3.3;
    videoB.currentTime = 0;
    flush();
    expect(videoB.currentTime).toBeCloseTo(3.3, 3); // 播放中漂移仍被校正

    // 暂停同理:循环换令牌后仍在岗
    fireEvent.click(screen.getByText("暂停"));
    flush();
    expect(queue).toHaveLength(1);

    view.unmount();
    flush();
    expect(queue).toHaveLength(0);
  });

  it("快速换源竞态(syncToken):旧 rAF 循环失效,只剩新源一条循环在跑且校正新 follower", async () => {
    // 手动 rAF 队列:精确控制排程计数,量化「旧循环是否死透」
    const queue: Array<() => void> = [];
    const requestFrame = vi.fn((callback: () => void) => {
      queue.push(callback);
      return queue.length;
    });
    const cancelFrame = vi.fn((handle: number) => {
      queue.splice(handle - 1, 1);
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);

    const view = render(<ABVideoCompare urlA="a1.mp4" urlB="b1.mp4" />);
    // 立即换源(第一轮循环还没 tick 过一次)
    view.rerender(<ABVideoCompare urlA="a2.mp4" urlB="b2.mp4" />);
    view.rerender(<ABVideoCompare urlA="a3.mp4" urlB="b3.mp4" />);

    const flush = () => {
      const pending = queue.splice(0, queue.length);
      for (const callback of pending) callback();
    };

    // 令牌防竞态核心断言:任意多轮 flush 后,在跑的循环只有一条(每次 flush 只再排程 1 帧)
    for (let round = 0; round < 3; round += 1) {
      flush();
      expect(queue).toHaveLength(1);
    }

    // 新源的 follower 被校正到新 master 的时刻(按时间对齐模式)
    const videoA = view.container.querySelector("[data-ab-video-a]") as HTMLVideoElement;
    const videoB = view.container.querySelector("[data-ab-video-b]") as HTMLVideoElement;
    expect(videoA.getAttribute("src")).toBe("a3.mp4");
    videoA.currentTime = 4.2;
    videoB.currentTime = 0;
    flush();
    expect(videoB.currentTime).toBeCloseTo(4.2, 3);

    // 卸载:循环彻底停止(无残留排程)
    view.unmount();
    flush();
    expect(queue).toHaveLength(0);
  });
});
