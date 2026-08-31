// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// 兄弟工作室 mock 成占位:本文件聚焦 FreedomView 容器接线,各 Studio 内部由各自测试覆盖。
vi.mock("./ImageStudio", () => ({ ImageStudio: () => <div data-testid="image-stub" /> }));
vi.mock("./VideoStudio", () => ({ VideoStudio: () => <div data-testid="video-stub" /> }));
vi.mock("./CinemaStudio", () => ({ CinemaStudio: () => <div data-testid="cinema-stub" /> }));
vi.mock("./TtsStudio", () => ({ TtsStudio: () => <div data-testid="tts-stub" /> }));

import { FreedomView, FREEDOM_STUDIO_MODES, isFreedomStudioMode } from "./FreedomView";

const STORAGE_KEY = "mystudio-freedom";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(STORAGE_KEY);
});

describe("FreedomView studio mode guard", () => {
  it("accepts exactly the five supported studio modes", () => {
    expect(FREEDOM_STUDIO_MODES).toEqual(["image", "video", "cinema", "tts", "music"]);
    for (const mode of FREEDOM_STUDIO_MODES) expect(isFreedomStudioMode(mode)).toBe(true);
  });

  it("rejects values outside the supported tabs", () => {
    expect(isFreedomStudioMode("unknown")).toBe(false);
    expect(isFreedomStudioMode("")).toBe(false);
  });
});

describe("FreedomView 渲染(08-31 音乐迁入后五工作室)", () => {
  it("渲染五个工作室 tab,含「🎵 音乐工作室」", () => {
    render(<FreedomView />);
    expect(screen.getByRole("tab", { name: /图片工作室/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /视频工作室/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /电影工作室/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /TTS/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /音乐工作室/ })).toBeTruthy();
  });

  it("切到音乐工作室:挂载 MusicStudio→MusicTab(无 bridge 空态),activeStudio 持久化为 music", () => {
    render(<FreedomView />);
    // Radix Tabs v1.1.21 automatic 激活走 onFocus(fireEvent.click/pointerdown 均无效)
    fireEvent.focus(screen.getByRole("tab", { name: /音乐工作室/ }));
    // MusicStudio 走真实链路:无 music3GenRuntime bridge 时 MusicTab 呈桌面限定空态
    expect(screen.getByText(/本地音乐生成仅在桌面应用中可用/)).toBeTruthy();
    // zustand persist 同步落 localStorage:验证「切走再切回/重启停留」的持久化基础
    expect(window.localStorage.getItem(STORAGE_KEY)).toContain('"activeStudio":"music"');
  });
});
