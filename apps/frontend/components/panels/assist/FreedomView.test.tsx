// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
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
  it("accepts exactly the five supported studio modes (09-09 music 撤,音乐收敛 ComfyUI)", () => {
    expect(FREEDOM_STUDIO_MODES).toEqual(["image", "video", "cinema", "tts", "comfy"]);
    for (const mode of FREEDOM_STUDIO_MODES) expect(isFreedomStudioMode(mode)).toBe(true);
  });

  it("rejects values outside the supported tabs", () => {
    expect(isFreedomStudioMode("unknown")).toBe(false);
    expect(isFreedomStudioMode("")).toBe(false);
  });
});

describe("FreedomView 渲染(09-09 音乐撤后四+comfy 工作室)", () => {
  it("渲染四个内容工作室 tab+ComfyUI(09-09 音乐撤,音乐收敛 ComfyUI 原生)", () => {
    render(<FreedomView />);
    expect(screen.getByRole("tab", { name: /图片工作室/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /视频工作室/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /电影工作室/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /TTS/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /音乐工作室/ })).toBeNull();
  });
});
