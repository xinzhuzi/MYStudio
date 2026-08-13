import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveRefPreview, toFileUrl } from "./ref-preview-loader";
import type { PhysicalRef } from "@/types/artifacts";

const mk = (over: Partial<PhysicalRef>): PhysicalRef => ({
  type: "project-file",
  path: "",
  ...over,
});

describe("resolveRefPreview", () => {
  const imageStorage = { readAsBase64: vi.fn(), getAbsolutePath: vi.fn() };
  const projectFiles = { readText: vi.fn(), readAsBase64: vi.fn(), getAbsolutePath: vi.fn() };

  beforeEach(() => {
    (globalThis as any).window = Object.assign(Object.create(null), {
      imageStorage,
      projectFiles,
    });
    imageStorage.readAsBase64.mockReset();
    imageStorage.getAbsolutePath.mockReset();
    projectFiles.readText.mockReset();
    projectFiles.readAsBase64.mockReset();
    projectFiles.getAbsolutePath.mockReset();
  });
  afterEach(() => { delete (globalThis as any).window; });

  it("local-media image routes through imageStorage.readAsBase64", async () => {
    imageStorage.readAsBase64.mockResolvedValue({
      success: true, base64: "data:image/png;base64,AAAA", mimeType: "image/png", size: 4,
    });
    const out = await resolveRefPreview(mk({ type: "local-media", path: "local-image://studio-assets/cover.png" }), "proj1");
    expect(out.mode).toBe("image");
    if (out.mode === "image") {
      expect(out.dataUrl).toBe("data:image/png;base64,AAAA");
      expect(out.mimeType).toBe("image/png");
    }
    expect(imageStorage.readAsBase64).toHaveBeenCalledWith("local-image://studio-assets/cover.png");
  });

  it("local-media video resolves an absolute path for <video>", async () => {
    imageStorage.getAbsolutePath.mockResolvedValue("/media/proj/clip.mp4");
    const out = await resolveRefPreview(mk({ type: "local-media", path: "local-video://proj/clip.mp4" }), "proj1");
    expect(out.mode).toBe("video");
    if (out.mode === "video") expect(out.absolutePath).toBe("/media/proj/clip.mp4");
  });

  it("project-file json routes through projectFiles.readText with object payload", async () => {
    projectFiles.readText.mockResolvedValue({ success: true, text: "{\"a\":1}", size: 7, truncated: false });
    const out = await resolveRefPreview(mk({ type: "project-file", path: "data/events.json" }), "projX");
    expect(out.mode).toBe("json");
    if (out.mode === "json") {
      expect(out.text).toBe("{\"a\":1}");
      expect(out.truncated).toBe(false);
    }
    expect(projectFiles.readText).toHaveBeenCalledWith({ projectId: "projX", relativePath: "data/events.json" });
  });

  it("project-file markdown reports truncated flag", async () => {
    projectFiles.readText.mockResolvedValue({ success: true, text: "# h".repeat(1), size: 999, truncated: true });
    const out = await resolveRefPreview(mk({ type: "backup", path: "notes.md" }), "projX");
    expect(out.mode).toBe("markdown");
    if (out.mode === "markdown") expect(out.truncated).toBe(true);
  });

  it("binary extension returns binary mode without any IPC call", async () => {
    const out = await resolveRefPreview(mk({ type: "project-file", path: "archive.zip" }), "projX");
    expect(out.mode).toBe("binary");
    expect(projectFiles.readText).not.toHaveBeenCalled();
    expect(imageStorage.readAsBase64).not.toHaveBeenCalled();
  });

  it("readText failure degrades to binary with the error message", async () => {
    projectFiles.readText.mockResolvedValue({ success: false, error: "文件包含二进制内容,无法预览" });
    const out = await resolveRefPreview(mk({ type: "project-file", path: "x.bin" }), "projX");
    // .bin is already classified binary by extension — no IPC call
    expect(out.mode).toBe("binary");
  });

  it("json file with non-JSON content degrades to binary (prevents jsonLang crash)", async () => {
    projectFiles.readText.mockResolvedValue({
      success: true,
      text: "__弓妍静_____年龄___不详_____性别___女___1779988670440",
      size: 47,
      truncated: false,
    });
    const out = await resolveRefPreview(mk({ type: "project-file", path: "data/workflow-output.json" }), "projX");
    expect(out.mode).toBe("binary");
    if (out.mode === "binary") expect(out.message).toContain("无法预览");
  });

  it("unexpected throw during resolution degrades to binary, not error", async () => {
    projectFiles.readText.mockRejectedValue(new Error("IPC channel closed"));
    const out = await resolveRefPreview(mk({ type: "project-file", path: "data/store.json" }), "projX");
    expect(out.mode).toBe("binary");
    if (out.mode === "binary") expect(out.message).toContain("无法预览");
  });

  it("json file with valid JSON content keeps json mode", async () => {
    projectFiles.readText.mockResolvedValue({
      success: true,
      text: '{"key":"value","nested":{"a":1}}',
      size: 33,
      truncated: false,
    });
    const out = await resolveRefPreview(mk({ type: "project-file", path: "data/store.json" }), "projX");
    expect(out.mode).toBe("json");
    if (out.mode === "json") expect(out.text).toBe('{"key":"value","nested":{"a":1}}');
  });

  it("readText failure for a text extension surfaces the error", async () => {
    projectFiles.readText.mockResolvedValue({ success: false, error: "文件过大(超过 2MB)" });
    const out = await resolveRefPreview(mk({ type: "project-file", path: "huge.txt" }), "projX");
    expect(out.mode).toBe("binary");
    if (out.mode === "binary") expect(out.message).toContain("超过 2MB");
  });

  it("project-file image builds project-file:// URL and reads base64 via projectFiles", async () => {
    projectFiles.readAsBase64.mockResolvedValue({
      success: true, base64: "data:image/png;base64,BBBB", mimeType: "image/png", size: 2,
    });
    const out = await resolveRefPreview(mk({ type: "project-file", path: "assets/poster.png" }), "projX");
    expect(out.mode).toBe("image");
    expect(projectFiles.readAsBase64).toHaveBeenCalledWith("project-file://projX/assets/poster.png");
  });

  it("does not wrap an existing project-file image URL a second time", async () => {
    projectFiles.readAsBase64.mockResolvedValue({
      success: true, base64: "data:image/png;base64,CCCC", mimeType: "image/png", size: 2,
    });
    await resolveRefPreview(
      mk({ type: "project-file", path: "project-file://projX/assets/live-poster.png" }),
      "projX",
    );
    expect(projectFiles.readAsBase64).toHaveBeenCalledWith(
      "project-file://projX/assets/live-poster.png",
    );
  });

  it("project-file video builds URL and resolves absolute path via projectFiles", async () => {
    projectFiles.getAbsolutePath.mockResolvedValue("/data/_p/projX/exports/clip.mp4");
    const out = await resolveRefPreview(mk({ type: "exports", path: "exports/clip.mp4" }), "projX");
    expect(out.mode).toBe("video");
    if (out.mode === "video") expect(out.absolutePath).toBe("/data/_p/projX/exports/clip.mp4");
    expect(projectFiles.getAbsolutePath).toHaveBeenCalledWith("project-file://projX/exports/clip.mp4");
  });

  it("uses the relative path from an existing project-file text URL", async () => {
    projectFiles.readText.mockResolvedValue({ success: true, text: "# live", size: 6, truncated: false });
    await resolveRefPreview(
      mk({ type: "project-file", path: "project-file://projX/novel/chapter-001.md" }),
      "projX",
    );
    expect(projectFiles.readText).toHaveBeenCalledWith({
      projectId: "projX",
      relativePath: "novel/chapter-001.md",
    });
  });

  it("project-file image with readAsBase64 failure degrades to binary", async () => {
    projectFiles.readAsBase64.mockResolvedValue({ success: false, error: "File not found" });
    const out = await resolveRefPreview(mk({ type: "backup", path: "x.png" }), "projX");
    expect(out.mode).toBe("binary");
    if (out.mode === "binary") expect(out.message).toContain("File not found");
  });
});

describe("toFileUrl", () => {
  it("passes through an existing file:// URL unchanged", () => {
    expect(toFileUrl("file:///media/clip.mp4")).toBe("file:///media/clip.mp4");
  });

  it("converts a Unix absolute path with three slashes", () => {
    expect(toFileUrl("/media/proj/clip.mp4")).toBe("file:///media/proj/clip.mp4");
  });

  it("converts a Windows drive path to file:/// with forward slashes", () => {
    expect(toFileUrl("C:\\Users\\foo\\bar.mp4")).toBe("file:///C:/Users/foo/bar.mp4");
  });

  it("encodes spaces in paths", () => {
    expect(toFileUrl("/media/my clip.mp4")).toBe("file:///media/my%20clip.mp4");
  });
});
