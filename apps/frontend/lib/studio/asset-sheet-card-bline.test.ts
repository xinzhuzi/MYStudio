import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOperationId, logEvent } from "@/lib/diagnostics/logger";
import { ensureLocalImageSidecarRunning } from "@/lib/ai/image-generation-engine";
import { readImageAsBase64 } from "@/lib/media/image-storage";
import { saveGeneratedAssetImage, updateStoreWithResult } from "./asset-generation-store-writers";
import { SHEET_CARD_FORMATS, SHEET_CARD_FORMAT_DEFAULT } from "./asset-image-kind";
import {
  SHEET_CARD_BLINE_KIND,
  SHEET_CARD_BLINE_LAYOUT,
  SHEET_CARD_BLINE_MODEL,
  SHEET_CARD_BG,
  SHEET_CARD_TOTAL_STEPS,
  clearSheetCardBLineRecord,
  evaluateSheetCardGate,
  readSheetCardBLineRecord,
  replaceSheetCardKindImageAfterAcceptance,
  runSheetCardBLine,
  sanitizeSheetCardBLineRecord,
  setSheetCardBLineGateSamplerForTests,
  setSheetCardBLineStorageForTests,
  setSheetCardBLineTimingsForTests,
  writeSheetCardBLineRecord,
  type SheetCardBLineTaskRecord,
} from "./asset-sheet-card-bline";

/**
 * 1121 设定卡 B 线 i2i App 侧客户端逐态单测(PRD .trellis/tasks/11-21-asset-sheet-bline-i2i
 * 转移表逐行):契约面对齐 sidecar 实盘(image_gen/server.py「设定卡 B线 i2i」节:
 * POST /v1/images/sheet-i2i{model,prompt,reference_image,extra,taskId?};
 * GET /{id}→{status:running/partial-failed/cancelled/done,progress:{done,total}};
 * GET /{id}/result→{data:[{b64_json}]};POST /{id}/cancel)。
 */

vi.mock("@/lib/ai/local-image-token", () => ({
  getLocalImageToken: vi.fn(async () => "test-local-token"),
}));

vi.mock("@/lib/ai/image-generation-engine", () => ({
  ensureLocalImageSidecarRunning: vi.fn(async () => true),
}));

vi.mock("@/lib/media/image-storage", () => ({
  readImageAsBase64: vi.fn(),
}));

vi.mock("./asset-generation-store-writers", () => ({
  saveGeneratedAssetImage: vi.fn(),
  updateStoreWithResult: vi.fn(),
}));

vi.mock("@/lib/diagnostics/logger", () => ({
  createOperationId: vi.fn(() => "sheet-bline-test-op"),
  logEvent: vi.fn(),
}));

const ensureSidecarMock = vi.mocked(ensureLocalImageSidecarRunning);
const readImageAsBase64Mock = vi.mocked(readImageAsBase64);
const saveGeneratedAssetImageMock = vi.mocked(saveGeneratedAssetImage);

// 1122 门禁根修:默认给所有 done 流程用例注入合格采样器(实弹基线 3840×2160/方差 6648);
// 门禁 describe 内自行覆盖注入坏样本
beforeEach(() => {
  setSheetCardBLineGateSamplerForTests(async () => ({
    width: 3840,
    height: 2160,
    transparentRatio: 0,
    grayVariance: 6648,
  }));
});
afterEach(() => {
  setSheetCardBLineGateSamplerForTests(null);
});

type RecordStorageish = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function memoryStorage(): RecordStorageish {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
  };
}

/** server 任务态文档(task_status 面)。 */
function taskDoc(partial: Record<string, unknown>): Record<string, unknown> {
  return { taskId: "task-1", status: "running", progress: { done: 0, total: 14, percent: 0 }, ...partial };
}

interface FetchCall {
  url: string;
  method: string;
  body?: unknown;
  headers?: Record<string, string>;
}

function installFetchRouter(options: {
  submitResponse?: Record<string, unknown> | { status: number; json: Record<string, unknown> };
  polls?: Array<Record<string, unknown> | { status: number; json: Record<string, unknown> }>;
  resultResponse?: Record<string, unknown> | { status: number; json: Record<string, unknown> };
  cancelResponse?: Record<string, unknown>;
}) {
  const calls: FetchCall[] = [];
  const polls = [...(options.polls ?? [])];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const toResponse = (payload: Record<string, unknown> | { status: number; json: Record<string, unknown> }) => {
      // 任务态文档自带字符串 status 字段——HTTP 错误包仅认数字 status(防撞名)
      const isError = typeof (payload as { status?: unknown }).status === "number";
      const normalized = isError
        ? (payload as { status: number; json: Record<string, unknown> })
        : { status: 200, json: payload as Record<string, unknown> };
      return {
        ok: normalized.status < 400,
        status: normalized.status,
        json: async () => normalized.json,
      };
    };
    if (url.endsWith("/cancel") && (init?.method ?? "GET") === "POST") {
      return toResponse(options.cancelResponse ?? { cancelled: true, reason: "forwarded" });
    }
    if (url.includes("/result") && (init?.method ?? "GET") === "GET") {
      return toResponse(options.resultResponse ?? { data: [{ b64_json: "RklOQUw0Sw==" }] });
    }
    if (url.includes("?") && (init?.method ?? "GET") === "GET") {
      const next = polls.shift() ?? taskDoc({});
      return toResponse(next);
    }
    if (url.endsWith("/v1/images/sheet-i2i") && init?.method === "POST") {
      return toResponse(options.submitResponse ?? taskDoc({}));
    }
    throw new Error(`测试路由未覆盖:${init?.method ?? "GET"} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}

function baseInput(overrides: Partial<Parameters<typeof runSheetCardBLine>[0]> = {}) {
  return {
    assetId: "asset-role-1",
    assetName: "晏燎",
    subjectText: "北境剑修|玄色长衣|背负旧债",
    masterImageUrl: "data:image/png;base64,TUFTVEVS",
    assetType: "character" as const,
    category: "characters" as const,
    ...overrides,
  };
}

let storage: RecordStorageish;

beforeEach(() => {
  vi.clearAllMocks();
  storage = memoryStorage();
  setSheetCardBLineStorageForTests(storage);
  setSheetCardBLineTimingsForTests({ pollIntervalMs: 1, maxPollDurationMs: 60_000, maxConsecutivePollFailures: 3 });
  ensureSidecarMock.mockResolvedValue(true);
  readImageAsBase64Mock.mockResolvedValue(null);
  saveGeneratedAssetImageMock.mockResolvedValue("local-image://characters/sheet4k.png");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setSheetCardBLineStorageForTests(null);
  setSheetCardBLineTimingsForTests(null);
  delete (globalThis as { studioAssets?: unknown }).studioAssets;
});

describe("守卫拒(转移表 idle 行:master 图缺失=不换态禁发车;主体句非空)", () => {
  it("master 缺失/主体句空=failed 收口,零网络零落盘", async () => {
    const { calls } = installFetchRouter({});
    const noMaster = await runSheetCardBLine(baseInput({ masterImageUrl: "" }));
    expect(noMaster.phase).toBe("failed");
    expect(noMaster.error).toContain("正视图");

    const noSubject = await runSheetCardBLine(baseInput({ subjectText: "   " }));
    expect(noSubject.phase).toBe("failed");
    expect(noSubject.error).toContain("主体句");

    const unreadable = await runSheetCardBLine(baseInput({ masterImageUrl: "local-image://gone.png" }));
    expect(unreadable.phase).toBe("failed");
    expect(unreadable.error).toContain("无法读取");
    expect(readImageAsBase64Mock).toHaveBeenCalledWith("local-image://gone.png");

    expect(calls).toHaveLength(0);
    expect(saveGeneratedAssetImageMock).not.toHaveBeenCalled();
    expect(ensureSidecarMock).not.toHaveBeenCalled();
  });
});

describe("提交契约面(PRD R1 payload;对齐 sidecar 实盘)", () => {
  it("POST /v1/images/sheet-i2i:{model,prompt,reference_image,extra:{角名,sheet_format,sheet_bg}}+本机令牌;进度线先播提交文案", async () => {
    const { calls } = installFetchRouter({
      submitResponse: taskDoc({ taskId: "fresh-1" }),
      polls: [taskDoc({ status: "done", resultReady: true, progress: { done: 14, total: 14, percent: 100 } })],
    });
    const onProgress = vi.fn();
    const result = await runSheetCardBLine(baseInput(), onProgress);

    const submit = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/images/sheet-i2i"))!;
    expect(submit.body).toEqual({
      model: SHEET_CARD_BLINE_MODEL,
      prompt: "北境剑修|玄色长衣|背负旧债",
      reference_image: "data:image/png;base64,TUFTVEVS",
      // 1122 格式入参化:缺省=全卡(SHEET_CARD_FORMAT 常量已退役,SHEET_CARD_FORMAT_DEFAULT=真源首键)
      extra: { 角名: "晏燎", sheet_format: SHEET_CARD_FORMAT_DEFAULT, sheet_bg: SHEET_CARD_BG },
    });
    expect(submit.headers?.Authorization).toBe("Bearer test-local-token");
    expect(onProgress).toHaveBeenNthCalledWith(1, { phase: "generating", message: expect.stringContaining("正在提交 晏燎 的设定卡B线任务") });
    expect(result.phase).toBe("done");
    expect(SHEET_CARD_BLINE_MODEL).toBe("qwen-image-2-1");
    expect(SHEET_CARD_BLINE_LAYOUT).toBe("qwen21-sheet-i2i");
    expect(SHEET_CARD_BLINE_KIND).toBe("设定卡");
    expect(SHEET_CARD_TOTAL_STEPS).toBe(14);
  });

  it("1122 格式入参化(R2):sheetFormat 四档逐档透传 extra.sheet_format;野值 fail-closed 落缺省全卡", async () => {
    for (const format of SHEET_CARD_FORMATS) {
      const { calls } = installFetchRouter({
        polls: [taskDoc({ status: "cancelled" })],
        cancelResponse: { cancelled: true, reason: "forwarded" },
      });
      await runSheetCardBLine(baseInput({ sheetFormat: format }));
      const submit = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/images/sheet-i2i"))!;
      expect((submit.body as { extra: { sheet_format: string } }).extra.sheet_format).toBe(format);
    }
    // 野值(非四档)不透传原值,落缺省档(单一真源首键契约)
    const { calls } = installFetchRouter({
      polls: [taskDoc({ status: "cancelled" })],
      cancelResponse: { cancelled: true, reason: "forwarded" },
    });
    await runSheetCardBLine(baseInput({ sheetFormat: "无武器" as never }));
    const submit = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/images/sheet-i2i"))!;
    expect((submit.body as { extra: { sheet_format: string } }).extra.sheet_format).toBe("全卡");
  });

  it("master 受管协议走 studioAssets 桥转 data URL(桥失败回落 readImageAsBase64)", async () => {
    (globalThis as { studioAssets?: unknown }).studioAssets = {
      readUrlDataUrl: vi.fn(async () => "data:image/png;base64,QlJJREdF"),
    };
    const { calls } = installFetchRouter({
      polls: [taskDoc({ status: "cancelled" })],
      cancelResponse: { cancelled: true, reason: "forwarded" },
    });
    await runSheetCardBLine(baseInput({ masterImageUrl: "asset-file://role/dingzhuang.png" }));
    const submit = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/images/sheet-i2i"))!;
    expect((submit.body as { reference_image: string }).reference_image).toBe("data:image/png;base64,QlJJREdF");
  });
});

describe("firing 子步账→composing(转移表 firing 行:进度=step i/14)", () => {
  it("running+progress 播子步账(currentStep 带 tag);全子步落盘派生 composing 合成文案", async () => {
    const { calls } = installFetchRouter({
      polls: [
        taskDoc({ status: "running", progress: { done: 3, total: 14, percent: 21 }, currentStep: "side_edit" }),
        taskDoc({ status: "running", progress: { done: 14, total: 14, percent: 100 }, currentStep: "compose" }),
        taskDoc({ status: "cancelled" }),
      ],
      cancelResponse: { cancelled: true, reason: "forwarded" },
    });
    const onProgress = vi.fn();
    const result = await runSheetCardBLine(baseInput(), onProgress);

    const messages = onProgress.mock.calls.map(([{ message }]) => message as string);
    expect(messages.some((message) => message.includes("3/14") && message.includes("side_edit"))).toBe(true);
    expect(messages.some((message) => message.includes("合成 4K 整卡"))).toBe(true);
    // 记录落 composing 态(取消前最后在册态=compose 完成)
    expect(readSheetCardBLineRecord("asset-role-1")?.status).toBe("cancelled");
    expect(result.phase).toBe("cancelled");
    expect(calls.some((call) => call.url.endsWith("/cancel") && call.method === "POST")).toBe(true);
  });
});

describe("done 取件+收编(转移表 composing→saving→done)", () => {
  it("done→GET /result 取 b64→门禁过→saveGeneratedAssetImage(characters)→记录清空→phase done 带 taskId", async () => {
    const { calls } = installFetchRouter({
      polls: [
        taskDoc({ status: "running", progress: { done: 14, total: 14, percent: 100 }, currentStep: "compose" }),
        taskDoc({ status: "done", resultReady: true, progress: { done: 14, total: 14, percent: 100 } }),
      ],
      resultResponse: { data: [{ b64_json: "NEtDUkFSRA==" }] },
    });
    const onProgress = vi.fn();
    const result = await runSheetCardBLine(baseInput({ projectId: "proj-1" }), onProgress);

    expect(calls.some((call) => call.url.includes("/result") && call.method === "GET")).toBe(true);
    expect(saveGeneratedAssetImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "data:image/png;base64,NEtDUkFSRA==",
        assetType: "character",
        assetId: "asset-role-1",
        assetName: "晏燎",
        projectId: "proj-1",
        category: "characters",
      }),
    );
    expect(updateStoreWithResult).toHaveBeenCalledWith("asset-role-1", "character", {
      imageLocalPath: "local-image://characters/sheet4k.png",
    });
    expect(readSheetCardBLineRecord("asset-role-1")).toBeNull();
    expect(result).toEqual({
      phase: "done",
      imageLocalPath: "local-image://characters/sheet4k.png",
      taskId: "task-1",
    });
    const messages = onProgress.mock.calls.map(([{ message }]) => message as string);
    expect(messages.some((message) => message.includes("正在保存 晏燎 的设定卡(4K)"))).toBe(true);
  });

  it("done 但取件无产物=partial-failed(禁半卡收编)", async () => {
    installFetchRouter({
      polls: [taskDoc({ status: "done", resultReady: true })],
      resultResponse: { data: [] },
    });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect((result as { resumable?: boolean }).resumable).toBe(true);
    expect(result.error).toContain("禁半卡");
    expect(saveGeneratedAssetImageMock).not.toHaveBeenCalled();
  });
});

describe("终卡 alpha/尺寸门禁(转移表 composing→saving 守卫;1122 复审 medium 根修)", () => {
  afterEach(() => {
    setSheetCardBLineGateSamplerForTests(null);
  });

  it("纯函数三阈值:尺寸/透明/空白各拒,合格样本过", () => {
    const pass = { width: 3840, height: 2160, transparentRatio: 0, grayVariance: 6648 };
    expect(evaluateSheetCardGate(pass)).toBeNull();
    expect(evaluateSheetCardGate({ ...pass, width: 2048, height: 1152 })).toContain("尺寸异常");
    expect(evaluateSheetCardGate({ ...pass, transparentRatio: 0.05 })).toContain("透明占比");
    expect(evaluateSheetCardGate({ ...pass, grayVariance: 2 })).toContain("近乎空白");
  });

  it("门禁拒=partial-failed 可续跑,禁半卡收编(saveGeneratedAssetImage 零调用)", async () => {
    setSheetCardBLineGateSamplerForTests(async () => ({
      width: 1024,
      height: 576,
      transparentRatio: 0,
      grayVariance: 100,
    }));
    installFetchRouter({
      polls: [taskDoc({ status: "done", resultReady: true })],
      resultResponse: { data: [{ b64_json: "NEtDUkFSRA==" }] },
    });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect((result as { resumable?: boolean }).resumable).toBe(true);
    expect(result.error).toContain("未过门禁");
    expect(result.error).toContain("尺寸异常");
    expect(saveGeneratedAssetImageMock).not.toHaveBeenCalled();
  });

  it("采样器抛错=fail-closed 拒(非渲染层禁收编)", async () => {
    setSheetCardBLineGateSamplerForTests(async () => {
      throw new Error("终卡解码失败");
    });
    installFetchRouter({
      polls: [taskDoc({ status: "done", resultReady: true })],
      resultResponse: { data: [{ b64_json: "NEtDUkFSRA==" }] },
    });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("终卡解码失败");
    expect(saveGeneratedAssetImageMock).not.toHaveBeenCalled();
  });
});

describe("partial-failed 落点与续跑重入口(转移表 firing 子步失败行)", () => {
  it("server partial-failed=failed+resumable+续跑文案;记录落 partial-failed", async () => {
    installFetchRouter({
      polls: [
        taskDoc({ status: "running", progress: { done: 5, total: 14, percent: 36 }, currentStep: "face_sheet" }),
        taskDoc({ status: "partial-failed", error: "子步 face_sheet 引擎报错", resumable: true, progress: { done: 5, total: 14, percent: 36 } }),
      ],
    });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("子步 face_sheet 引擎报错");
    expect(result.error).toContain("续跑");
    expect((result as { resumable?: boolean }).resumable).toBe(true);
    expect(readSheetCardBLineRecord("asset-role-1")).toMatchObject({ status: "partial-failed", taskId: "task-1", step: 5 });
  });

  it("重入=同 taskId 再 POST(续跑口保留;进度文案带「续跑」)", async () => {
    writeSheetCardBLineRecord({
      assetId: "asset-role-1",
      taskId: "task-resume",
      status: "partial-failed",
      step: 5,
      totalSteps: 14,
      updatedAt: Date.now(),
    });
    const { calls } = installFetchRouter({
      submitResponse: taskDoc({ taskId: "task-resume", status: "running" }),
      polls: [taskDoc({ taskId: "task-resume", status: "cancelled" })],
    });
    const onProgress = vi.fn();
    await runSheetCardBLine(baseInput(), onProgress);
    const submit = calls.find((call) => call.method === "POST" && call.url.endsWith("/v1/images/sheet-i2i"))!;
    expect((submit.body as { taskId?: string }).taskId).toBe("task-resume");
    expect(onProgress.mock.calls[0]![0]).toMatchObject({ message: expect.stringContaining("续跑") });
  });
});

describe("cancelled 落点(转移表 firing/composing 取消行:已落盘子步保留)", () => {
  it("server cancelled=phase cancelled+记录 cancelled+取消通知发侧", async () => {
    const { calls } = installFetchRouter({
      polls: [taskDoc({ status: "cancelled", resumable: true })],
    });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("cancelled");
    expect(result.error).toContain("已取消");
    expect(readSheetCardBLineRecord("asset-role-1")?.status).toBe("cancelled");
    expect(calls.some((call) => call.url.endsWith("/cancel") && call.method === "POST")).toBe(true);
  });

  it("AbortSignal 取消=同落 cancelled(取消口在跑即生效)", async () => {
    const controller = new AbortController();
    installFetchRouter({
      polls: [taskDoc({ status: "running", progress: { done: 2, total: 14, percent: 14 } })],
    });
    const pending = runSheetCardBLine(baseInput({ signal: controller.signal }));
    controller.abort();
    const result = await pending;
    expect(result.phase).toBe("cancelled");
    expect(readSheetCardBLineRecord("asset-role-1")?.status).toBe("cancelled");
  });
});

describe("轮询韧性与契约漂移(fail-closed)", () => {
  it("连续轮询失败达熔断阈=partial-failed 可续跑(瞬时抖动重试不误杀;提交面不受累)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      // 提交面通,轮询面(带 _ts 查询)恒挂——熔断只咬轮询腿
      if (String(input).includes("?")) throw new Error("poll network down");
      return {
        ok: true,
        status: 200,
        json: async () => taskDoc({}),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("轮询连续失败");
    expect((result as { resumable?: boolean }).resumable).toBe(true);
  });

  it("未知任务态=fail-closed 红错(契约漂移可见,不猜不吞)", async () => {
    installFetchRouter({ polls: [taskDoc({ status: "teleporting" })] });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("未知设定卡B线任务态");
  });

  it("提交 HTTP 409(generation-busy)透传原文", async () => {
    installFetchRouter({
      submitResponse: { status: 409, json: { error: { code: "generation-busy", message: "B线设定卡任务已在途" } } },
    });
    const result = await runSheetCardBLine(baseInput());
    expect(result.phase).toBe("failed");
    expect(result.error).toContain("B线设定卡任务已在途");
  });
});

describe("水合归一(poller 役坑:非终态禁归 running,统一 partial-failed 保续跑)", () => {
  it("firing/composing/saving 记录读取即归一 partial-failed 并回写;partial-failed/cancelled/failed 原样", () => {
    const cases: Array<SheetCardBLineTaskRecord["status"]> = ["firing", "composing", "saving"];
    for (const status of cases) {
      writeSheetCardBLineRecord({ assetId: "a-hydrate", taskId: "t", status, step: 3, totalSteps: 14, updatedAt: 1 });
      expect(readSheetCardBLineRecord("a-hydrate")?.status).toBe("partial-failed");
      clearSheetCardBLineRecord("a-hydrate");
    }
    for (const status of ["partial-failed", "cancelled", "failed"] as const) {
      writeSheetCardBLineRecord({ assetId: "a-keep", taskId: "t", status, step: 3, totalSteps: 14, updatedAt: 1 });
      expect(readSheetCardBLineRecord("a-keep")?.status).toBe(status);
      clearSheetCardBLineRecord("a-keep");
    }
  });

  it("sanitize:坏形状(done 态/缺字段/错资产键)回落 null 丢档不炸", () => {
    expect(sanitizeSheetCardBLineRecord(null)).toBeNull();
    expect(sanitizeSheetCardBLineRecord({ assetId: "a", taskId: "t", status: "done", step: 1, totalSteps: 14, updatedAt: 1 })).toBeNull();
    expect(sanitizeSheetCardBLineRecord({ assetId: "a", taskId: "t", status: "running", step: 1, totalSteps: 14, updatedAt: 1 })).toBeNull();
    expect(sanitizeSheetCardBLineRecord({ assetId: "a", taskId: 7, status: "failed", step: 1, totalSteps: 14, updatedAt: 1 })).toBeNull();
    storage.setItem(
      "manying.asset-sheet-card-bline.tasks.v1",
      JSON.stringify({ "a-bad": { broken: true }, "a-good": { assetId: "a-good", taskId: "t", status: "failed", step: 1, totalSteps: 14, updatedAt: 5 } }),
    );
    expect(readSheetCardBLineRecord("a-bad")).toBeNull();
    expect(readSheetCardBLineRecord("a-good")?.taskId).toBe("t");
  });
});

describe("R3 替换守卫(转移表 saving 行:新卡合成+验收后才清旧,失败不动旧图;1122 C 接线转正=生产语义)", () => {
  it("收编失败=旧图零删除(未过验收禁删)", async () => {
    const removeStale = vi.fn();
    const saved = await replaceSheetCardKindImageAfterAcceptance({
      stalePaths: ["role/old-sheet.png"],
      saveToLibrary: async () => false,
      removeStale,
    });
    expect(saved).toBe(false);
    expect(removeStale).not.toHaveBeenCalled();
  });

  it("收编成功才逐条清旧;单条删除抛错不阻断(残留下轮再清)", async () => {
    const removeStale = vi.fn()
      .mockRejectedValueOnce(new Error("单条删除失败"))
      .mockResolvedValueOnce(undefined);
    const saved = await replaceSheetCardKindImageAfterAcceptance({
      stalePaths: ["role/old-1.png", "role/old-2.png"],
      saveToLibrary: async () => true,
      removeStale,
    });
    expect(saved).toBe(true);
    expect(removeStale).toHaveBeenCalledTimes(2);
    expect(removeStale).toHaveBeenNthCalledWith(1, "role/old-1.png");
    expect(removeStale).toHaveBeenNthCalledWith(2, "role/old-2.png");
  });

  it("1122 惰性收集(生产接线形态):stalePaths 函数在收编验收**后**才求值——收编失败零求值(刷新库重算不跑)", async () => {
    // 收编失败:收集器零调用(未过验收连槽重算都不必跑)
    const collectRejected = vi.fn(async () => ["role/old.png"]);
    const removeStale = vi.fn();
    await replaceSheetCardKindImageAfterAcceptance({
      stalePaths: collectRejected,
      saveToLibrary: async () => false,
      removeStale,
    });
    expect(collectRejected).not.toHaveBeenCalled();
    expect(removeStale).not.toHaveBeenCalled();

    // 收编成功:收集器恰在 save 之后求值一次,清收集结果(按刷新库重算的同槽旧图)
    const order: string[] = [];
    const collectAccepted = vi.fn(async () => {
      order.push("collect");
      return ["role/slot-old.png"];
    });
    await replaceSheetCardKindImageAfterAcceptance({
      stalePaths: collectAccepted,
      saveToLibrary: async () => {
        order.push("save");
        return true;
      },
      removeStale: async (imageFilePath) => {
        order.push(`remove:${imageFilePath}`);
      },
    });
    expect(order).toEqual(["save", "collect", "remove:role/slot-old.png"]);
    expect(collectAccepted).toHaveBeenCalledTimes(1);
  });
});

describe("诊断贯通(operationId 贯穿提交/落态事件)", () => {
  it("提交与终态事件同 operationId;context 带布局名与任务号", async () => {
    installFetchRouter({
      polls: [taskDoc({ status: "partial-failed", error: "子步失败" })],
    });
    await runSheetCardBLine(baseInput({ operationId: "op-bline-thread" }));
    const entries = vi.mocked(logEvent).mock.calls.map(([entry]) => entry);
    const threaded = entries.filter((entry) => entry.operationId === "op-bline-thread");
    expect(threaded.map((entry) => entry.message)).toEqual([
      "Sheet card B-line task submitting",
      "Sheet card B-line task submitted",
      "Sheet card B-line partial-failed (resumable)",
    ]);
    expect(threaded[0].context).toMatchObject({ layout: "qwen21-sheet-i2i", assetId: "asset-role-1" });
    expect(threaded[1].context).toMatchObject({ taskId: "task-1" });
    expect(vi.mocked(createOperationId)).not.toHaveBeenCalled();
  });
});
