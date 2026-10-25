import { beforeEach, describe, expect, it, vi } from "vitest";

const { handlers, assetStorageMocks, blessedPaths, resolverMock, fsMocks, fakeFileState } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  blessedPaths: new Set<string>(),
  resolverMock: vi.fn(),
  // B-1(10-25 图↔词溯源):read-image-prompt-text 走真 PNG 扫描器+打桩 fs 字节流——
  // fakeFileState.bytes 为当前 openSync 读到的假文件字节(readSync 按位切 serving)。
  fakeFileState: { bytes: null as Buffer | null },
  fsMocks: {
    existsSync: vi.fn((p: string) => p === "/resolved/target.png"),
    readFileSync: vi.fn(() => Buffer.from("fake-png-bytes")),
    openSync: vi.fn(() => 7),
    closeSync: vi.fn(),
    fstatSync: vi.fn(() => ({ size: fakeFileState.bytes ? fakeFileState.bytes.length : 0 })),
    readSync: vi.fn((
      _fd: number,
      buffer: Buffer,
      offset: number,
      length: number,
      position: number,
    ) => {
      const bytes = fakeFileState.bytes;
      if (!bytes) return 0;
      const end = Math.min(bytes.length, position + length);
      const read = Math.max(0, end - position);
      bytes.copy(buffer, offset, position, end);
      return read;
    }),
  },
  assetStorageMocks: {
    addAsset: vi.fn(),
    addAssetImage: vi.fn(),
    batchMatchAssets: vi.fn(),
    deleteAsset: vi.fn(),
    getAsset: vi.fn(),
    getAssetByName: vi.fn(),
    importFromToonflow: vi.fn(() => 0),
    initAssetsStorage: vi.fn(),
    listAssetFamilyAssets: vi.fn(async () => []),
    listAssets: vi.fn(async () => []),
    removeAssetImage: vi.fn(),
    renameAssetImage: vi.fn(),
    replaceAssetMainImage: vi.fn(),
    updateAsset: vi.fn(),
    resolveManagedAssetPathOrUndefined: vi.fn((relativePath: string | undefined) => (
      relativePath ? "/resolved/target.png" : undefined
    )),
  },
}));
vi.mock("electron", () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler)) },
}));
vi.mock("../../storage/studio-assets-storage", () => assetStorageMocks);
// 1013 Tainted canvas 修复锁:read-url-data-url 桥双协议收编——装机实弹中
// project-file:// 参考图进旧桥被 parseAssetFileUrl(仅认 asset-file)返 null,
// 回落直载染画布,衍生行参考图缩略 toDataURL 全灭。fs/解析器打桩(既有 9 测不碰二者)。
vi.mock("node:fs", () => ({ default: fsMocks }));
vi.mock("../../storage/storage-paths", () => ({
  resolveProjectOrAssetFileUrl: resolverMock,
  resolveAssetFilePath: vi.fn(),
}));

import { dialog } from "electron";
import { registerAssetLibraryIpcHandlers } from "./asset-library-ipc";
import { resolveAssetFilePath } from "../../storage/storage-paths";

const isSourcePathAllowed = (sourceFilePath: string) => (
  sourceFilePath.startsWith("/data/") || sourceFilePath.startsWith("/media/") || blessedPaths.has(sourceFilePath)
);
const blessDialogPaths = (paths: readonly string[]) => paths.forEach((p) => blessedPaths.add(p));

beforeEach(() => {
  handlers.clear();
  blessedPaths.clear();
  fakeFileState.bytes = null;
  vi.mocked(dialog.showOpenDialog).mockReset();
  vi.mocked(assetStorageMocks.resolveManagedAssetPathOrUndefined).mockClear();
  fsMocks.existsSync.mockClear();
  fsMocks.openSync.mockClear();
  fsMocks.closeSync.mockClear();
  fsMocks.readSync.mockClear();
  fsMocks.fstatSync.mockClear();
});

function registerHandlers() {
  registerAssetLibraryIpcHandlers({
    getStorageBasePath: () => "/data",
    getAssetsRoot: () => "/data/assets",
    getMediaRoot: () => "/media",
    createOperationId: (prefix) => `${prefix}-1`,
    writeDiagnosticsLog: vi.fn(),
    isSourcePathAllowed,
    blessDialogPaths,
  });
}

function registerHandlersWithAssetRoots(roots: { storageBasePath?: () => string; assetsRoot?: () => string }) {
  registerAssetLibraryIpcHandlers({
    getStorageBasePath: roots.storageBasePath ?? (() => "/data"),
    getAssetsRoot: roots.assetsRoot ?? (() => "/data/assets"),
    getMediaRoot: () => "/media",
    createOperationId: (prefix) => `${prefix}-1`,
    writeDiagnosticsLog: vi.fn(),
    isSourcePathAllowed,
    blessDialogPaths,
  });
}

function getHandler(channel: string) {
  const handler = handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!;
}

describe("registerAssetLibraryIpcHandlers", () => {
  it("registers every independent asset-library channel without eager storage initialization", () => {
    registerHandlers();
    expect([...handlers.keys()].sort()).toEqual([
      "assets:add", "assets:add-image", "assets:batch-match", "assets:delete", "assets:get",
      "assets:get-by-name", "assets:import-from-toonflow", "assets:list", "assets:list-family", "assets:read-image-data-url", "assets:read-image-prompt-text", "assets:read-url-data-url", "assets:remove-image", "assets:rename-image",
      "assets:replace-image", "assets:resolve-file-url", "assets:select-audio-file", "assets:select-image-file", "assets:select-image-files", "assets:update",
    ]);
    expect(assetStorageMocks.initAssetsStorage).not.toHaveBeenCalled();
  });

  it("reinitializes asset storage when the asset home root changes(1015:m-2 断言值随注入的 assets 根)", async () => {
    let assetsRoot = "/data/assets";
    registerHandlersWithAssetRoots({ assetsRoot: () => assetsRoot });

    await getHandler("assets:list")({}, { type: "role" });
    await getHandler("assets:list")({}, { type: "role" });
    assetsRoot = "/Users/x/Project/IP/MA/assets";
    await getHandler("assets:list")({}, { type: "role" });

    expect(assetStorageMocks.initAssetsStorage).toHaveBeenCalledTimes(2);
    expect(assetStorageMocks.initAssetsStorage).toHaveBeenNthCalledWith(1, "/data/assets");
    expect(assetStorageMocks.initAssetsStorage).toHaveBeenNthCalledWith(2, "/Users/x/Project/IP/MA/assets");
  });

  it("【M9+M15 根健康闸】getAssetsRoot 抛 ASSET_HOME_ORPHANED → writeDiagnosticsLog(error)先于 throw+handler rejects+initAssetsStorage 不被调", async () => {
    assetStorageMocks.initAssetsStorage.mockClear();
    const writeDiagnosticsLog = vi.fn();
    const calls: string[] = [];
    registerAssetLibraryIpcHandlers({
      getStorageBasePath: () => "/data",
      getAssetsRoot: () => {
        throw new Error("ASSET_HOME_ORPHANED:资产库位置失联(原位置:/Users/x/Project/IP/MA),请重新绑定项目文件夹");
      },
      getMediaRoot: () => "/media",
      createOperationId: (prefix) => `${prefix}-1`,
      writeDiagnosticsLog: (entry) => {
        calls.push(`${entry.level}:${entry.message}`);
        writeDiagnosticsLog(entry);
      },
      isSourcePathAllowed,
      blessDialogPaths,
    });

    await expect(getHandler("assets:list")({}, { type: "role" })).rejects.toThrow(/ASSET_HOME_ORPHANED/);
    expect(writeDiagnosticsLog).toHaveBeenCalledWith(expect.objectContaining({
      level: "error",
      category: "asset",
    }));
    // 留痕先于 rejection 可见:error 级留痕已发生且带 ORPHANED 消息
    expect(calls.some((call) => call.startsWith("error:") && call.includes("ASSET_HOME_ORPHANED"))).toBe(true);
    // 绝不空库重建
    expect(assetStorageMocks.initAssetsStorage).not.toHaveBeenCalled();
  });

  it("returns null when the asset image picker is canceled", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(getHandler("assets:select-image-file")({})).resolves.toBeNull();
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile"],
    }));
  });

  it("returns the selected audio file from the audio picker", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ["/media/dialogue.wav"],
    });

    await expect(getHandler("assets:select-audio-file")({})).resolves.toBe("/media/dialogue.wav");
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      defaultPath: "/media",
      properties: ["openFile"],
      filters: [{ name: "音频", extensions: ["aac", "flac", "m4a", "mp3", "ogg", "wav"] }],
    }));
  });

  it("returns every selected image from the multi-select picker", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ["/media/one.png", "/media/two.webp"],
    });

    await expect(getHandler("assets:select-image-files")({})).resolves.toEqual([
      "/media/one.png",
      "/media/two.webp",
    ]);
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      properties: ["openFile", "multiSelections"],
    }));
  });

  it("assets:list-family 把 type/name 原样透传聚显查询并回传族数组(R4 族聚显)", async () => {
    registerHandlers();
    const familyRows: unknown[] = [{ id: "a1" }, { id: "a2" }];
    assetStorageMocks.listAssetFamilyAssets.mockResolvedValueOnce(familyRows as never);

    await expect(getHandler("assets:list-family")({}, { type: "role", name: "晏燎" })).resolves.toBe(familyRows);
    expect(assetStorageMocks.listAssetFamilyAssets).toHaveBeenCalledWith("role", "晏燎");
  });

  it("returns an empty list when the multi-select picker is canceled", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] });

    await expect(getHandler("assets:select-image-files")({})).resolves.toEqual([]);
  });

  it("blesses picker results so later asset writes accept them", async () => {
    registerHandlers();
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: ["/Users/x/Desktop/pick.png"],
    });

    await expect(getHandler("assets:select-image-file")({})).resolves.toBe("/Users/x/Desktop/pick.png");
    expect(blessedPaths.has("/Users/x/Desktop/pick.png")).toBe(true);
  });

  it("rejects asset source paths outside managed roots", async () => {
    registerHandlers();

    await expect(getHandler("assets:add-image")({}, {
      assetId: "a1", imageName: "main", sourceFilePath: "/Users/x/.ssh/id_rsa",
    })).rejects.toThrow(/不在应用允许的目录范围内/);
    await expect(getHandler("assets:replace-image")({}, {
      assetId: "a1", sourceFilePath: "/etc/passwd",
    })).rejects.toThrow(/不在应用允许的目录范围内/);
    await expect(getHandler("assets:add")({}, {
      type: "role", name: "r1", sourceFilePath: "/Users/x/.ssh/id_rsa",
    })).rejects.toThrow(/不在应用允许的目录范围内/);

    expect(assetStorageMocks.addAssetImage).not.toHaveBeenCalled();
    expect(assetStorageMocks.replaceAssetMainImage).not.toHaveBeenCalled();
    expect(assetStorageMocks.addAsset).not.toHaveBeenCalled();
  });

  it("accepts managed-root and dialog-blessed source paths", async () => {
    registerHandlers();
    assetStorageMocks.addAssetImage.mockReturnValueOnce({ id: "a1" });
    assetStorageMocks.replaceAssetMainImage.mockReturnValueOnce({ id: "a1" });
    blessDialogPaths(["/Users/x/Desktop/pick.png"]);

    await expect(getHandler("assets:add-image")({}, {
      assetId: "a1", imageName: "main", sourceFilePath: "/media/studio-assets/shot.png",
    })).resolves.toBeDefined();
    await expect(getHandler("assets:replace-image")({}, {
      assetId: "a1", sourceFilePath: "/Users/x/Desktop/pick.png",
    })).resolves.toBeDefined();

    expect(assetStorageMocks.addAssetImage).toHaveBeenCalledTimes(1);
    expect(assetStorageMocks.replaceAssetMainImage).toHaveBeenCalledTimes(1);
  });
});

describe("assets:read-url-data-url 双协议桥(1013 Tainted canvas 修复锁)", () => {
  it("project-file:// 经双协议解析器命中 → 返回 data URL(主进程读字节的干净路,不染画布)", async () => {
    resolverMock.mockReturnValueOnce("/resolved/target.png");
    registerHandlers();
    const result = await getHandler("assets:read-url-data-url")(null, "project-file://p1/assets/character/a.png");
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(resolverMock).toHaveBeenCalledWith("/data", "/data/assets", "project-file://p1/assets/character/a.png");
  });

  it("解析出的文件缺席 → 返回 null(渲染层走回落链,不抛错)", () => {
    resolverMock.mockReturnValueOnce("/resolved/missing.png");
    registerHandlers();
    expect(getHandler("assets:read-url-data-url")(null, "project-file://p1/none.png")).toBeNull();
  });

  it("非法协议(解析器抛错) → 捕获返 null(旧行为不变)", () => {
    resolverMock.mockImplementationOnce(() => {
      throw new Error("Invalid project file URL");
    });
    registerHandlers();
    expect(getHandler("assets:read-url-data-url")(null, "weird://x")).toBeNull();
  });
});

describe("assets:resolve-file-url 断链兜底(1015 补刀:断链可诊断)", () => {
  it("asset-file:// 解析成功且文件在 → 返回绝对路径,零告警", async () => {
    vi.mocked(resolveAssetFilePath).mockReturnValueOnce("/resolved/target.png");
    registerHandlers();
    const result = await getHandler("assets:resolve-file-url")(null, "asset-file://audio/ok.wav");
    expect(result).toBe("/resolved/target.png");
  });

  it("asset-file:// 断链(文件缺席) → 返 null+writeDiagnosticsLog(warn)留痕;同 URL 会话级去重不刷屏", async () => {
    vi.mocked(resolveAssetFilePath).mockReturnValue("/resolved/gone-1015-deepen-a.wav");
    const writeDiagnosticsLog = vi.fn();
    registerAssetLibraryIpcHandlers({
      getStorageBasePath: () => "/data",
      getAssetsRoot: () => "/data/assets",
      getMediaRoot: () => "/media",
      createOperationId: (prefix) => `${prefix}-1`,
      writeDiagnosticsLog,
      isSourcePathAllowed,
      blessDialogPaths,
    });
    const handler = getHandler("assets:resolve-file-url");
    expect(await handler(null, "asset-file://audio/gone-1015-deepen-a.wav")).toBeNull();
    // 再来一次同 URL:去重,不新增告警
    expect(await handler(null, "asset-file://audio/gone-1015-deepen-a.wav")).toBeNull();
    const warns = writeDiagnosticsLog.mock.calls.filter(([entry]) => entry?.level === "warn");
    expect(warns.length).toBe(1);
    expect(JSON.stringify(warns[0])).toContain("asset-file://audio/gone-1015-deepen-a.wav");

    // 另一条断链 URL:新告警(去重按 URL,不吞新信号)
    vi.mocked(resolveAssetFilePath).mockReturnValue("/resolved/gone-1015-deepen-b.wav");
    expect(await handler(null, "asset-file://audio/gone-1015-deepen-b.wav")).toBeNull();
    expect(writeDiagnosticsLog.mock.calls.filter(([entry]) => entry?.level === "warn").length).toBe(2);
  });

  it("非 asset-file 协议(解析器抛错/其他) → 返 null,不写断链告警", async () => {
    vi.mocked(resolveAssetFilePath).mockImplementationOnce(() => {
      throw new Error("Invalid asset file url");
    });
    const writeDiagnosticsLog = vi.fn();
    registerAssetLibraryIpcHandlers({
      getStorageBasePath: () => "/data",
      getAssetsRoot: () => "/data/assets",
      getMediaRoot: () => "/media",
      createOperationId: (prefix) => `${prefix}-1`,
      writeDiagnosticsLog,
      isSourcePathAllowed,
      blessDialogPaths,
    });
    expect(await getHandler("assets:resolve-file-url")(null, "weird://x")).toBeNull();
    expect(writeDiagnosticsLog).not.toHaveBeenCalled();
  });
});

// === B-1(10-25-asset-prompt-layered-panel)assets:read-image-prompt-text 只读通道 ===
// 真 PNG 扫描器(png-text-extractor)不打桩:fs 字节流打桩按假文件位切 serving,
// 白名单走打桩的 resolveManagedAssetPathOrUndefined(默认=/resolved/target.png)。

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  header.write(type, 4, 4, "latin1");
  return Buffer.concat([header, data, Buffer.alloc(4)]); // CRC 内容扫描器不校验
}

function pngTextChunk(keyword: string, text: string): Buffer {
  return pngChunk("tEXt", Buffer.concat([Buffer.from(keyword, "latin1"), Buffer.from([0]), Buffer.from(text, "utf8")]));
}

function buildPng(chunks: Buffer[]): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

function serveFakeFile(bytes: Buffer) {
  fakeFileState.bytes = bytes;
}

describe("assets:read-image-prompt-text 图↔词溯源只读通道(B-1)", () => {
  it("受管路径 PNG 提 keyword=prompt 的 tEXt 文本串(ok 路不整图过桥)", async () => {
    registerHandlers();
    const workflowJson = '{"400":{"class_type":"PrimitiveStringMultiline","inputs":{"value":"指令终稿"}}}';
    serveFakeFile(buildPng([
      pngTextChunk("workflow", '{"nodes":[]}'),
      pngTextChunk("prompt", workflowJson),
      pngChunk("IEND", Buffer.alloc(0)),
    ]));

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "role/晏燎/晏燎_共主期_海报_v1.png" }))
      .resolves.toEqual({ ok: true, text: workflowJson });
    expect(assetStorageMocks.resolveManagedAssetPathOrUndefined).toHaveBeenCalledWith("role/晏燎/晏燎_共主期_海报_v1.png");
    expect(fsMocks.openSync).toHaveBeenCalledWith("/resolved/target.png", "r");
  });

  it("白名单拒绝:受管根解析失败(../ 逃逸等)→ path-rejected,不开文件", async () => {
    registerHandlers();
    vi.mocked(assetStorageMocks.resolveManagedAssetPathOrUndefined).mockReturnValueOnce(undefined);
    serveFakeFile(buildPng([pngTextChunk("prompt", "{}"), pngChunk("IEND", Buffer.alloc(0))]));

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "../../etc/passwd.png" }))
      .resolves.toEqual({ ok: false, reason: "path-rejected" });
    expect(fsMocks.openSync).not.toHaveBeenCalled();
  });

  it("非字符串/缺席 filePath → path-rejected(不静默兜底)", async () => {
    registerHandlers();
    await expect(getHandler("assets:read-image-prompt-text")(null, {})).resolves.toEqual({ ok: false, reason: "path-rejected" });
    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: 123 })).resolves.toEqual({ ok: false, reason: "path-rejected" });
  });

  it("解析成功但文件缺席(断链) → file-missing", async () => {
    registerHandlers();
    fsMocks.existsSync.mockReturnValueOnce(false);

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "role/晏燎/gone.png" }))
      .resolves.toEqual({ ok: false, reason: "file-missing" });
  });

  it("JPEG/非 PNG 头 → not-png(降级矩阵:仅引擎 PNG 产物携带元数据)", async () => {
    registerHandlers();
    serveFakeFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "role/x.jpg" }))
      .resolves.toEqual({ ok: false, reason: "not-png" });
  });

  it("PNG 在场但无 keyword=prompt 的 tEXt(实证 31/32 之外降级位) → no-texr", async () => {
    registerHandlers();
    serveFakeFile(buildPng([
      pngTextChunk("workflow", "{}"),
      pngChunk("IDAT", Buffer.alloc(32)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]));

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "role/x.png" }))
      .resolves.toEqual({ ok: false, reason: "no-texr" });
  });

  it("tEXt 文本载荷超 256KB 护栏 → oversize", async () => {
    registerHandlers();
    serveFakeFile(buildPng([
      pngTextChunk("prompt", "x".repeat(256 * 1024 + 1)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]));

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "role/x.png" }))
      .resolves.toEqual({ ok: false, reason: "oversize" });
  });

  it("签名合法但块结构损坏(非法块类型) → read-failed", async () => {
    registerHandlers();
    serveFakeFile(buildPng([pngChunk("!!!!", Buffer.alloc(4))]));

    await expect(getHandler("assets:read-image-prompt-text")(null, { filePath: "role/x.png" }))
      .resolves.toEqual({ ok: false, reason: "read-failed" });
  });

  it("打点沿 runAssetDiagnostics:completed 留痕含通道动作名", async () => {
    const writeDiagnosticsLog = vi.fn();
    registerAssetLibraryIpcHandlers({
      getStorageBasePath: () => "/data",
      getAssetsRoot: () => "/data/assets",
      getMediaRoot: () => "/media",
      createOperationId: (prefix) => `${prefix}-1`,
      writeDiagnosticsLog,
      isSourcePathAllowed,
      blessDialogPaths,
    });
    serveFakeFile(buildPng([pngTextChunk("prompt", "{}"), pngChunk("IEND", Buffer.alloc(0))]));

    await getHandler("assets:read-image-prompt-text")(null, { filePath: "role/x.png" });
    const messages = writeDiagnosticsLog.mock.calls.map(([entry]) => entry?.message);
    expect(messages.some((message) => message?.includes("read-image-prompt-text"))).toBe(true);
  });
});
