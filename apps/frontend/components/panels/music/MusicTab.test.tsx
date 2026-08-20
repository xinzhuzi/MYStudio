// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MusicTab } from "./MusicTab";

const aiTextMock = vi.hoisted(() => vi.fn(async (_arg: { messages: Array<{ role: string; content: string }> }) => ({ success: true, text: "[Intro]\n长夜未央 天地苍茫\n\n[Verse]\nAI 主句一行" })));
const aiResolveMock = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/lib/ai/ai-manager", () => ({
  aiManager: { resolve: aiResolveMock, text: aiTextMock },
}));
import type { Music3GenRuntimeStatus } from "@/types/music3-gen";

function readyStatus(): Music3GenRuntimeStatus {
  return {
    setupStage: "ready",
    setupMessage: undefined,
    models: [],
    downloadStatus: "idle",
    downloadProgress: 0,
    downloadError: undefined,
    hostTotalRamGb: 128,
    mlxServ: {
      config: { weightsDir: "/w", binaryPath: "", port: 11273, preferredEngine: "mlxserv" },
      weightsReady: true,
      weightsReason: "",
      binaryPath: "/b/mlx-serve",
      binaryFound: true,
      serverRunning: false,
      serverStarting: false,
    },
  };
}

function installBridge(overrides: {
  status?: () => Music3GenRuntimeStatus | Promise<Music3GenRuntimeStatus>;
  musicDir?: (projectId: string) => Promise<{ dir?: string; error?: string }>;
  generate?: (payload: Record<string, unknown>) => Promise<{ status: string; outputPath?: string; durationS?: number; engine?: string; message?: string }>;
} = {}) {
  (window as { music3GenRuntime?: unknown }).music3GenRuntime = {
    status: async () => (overrides.status ? await overrides.status() : readyStatus()),
    musicDir: overrides.musicDir ?? (async (projectId: string) => ({ dir: `/projects/${projectId}/music` })),
    generate: overrides.generate ?? (async () => ({ status: "accepted", outputPath: "/projects/ma/music/song.wav", durationS: 29.9, engine: "mlx-serve" })),
  };
}

afterEach(() => {
  cleanup();
  delete (window as { music3GenRuntime?: unknown }).music3GenRuntime;
});

describe("MusicTab(工作台音乐生成)", () => {
  it("就绪:展示生成目录(动态拼接)+ 表单", async () => {
    installBridge();
    render(<MusicTab projectId="ma" projectName="道劫" />);
    expect(await screen.findByText(/引擎就绪/)).toBeTruthy();
    expect(await screen.findByText("/projects/ma/music")).toBeTruthy();
    expect(await screen.findByRole("button", { name: /生成整曲/ })).toBeTruthy();
  });

  it("权重未就绪:fail-closed 引导去设置,不出表单", async () => {
    installBridge({
      status: () => ({ ...readyStatus(), mlxServ: { ...readyStatus().mlxServ!, weightsReady: false, weightsReason: "未指定权重目录" } }),
    });
    render(<MusicTab projectId="ma" projectName="道劫" />);
    expect(await screen.findByText(/去设置/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /生成整曲/ })).toBeNull();
  });

  it("生成:payload 带 __PROJECT_MUSIC__ 哨兵 + projectId(渲染层不持绝对路径)", async () => {
    const generate = vi.fn(async () => ({ status: "accepted", outputPath: "/projects/ma/music/song.wav", durationS: 29.9, engine: "mlx-serve" }));
    installBridge({ generate });
    render(<MusicTab projectId="ma" projectName="道劫" />);
    fireEvent.click(await screen.findByRole("button", { name: /生成整曲/ }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({
      outputDir: "__PROJECT_MUSIC__",
      projectId: "ma",
      engine: "mlxserv",
    }));
    // 产物列表出现
    expect(await screen.findByText(/29\.9s/)).toBeTruthy();
  });
});

describe("MusicTab · 人声歌曲模式", () => {
  it("切模式:歌词编辑器+配方+标签快捷插入出现,[Verse] 可插入", async () => {
    installBridge();
    render(<MusicTab projectId="ma" projectName="道劫" />);
    fireEvent.click(await screen.findByRole("radio", { name: "人声歌曲" }));
    expect(await screen.findByLabelText(/歌词/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "国风·烟雨行舟系(女声空灵/笛筝主线/中速)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "[Verse]" }));
    const editor = screen.getByLabelText(/歌词/) as HTMLTextAreaElement;
    expect(editor.value).toContain("[Verse]");
  });

  it("生成:payload 带歌词与结构化 caption(含 Global Metadata),engine=mlxserv", async () => {
    const generate = vi.fn(async (_payload: Record<string, unknown>) => ({ status: "accepted", outputPath: "/projects/ma/music/song.wav", durationS: 9.9, engine: "mlx-serve" }));
    installBridge({ generate });
    render(<MusicTab projectId="ma" projectName="道劫" />);
    fireEvent.click(await screen.findByRole("radio", { name: "人声歌曲" }));
    const editor = await screen.findByLabelText(/歌词/);
    fireEvent.change(editor, { target: { value: "[Verse]\n长夜未央" } });
    fireEvent.click(screen.getByRole("button", { name: /生成整曲/ }));
    await waitFor(() => expect(generate).toHaveBeenCalledTimes(1));
    const payload = generate.mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(payload?.lyrics).toBe("[Verse]\n长夜未央");
    expect(String(payload?.prompt)).toContain("Global Metadata");
    expect(payload?.engine).toBe("mlxserv");
    expect(payload?.outputDir).toBe("__PROJECT_MUSIC__");
  });
});

describe("MusicTab · AI 写词(一键成曲)", () => {
  it("主题+点击 → aiManager 调用(带校准约束)→ 歌词回填编辑器", async () => {
    aiTextMock.mockClear();
    installBridge();
    render(<MusicTab projectId="ma" projectName="道劫" />);
    fireEvent.click(await screen.findByRole("radio", { name: "人声歌曲" }));
    fireEvent.click(screen.getByText(/AI 写词\(主题/)); // 展开折叠区(summary)
    fireEvent.change(screen.getByLabelText(/创作主题/), { target: { value: "《道劫》片头曲:少年血仇逆天" } });
    fireEvent.click(screen.getByRole("button", { name: /^AI 写词$/ }));
    await waitFor(() => expect(aiTextMock).toHaveBeenCalledTimes(1));
    const arg = aiTextMock.mock.calls[0]?.[0] as { messages: Array<{ role: string; content: string }> };
    expect(arg.messages[0]?.content).toContain("[Intro] [Verse] [Chorus] [Bridge] [Outro]");
    expect(arg.messages[1]?.content).toContain("少年血仇逆天");
    expect(arg.messages[1]?.content).toContain("第一约束");
    const editor = await screen.findByLabelText(/歌词/);
    expect((editor as HTMLTextAreaElement).value).toContain("长夜未央");
  });

  it("云端 AI 未配置 → fail-closed:不发起 LLM 调用", async () => {
    aiResolveMock.mockReturnValueOnce(false);
    aiTextMock.mockClear();
    installBridge();
    render(<MusicTab projectId="ma" projectName="道劫" />);
    fireEvent.click(await screen.findByRole("radio", { name: "人声歌曲" }));
    fireEvent.click(screen.getByText(/AI 写词\(主题/));
    fireEvent.change(screen.getByLabelText(/创作主题/), { target: { value: "测试主题" } });
    fireEvent.click(screen.getByRole("button", { name: /^AI 写词$/ }));
    await waitFor(() => expect(aiResolveMock).toHaveBeenCalled());
    expect(aiTextMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/歌词/) as HTMLTextAreaElement | null).toBeNull;
  });
});
