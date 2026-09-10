// @vitest-environment jsdom
// LocalModelOrb(09-10 拆双球)测试:本地模型球=沉浸视图专属导航枢纽。
// 覆盖:data 钩子/胶囊模式名/两分区默认收起与开合/模式切换落 freedom-store/
// 视图跳转落 media-panel-store/位置独立键(不写工作流球键)/无分镜面板入口。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalModelOrb } from "./LocalModelOrb";
import {
  LOCAL_MODEL_ORB_POSITION_KEY,
  WORKFLOW_ORB_POSITION_KEY,
} from "@/components/orbs";
import { useFreedomStore } from "@/stores/assist/freedom-store";
import { useMediaPanelStore } from "@/stores/navigation/media-panel-store";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  useFreedomStore.getState().setActiveStudio("comfy");
  useMediaPanelStore.setState({ activeTab: "freedom" });
});

const onModeChange = vi.fn();

function renderOrb(mode: "comfy" | "tts" = "comfy") {
  return render(<LocalModelOrb mode={mode} onModeChange={onModeChange} />);
}

function getOrb() {
  return screen.getByRole("button", { name: /本地模型导航/ });
}

function openPanel() {
  const orb = getOrb();
  fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(orb, { clientX: 21, clientY: 20 });
}

function expandSection(title: string) {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`^${title}$`) }),
  );
}

describe("LocalModelOrb(本地模型球)", () => {
  it("球本体 data 钩子+aria 名+胶囊显示当前模式名", () => {
    const { container } = renderOrb("comfy");
    const orb = getOrb();
    expect(orb.getAttribute("data-local-model-orb")).not.toBeNull();
    expect(
      container.querySelector("[data-orb-capsule]")?.textContent,
    ).toContain("ComfyUI 画布");
    renderOrb("tts");
  });

  it("胶囊跟随模式:tts 态显示「配音室」", () => {
    const { container } = renderOrb("tts");
    expect(
      container.querySelector("[data-orb-capsule]")?.textContent,
    ).toContain("配音室");
  });

  it("面板:两分区默认收起(09-10 裁定),标题行在场", async () => {
    renderOrb();
    openPanel();
    expect(await screen.findByRole("button", { name: /^本视图$/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^前往$/ })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "本视图" })).toBeNull();
    expect(screen.queryByRole("group", { name: "前往" })).toBeNull();
    expect(screen.queryByRole("button", { name: /配音室/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^设置$/ })).toBeNull();
  });

  it("展开「本视图」:模式切换回调触发(freedom-store 由宿主接线)", async () => {
    renderOrb();
    openPanel();
    expandSection("本视图");
    const ttsButton = await screen.findByRole("button", { name: /配音室/ });
    fireEvent.click(ttsButton);
    expect(onModeChange).toHaveBeenCalledWith("tts");
  });

  it("展开「前往」:视图跳转落 media-panel(概览)", async () => {
    renderOrb();
    openPanel();
    expandSection("前往");
    const entry = await screen.findByRole("button", { name: /^概览$/ });
    expect(entry.getAttribute("data-orb-nav-view")).toBe("overview");
    fireEvent.click(entry);
    expect(useMediaPanelStore.getState().activeTab).toBe("overview");
  });

  it("分区开合契约:data-state 随标题行点击翻转", async () => {
    renderOrb();
    openPanel();
    await screen.findByRole("button", { name: /^前往$/ });
    // 面板内容经 Radix 传送门挂 body,用 document 查(非 render container)
    const goto = document.querySelector("[data-orb-section='goto']");
    expect(goto?.getAttribute("data-state")).toBe("closed");
    expandSection("前往");
    expect(goto?.getAttribute("data-state")).toBe("open");
  });

  it("拖拽位移超过阈值不开面板(OrbShell 契约经业务球回归)", () => {
    renderOrb();
    const orb = getOrb();
    fireEvent.pointerDown(orb, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(orb, { clientX: 80, clientY: 90 });
    expect(screen.queryByRole("button", { name: /^本视图$/ })).toBeNull();
  });

  it("合成 click(smoke 路径)可开面板", async () => {
    renderOrb();
    fireEvent.click(getOrb());
    expect(await screen.findByRole("button", { name: /^本视图$/ })).toBeTruthy();
  });

  it("位置持久化独立键:拖拽吸附写本地模型球键,不碰工作流球键", () => {
    window.localStorage.setItem(
      WORKFLOW_ORB_POSITION_KEY,
      JSON.stringify({ x: 111, y: 222 }),
    );
    renderOrb();
    // jsdom 无 motion 布局,直接驱动键盘开合+断言键隔离:本地模型球默认不读工作流历史
    expect(
      window.localStorage.getItem(LOCAL_MODEL_ORB_POSITION_KEY),
    ).toBeNull();
    expect(
      JSON.parse(
        window.localStorage.getItem(WORKFLOW_ORB_POSITION_KEY) ?? "null",
      ),
    ).toEqual({ x: 111, y: 222 });
  });

  it("「前往」不含分镜面板入口(08-23 唯一入口裁定)", async () => {
    renderOrb();
    openPanel();
    expandSection("前往");
    await screen.findByRole("group", { name: "前往" });
    const entries = document.querySelectorAll("[data-orb-nav-view]");
    expect(entries.length).toBe(9);
    expect(document.body.textContent ?? "").not.toContain("分镜面板");
  });
});
