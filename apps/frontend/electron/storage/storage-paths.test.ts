import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAssetFileUrl,
  createProjectFileUrl,
  parseAssetFileUrl,
  parseLocalMediaPath,
  parseProjectFileUrl,
  resolveAssetFilePath,
  resolveDataDirPath,
  resolveDataFilePath,
  resolveLocalMediaPath,
  resolveProjectFileUrl,
  resolveProjectRootPath,
  resolveProjectScopedFilePath,
  setProjectLocationResolver,
} from "./storage-paths";

describe("storage path helpers", () => {
  it("keeps file-storage keys inside the data root", () => {
    expect(resolveDataFilePath("/data", "_p/project/script")).toBe("/data/_p/project/script.json");
    expect(() => resolveDataFilePath("/data", "../secrets")).toThrow("escapes");
  });

  it("keeps file-storage prefixes inside the data root", () => {
    expect(resolveDataDirPath("/data", "_p/project")).toBe("/data/_p/project");
    expect(() => resolveDataDirPath("/data", "../../")).toThrow("escapes");
  });

  it("parses local-image URLs without allowing traversal", () => {
    expect(parseLocalMediaPath("local-image://studio-assets/cover.png")).toEqual({
      category: "studio-assets",
      filename: "cover.png",
    });
    expect(parseLocalMediaPath("file:///tmp/cover.png")).toBe(null);
    expect(() => parseLocalMediaPath("local-image://studio-assets/../secret.png")).toThrow("escapes");
  });

  it("resolves local media paths inside the media root", () => {
    expect(resolveLocalMediaPath("/media", "local-image://studio-assets/cover.png")).toBe("/media/studio-assets/cover.png");
    expect(() => resolveLocalMediaPath("/media", "local-image://studio-assets/../../secret.png")).toThrow("escapes");
  });

  it("rejects a local media path whose existing parent symlink escapes the media root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-storage-paths-"));
    const mediaRoot = path.join(root, "media");
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-storage-outside-"));
    fs.mkdirSync(mediaRoot);
    fs.symlinkSync(outsideRoot, path.join(mediaRoot, "link"));
    try {
      expect(() => resolveLocalMediaPath(mediaRoot, "local-image://link/secret.png")).toThrow("escapes");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("keeps project workflow files inside the active project directory", () => {
    expect(createProjectFileUrl("dao-project", "workflow-images/flow-1/cover.png")).toBe(
      "project-file://dao-project/workflow-images/flow-1/cover.png",
    );
    expect(parseProjectFileUrl("project-file://dao-project/workflow-images/flow-1/cover.png")).toEqual({
      projectId: "dao-project",
      relativePath: "workflow-images/flow-1/cover.png",
    });
    expect(resolveProjectScopedFilePath("/data/projects", "dao-project", "workflow-images/flow-1/cover.png")).toBe(
      "/data/projects/_p/dao-project/workflow-images/flow-1/cover.png",
    );
    expect(resolveProjectFileUrl("/data/projects", "project-file://dao-project/workflow-images/flow-1/cover.png")).toBe(
      "/data/projects/_p/dao-project/workflow-images/flow-1/cover.png",
    );
    expect(() => resolveProjectFileUrl("/data/projects", "project-file://dao-project/../secret.png")).toThrow("escapes");
    expect(() => createProjectFileUrl("../dao", "workflow-images/cover.png")).toThrow("escapes");
    expect(() => createProjectFileUrl("dao/project", "workflow-images/cover.png")).toThrow("escapes");
    expect(() => createProjectFileUrl("dao\0project", "workflow-images/cover.png")).toThrow("Invalid");
    expect(() => parseProjectFileUrl("project-file://dao%2Fproject/workflow-images/cover.png")).toThrow("escapes");
    expect(() => resolveProjectScopedFilePath("/data/projects", "../dao", "workflow-images/cover.png")).toThrow("escapes");
  });

  it("builds and resolves asset-file virtual urls inside the managed assets tree", () => {
    expect(createAssetFileUrl("role/hero-1.png")).toBe("asset-file://role/hero-1.png");
    expect(createAssetFileUrl("role/hero-1.png", { thumb: true })).toBe("asset-file://role/hero-1.png?thumb=1");
    expect(createAssetFileUrl("audio/试听.wav")).toBe("asset-file://audio/%E8%AF%95%E5%90%AC.wav");
    expect(parseAssetFileUrl("asset-file://role/hero-1.png")).toEqual({
      relativePath: "role/hero-1.png",
      thumb: false,
    });
    expect(parseAssetFileUrl("asset-file://role/hero-1.png?thumb=1")).toEqual({
      relativePath: "role/hero-1.png",
      thumb: true,
    });
    expect(() => parseAssetFileUrl("asset-file://../secret.png")).toThrow("escapes");
    expect(resolveAssetFilePath("/data/assets", "asset-file://role/hero-1.png")).toBe(
      "/data/assets/files/role/hero-1.png",
    );
    expect(resolveAssetFilePath("/data/assets", "asset-file://role/hero-1.png?thumb=1")).toBe(
      "/data/assets/thumbs/role/hero-1.png",
    );
    expect(() => resolveAssetFilePath("/data/assets", "asset-file://../../etc/passwd")).toThrow();
    expect(() => createAssetFileUrl("../role/hero.png")).toThrow("escapes");
  });

  it("resolves the project root and rejects invalid or symlinked project ids", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-project-root-"));
    const dataRoot = path.join(root, "data");
    const projectsRoot = path.join(dataRoot, "_p");
    const projectRoot = path.join(projectsRoot, "project-safe");
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-project-outside-"));
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(projectsRoot, "project-escaped"));
    try {
      expect(resolveProjectRootPath(dataRoot, "project-safe")).toBe(projectRoot);
      expect(() => resolveProjectRootPath(dataRoot, "")).toThrow("Invalid");
      expect(() => resolveProjectRootPath(dataRoot, "../project-safe")).toThrow("escapes");
      expect(() => resolveProjectRootPath(dataRoot, "project-escaped")).toThrow("escapes");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});

describe("project location resolver", () => {
  afterEach(() => {
    setProjectLocationResolver(null);
  });

  function makeExternalRoot() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-location-"));
    return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  }

  it("redirects every project-scoped resolve function to the registered location", () => {
    const { root: externalRoot, cleanup } = makeExternalRoot();
    setProjectLocationResolver((projectId) => (projectId === "p-ext" ? externalRoot : undefined));
    try {
      // store 布局 v1:白名单 store 键解析进 store/ 并完成迁移(08-18-project-store-layout)
      expect(resolveDataFilePath("/data", "_p/p-ext/script")).toBe(path.join(externalRoot, "store", "script.json"));
      expect(fs.existsSync(path.join(externalRoot, "store", "_store-layout-v1.json"))).toBe(true);
      expect(resolveDataFilePath("/data", "_p/p-ext/nested/state")).toBe(path.join(externalRoot, "nested", "state.json"));
      expect(resolveDataDirPath("/data", "_p/p-ext/remotion")).toBe(path.join(externalRoot, "remotion"));
      expect(resolveDataDirPath("/data", "_p/p-ext")).toBe(externalRoot);
      expect(resolveProjectRootPath("/data", "p-ext")).toBe(externalRoot);
      expect(resolveProjectScopedFilePath("/data", "p-ext", "remotion/out.mp4")).toBe(
        path.join(externalRoot, "remotion", "out.mp4"),
      );
      expect(resolveProjectFileUrl("/data", "project-file://p-ext/remotion/out.mp4")).toBe(
        path.join(externalRoot, "remotion", "out.mp4"),
      );
    } finally {
      setProjectLocationResolver(null);
      cleanup();
    }
  });

  it("store 布局 v1（内部 _p 项目）：迁移后保留 _p/{pid} 前缀，不落共享 <dataRoot>/store/", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-internal-layout-"));
    const dataRoot = path.join(root, "data");
    fs.mkdirSync(path.join(dataRoot, "_p", "project-int"), { recursive: true });
    try {
      // 首次解析触发幂等迁移（建 marker），此后 store 键必须落项目自己的 store/
      const first = resolveDataFilePath(dataRoot, "_p/project-int/script");
      expect(first).toBe(path.join(dataRoot, "_p", "project-int", "store", "script.json"));
      expect(fs.existsSync(path.join(dataRoot, "_p", "project-int", "store", "_store-layout-v1.json"))).toBe(true);
      // 共享目录不允许出现（此前 bug：内部项目前缀被剥掉，全部落到共享 <dataRoot>/store/）
      expect(fs.existsSync(path.join(dataRoot, "store"))).toBe(false);
      // 非白名单键原样
      expect(resolveDataFilePath(dataRoot, "_p/project-int/novel/chapters/x")).toBe(
        path.join(dataRoot, "_p", "project-int", "novel", "chapters", "x.json"),
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps byte-identical legacy behavior without a resolver or for unknown project ids", () => {
    expect(resolveDataFilePath("/data", "_p/p-ext/script")).toBe("/data/_p/p-ext/script.json");
    expect(resolveDataDirPath("/data", "_p/p-ext")).toBe("/data/_p/p-ext");
    expect(resolveProjectRootPath("/data", "p-ext")).toBe("/data/_p/p-ext");
    expect(resolveProjectScopedFilePath("/data", "p-ext", "a/b.json")).toBe("/data/_p/p-ext/a/b.json");

    setProjectLocationResolver(() => undefined);
    expect(resolveDataFilePath("/data", "_p/p-ext/script")).toBe("/data/_p/p-ext/script.json");
    expect(resolveDataDirPath("/data", "_p/p-ext")).toBe("/data/_p/p-ext");
    expect(resolveProjectRootPath("/data", "p-ext")).toBe("/data/_p/p-ext");
    expect(resolveProjectFileUrl("/data", "project-file://p-ext/a.json")).toBe("/data/_p/p-ext/a.json");
  });

  it("does not redirect bare or non-project prefixes", () => {
    setProjectLocationResolver((projectId) => (projectId === "p-ext" ? "/external/p-ext" : undefined));
    expect(resolveDataDirPath("/data", "_p")).toBe("/data/_p");
    expect(resolveDataFilePath("/data", "_shared/characters")).toBe("/data/_shared/characters.json");
    expect(resolveDataDirPath("/data", "_remotion/queue")).toBe("/data/_remotion/queue");
  });

  it("enforces containment against the external location root", () => {
    const { root: externalRoot, cleanup } = makeExternalRoot();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystudio-location-outside-"));
    fs.mkdirSync(path.join(externalRoot, "link-target"), { recursive: true });
    fs.symlinkSync(outsideRoot, path.join(externalRoot, "link"));
    setProjectLocationResolver((projectId) => (projectId === "p-ext" ? externalRoot : undefined));
    try {
      expect(resolveDataFilePath("/data", "_p/p-ext/link-target/state")).toBe(
        path.join(externalRoot, "link-target", "state.json"),
      );
      expect(() => resolveDataFilePath("/data", "_p/p-ext/link/secret")).toThrow("escapes");
      expect(() => resolveProjectScopedFilePath("/data", "p-ext", "../escape")).toThrow("escapes");
    } finally {
      setProjectLocationResolver(null);
      cleanup();
      fs.rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it("ignores a resolver that throws or returns a non-string", () => {
    setProjectLocationResolver((projectId) => {
      if (projectId === "p-throw") throw new Error("boom");
      if (projectId === "p-empty") return "";
      return null as unknown as string;
    });
    expect(resolveDataFilePath("/data", "_p/p-throw/script")).toBe("/data/_p/p-throw/script.json");
    expect(resolveDataFilePath("/data", "_p/p-empty/script")).toBe("/data/_p/p-empty/script.json");
    expect(resolveProjectRootPath("/data", "p-other")).toBe("/data/_p/p-other");
  });
});
