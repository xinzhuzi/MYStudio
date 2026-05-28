import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createStoredVisualManual,
  listStoredVisualManuals,
  readStoredVisualManual,
  writeStoredVisualManualImages,
  writeStoredVisualManual,
} from "./studio-visual-manuals-storage";

let tempRoot = "";
let sourceRoot = "";
let storageRoot = "";

describe("studio visual manuals storage", () => {
  beforeEach(async () => {
    tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mystudio-visual-manuals-"));
    sourceRoot = path.join(tempRoot, "source");
    storageRoot = path.join(tempRoot, "storage");
    await seedVisualManual(sourceRoot);
  });

  afterEach(async () => {
    if (tempRoot) {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("lists Toonflow visual manuals from the synced storage copy", async () => {
    const manuals = await listStoredVisualManuals({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    });

    expect(manuals).toHaveLength(1);
    expect(manuals[0]).toMatchObject({
      stylePath: "daojie_ink_guofeng",
      name: "水墨国风修仙",
      category: "daojie",
      moduleCount: 3,
      imageCount: 1,
      sourceExists: true,
      isCustomized: false,
    });
    expect(manuals[0]?.images[0]?.url).toBe("studio-skill://art_skills/daojie_ink_guofeng/images/style_ref.png");
  });

  it("falls back to runtime Toonflow visual manuals when bundled source is missing", async () => {
    const primaryRoot = path.join(tempRoot, "empty-source");
    const runtimeRoot = path.join(tempRoot, "toonflow-runtime");
    await seedVisualManual(runtimeRoot);

    const manuals = await listStoredVisualManuals({
      sourceRoot: primaryRoot,
      fallbackSourceRoots: [runtimeRoot],
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    });

    expect(manuals).toHaveLength(1);
    expect(manuals[0]).toMatchObject({
      stylePath: "daojie_ink_guofeng",
      sourceExists: true,
    });
    expect(manuals[0]?.sourcePath).toBe(path.join(runtimeRoot, "art_skills", "daojie_ink_guofeng"));
  });

  it("writes edits to storage without changing the bundled seed", async () => {
    await listStoredVisualManuals({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    });

    await writeStoredVisualManual(storageRoot, "daojie_ink_guofeng", {
      name: "道劫水墨风格",
      modules: [
        { value: "README", content: "水墨国风修仙\n\n旧说明" },
        { value: "prefix", content: "新的前缀" },
      ],
    });

    const detail = await readStoredVisualManual({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    }, "daojie_ink_guofeng");
    const sourceReadme = await fs.promises.readFile(
      path.join(sourceRoot, "art_skills", "daojie_ink_guofeng", "README.md"),
      "utf-8",
    );

    expect(detail.name).toBe("道劫水墨风格");
    expect(detail.isCustomized).toBe(true);
    expect(detail.modules.find((module) => module.value === "prefix")?.content).toBe("新的前缀");
    expect(sourceReadme).toContain("水墨国风修仙");
    expect(sourceReadme).not.toContain("道劫水墨风格");
  });

  it("creates new visual manual directories under art_skills", async () => {
    const stylePath = await createStoredVisualManual(storageRoot, {
      stylePath: "custom_ink",
      name: "自定义水墨",
    });

    const detail = await readStoredVisualManual({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    }, stylePath);

    expect(detail.name).toBe("自定义水墨");
    expect(detail.sourceExists).toBe(false);
    expect(fs.existsSync(path.join(storageRoot, "art_skills", "custom_ink", "README.md"))).toBe(true);
  });

  it("updates visual manual images in the storage copy", async () => {
    await listStoredVisualManuals({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    });

    await writeStoredVisualManual(storageRoot, "daojie_ink_guofeng", {
      name: "水墨国风修仙",
      modules: [],
      images: [
        {
          name: "new-ref.png",
          dataUrl: `data:image/png;base64,${Buffer.from("new image").toString("base64")}`,
        },
      ],
    });

    const detail = await readStoredVisualManual({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    }, "daojie_ink_guofeng");

    expect(detail.imageCount).toBe(1);
    expect(detail.images[0]?.name).toMatch(/^new-ref-/);
    expect(detail.images[0]?.name.endsWith(".png")).toBe(true);
    expect(detail.isCustomized).toBe(true);
    expect(fs.existsSync(path.join(storageRoot, "art_skills", "daojie_ink_guofeng", "images", "style_ref.png"))).toBe(false);
  });

  it("updates visual manual images without overwriting manual text drafts", async () => {
    await listStoredVisualManuals({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    });

    await fs.promises.writeFile(
      path.join(storageRoot, "art_skills", "daojie_ink_guofeng", "prefix.md"),
      "用户正在编辑的前缀",
      "utf-8",
    );
    await writeStoredVisualManualImages(storageRoot, "daojie_ink_guofeng", {
      images: [
        {
          relativePath: "art_skills/daojie_ink_guofeng/images/style_ref.png",
          name: "style_ref.png",
        },
        {
          name: "added.png",
          dataUrl: `data:image/png;base64,${Buffer.from("added image").toString("base64")}`,
        },
      ],
    });

    const detail = await readStoredVisualManual({
      sourceRoot,
      storageRoot,
      makeFileUrl: (relativePath) => `studio-skill://${relativePath}`,
    }, "daojie_ink_guofeng");

    expect(detail.imageCount).toBe(2);
    expect(detail.images.map((image) => image.name)).toContain("style_ref.png");
    expect(detail.images.some((image) => image.name.startsWith("added-") && image.name.endsWith(".png"))).toBe(true);
    expect(detail.modules.find((module) => module.value === "prefix")?.content).toBe("用户正在编辑的前缀");
  });
});

async function seedVisualManual(root: string) {
  const manualRoot = path.join(root, "art_skills", "daojie_ink_guofeng");
  await fs.promises.mkdir(path.join(manualRoot, "art_prompt"), { recursive: true });
  await fs.promises.mkdir(path.join(manualRoot, "driector_skills"), { recursive: true });
  await fs.promises.mkdir(path.join(manualRoot, "images"), { recursive: true });
  await fs.promises.writeFile(path.join(manualRoot, "README.md"), "水墨国风修仙\n\n道劫专属说明", "utf-8");
  await fs.promises.writeFile(path.join(manualRoot, "prefix.md"), "水墨国风", "utf-8");
  await fs.promises.writeFile(path.join(manualRoot, "art_prompt", "art_character.md"), "角色提示词", "utf-8");
  await fs.promises.writeFile(path.join(manualRoot, "images", "style_ref.png"), "png", "utf-8");
}
