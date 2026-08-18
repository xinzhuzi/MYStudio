// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SeriesMeta } from "@/types/script";
import { OverviewPanel } from "./index";

// MdEditor 在 jsdom 里不可靠，用最小替身（值展示 + 回写）
vi.mock("md-editor-rt", () => ({
  MdEditor: ({ modelValue, onChange }: { modelValue: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="pref-editor"
      value={modelValue}
      onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
    />
  ),
}));

const mocks = vi.hoisted(() => ({
  updateSeriesMeta: vi.fn(),
  addEpisodeBundle: vi.fn(),
  updateEpisodeBundle: vi.fn(),
  enterEpisode: vi.fn(),
  setActiveTab: vi.fn(),
  meta: null as SeriesMeta | null,
  rawScript: "" as string,
}));

vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: {
    text: vi.fn(async () => ({
      success: true,
      text: JSON.stringify({ logline: "AI 建议的一句话概括", era: "古代仙侠" }),
    })),
  },
}));

vi.mock("@/stores/project/project-store", () => ({
  useProjectStore: () => ({ activeProjectId: "project-1" }),
}));

vi.mock("@/stores/script/script-store", () => ({
  useScriptStore: () => ({
    updateSeriesMeta: mocks.updateSeriesMeta,
    addEpisodeBundle: mocks.addEpisodeBundle,
    updateEpisodeBundle: mocks.updateEpisodeBundle,
  }),
  useActiveScriptProject: () => ({
    seriesMeta: mocks.meta,
    episodeRawScripts: [],
    scriptData: null,
    rawScript: mocks.rawScript,
  }),
}));

vi.mock("@/stores/navigation/media-panel-store", () => ({
  useMediaPanelStore: () => ({
    enterEpisode: mocks.enterEpisode,
    setActiveTab: mocks.setActiveTab,
  }),
}));

vi.mock("@/components/ui/resizable", () => ({
  ResizablePanelGroup: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ResizablePanel: ({ children }: { children: ReactNode }) => (
    <section>{children}</section>
  ),
  ResizableHandle: () => <div data-testid="resize-handle" />,
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  mocks.meta = {
    title: "原始标题",
    characters: [],
    keyItems: [{ name: "古剑", desc: "旧描述" }],
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("OverviewPanel", () => {
  it("saves single-line metadata on Enter", () => {
    render(<OverviewPanel />);

    fireEvent.click(screen.getByText("原始标题"));
    const input = screen.getByDisplayValue("原始标题");
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.updateSeriesMeta).toHaveBeenCalledWith("project-1", {
      title: "新标题",
    });
  });

  it("cancels an inline edit on Escape without saving", () => {
    render(<OverviewPanel />);

    fireEvent.click(screen.getByText("原始标题"));
    const input = screen.getByDisplayValue("原始标题");
    fireEvent.change(input, { target: { value: "不应保存" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(mocks.updateSeriesMeta).not.toHaveBeenCalled();
    expect(screen.getAllByText("原始标题").length).toBeGreaterThan(0);
  });

  it("updates one named entity without mutating its siblings", () => {
    mocks.meta = {
      ...mocks.meta!,
      keyItems: [
        { name: "古剑", desc: "旧描述" },
        { name: "玉印", desc: "保留描述" },
      ],
    };
    render(<OverviewPanel />);

    fireEvent.click(screen.getByText("旧描述"));
    const input = screen.getByDisplayValue("旧描述");
    fireEvent.change(input, { target: { value: "新描述" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.updateSeriesMeta).toHaveBeenCalledWith("project-1", {
      keyItems: [
        { name: "古剑", desc: "新描述" },
        { name: "玉印", desc: "保留描述" },
      ],
    });
  });

  it("navigates to production stage tab when clicking '进入阶段' button", () => {
    mocks.meta = null; // empty project triggers overview workflow/stage guide view
    render(<OverviewPanel />);

    const buttons = screen.getAllByRole("button", { name: /进入阶段/ });
    expect(buttons.length).toBeGreaterThan(0);
    fireEvent.click(buttons[0]);
    expect(mocks.setActiveTab).toHaveBeenCalledWith("studio");
  });

  it("opens the author preference editor from the overview header and saves via app-level storage", async () => {
    render(<OverviewPanel />);

    const entry = screen.getByRole("button", { name: /作者偏好/ });
    expect(entry).toBeTruthy();

    const setItem = vi.fn(async () => true);
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => "# 作者偏好\n\n## 改编口味\n快节奏\n",
      setItem,
    };
    fireEvent.click(entry);
    // 对话框副标题说明应用级语义
    expect(await screen.findByText(/全应用生效/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^保存$/ }));
    await waitFor(() =>
      expect(setItem).toHaveBeenCalledWith("author-preference.md", expect.stringContaining("改编口味")),
    );
    delete (window as unknown as { fileStorage?: unknown }).fileStorage;
  });

  it("metadata sections stack in a single vertical column (裁定:元数据控件不横排)", () => {
    render(<OverviewPanel />);
    // 元数据卡的内容容器:竖向 space-y-4,含全部 SectionCard 且无任何 grid 列类
    // 从「地理设定」卡片(SectionCard 渲染为 div.rounded-lg.border)向上取直接父容器
    const geoCard = [...document.querySelectorAll("div.rounded-lg.border")].find((el) =>
      el.querySelector("svg") && el.textContent?.trimStart().startsWith("地理设定"),
    );
    const metaContent = geoCard?.parentElement ?? null;
    expect(metaContent).toBeTruthy();
    expect(metaContent?.className).not.toMatch(/grid/);
    // 各区块按 DOM 子元素顺序竖排:故事核心 → 世界观 → 制作设定 → 角色 → 地理设定
    const order = ["故事核心", "世界观", "制作设定", "角色", "地理设定"];
    const children = [...(metaContent?.children ?? [])];
    const positions = order.map((label) =>
      children.findIndex((child) => child.textContent?.includes(label)),
    );
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("characters render vertically in full with edit/delete/add wired to updateSeriesMeta", async () => {
    mocks.meta = {
      title: "道劫",
      characters: [
        { id: "c1", name: "晏燎", gender: "男", role: "灭族孤儿出身的底层剑修，创立万劫圣宗；跨越五系剑道全修，终证「万道归真」，从复仇者成长为万界共主。", tags: ["#男主"] },
        { id: "c2", name: "独孤剑尘", gender: "男", role: "挚友、护道者与剑术启蒙恩师；血祭夜为救晏燎碎裂剑心，赠归元古剑。" + "很长的身份描述".repeat(30), tags: ["#恩师"] },
      ],
    };
    render(<OverviewPanel />);

    // 身份描述全文展示(旧实现 line-clamp-2 也仍在 DOM,故断言首尾都在文本流)
    const text = document.body.textContent ?? "";
    expect(text).toContain("灭族孤儿出身的底层剑修");
    expect(text).toContain("万界共主");
    expect(text).toContain("血祭夜为救晏燎碎裂剑心");
    // 竖向排列:角色列表容器是 space-y-2 竖向栈,无 grid 列类
    const charsList = [...document.querySelectorAll("div.space-y-2")].find((el) =>
      el.querySelector('[title="删除角色"]') && el.textContent?.includes("晏燎"),
    );
    expect(charsList).toBeTruthy();
    expect(charsList?.className).not.toMatch(/grid/);
    // 添加角色 → updateSeriesMeta 收到追加后的数组
    fireEvent.click(screen.getByRole("button", { name: /添加角色/ }));
    await waitFor(() => {
      const call = mocks.updateSeriesMeta.mock.calls.at(-1)?.[1] as { characters?: { name: string }[] };
      expect(call.characters?.at(-1)?.name).toBe("新角色");
      expect(call.characters).toHaveLength(3);
    });
    // 删除第二个角色
    const deleteButtons = screen.getAllByTitle("删除角色");
    fireEvent.click(deleteButtons[1]);
    await waitFor(() => {
      const call = mocks.updateSeriesMeta.mock.calls.at(-1)?.[1] as { characters?: { id: string }[] };
      expect(call.characters).toHaveLength(1);
      expect(call.characters?.[0]?.id).toBe("c1");
    });
  });

  it("full-meta branch renders the workflow portal above the metadata header (R1 布局裁定)", () => {
    render(<OverviewPanel />);
    const body = document.body;
    const text = body.textContent ?? "";
    expect(text).toContain("进入工作流");
    expect(text).toContain("项目概览");
    expect(text).toContain("制作阶段");
    // 门户区 DOM 顺序在概览头部之前
    const enterWorkflow = [...body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("进入工作流"),
    );
    const headerH2 = [...body.querySelectorAll("h2")].find((h) => h.textContent?.includes("项目概览"));
    expect(enterWorkflow && headerH2).toBeTruthy();
    expect(enterWorkflow!.compareDocumentPosition(headerH2!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("AI 填充：跳过问答生成 → 预览 → 确认写入 updateSeriesMeta（手填 genre 不被覆盖）", async () => {
    // 素材只认记忆库(08-18 裁定:概览不引入章节内容,剧本正文不作素材)
    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => "# 作者偏好\n\n## 改编口味\n快节奏强钩子\n",
      setItem: vi.fn(async () => true),
    };
    render(<OverviewPanel />);

    fireEvent.click(screen.getByRole("button", { name: /AI 填充/ }));
    // R3 问答弹窗：答案不落盘的提示 + 跳过入口
    expect(await screen.findByText(/只用于本次，不保存/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /跳过问题直接生成/ }));

    // R2 预览弹窗
    expect(await screen.findByText(/确认后写入/)).toBeTruthy();
    expect(await screen.findByText(/AI 建议的一句话概括/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /确认填充/ }));

    await waitFor(() =>
      expect(mocks.updateSeriesMeta).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({ logline: "AI 建议的一句话概括" }),
      ),
    );
    // genre 已手填「武侠」→ 默认不勾选覆盖
    const genreCall = mocks.updateSeriesMeta.mock.calls.at(-1)?.[1] as Record<string, unknown>;
    expect(genreCall.genre).toBeUndefined();
    delete (window as unknown as { fileStorage?: unknown }).fileStorage;
  });

  it("shows the author preference entry in the no-meta guide branch too", async () => {
    // 回归:无 seriesMeta 的项目走「项目入口」导览分支,入口曾随条件头部整个消失
    mocks.meta = null;
    render(<OverviewPanel />);

    expect(screen.getByText(/项目入口/)).toBeTruthy();
    const entry = screen.getByRole("button", { name: /作者偏好/ });
    fireEvent.click(entry);

    (window as unknown as { fileStorage?: unknown }).fileStorage = {
      getItem: async () => null,
      setItem: vi.fn(async () => true),
    };
    expect(await screen.findByText(/全应用生效/)).toBeTruthy();
    delete (window as unknown as { fileStorage?: unknown }).fileStorage;
  });
});
