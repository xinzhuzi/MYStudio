import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addAsset,
  initAssetsStorage,
  listAssetFamilyAssets,
} from "./studio-assets-storage";
import { getDbPath, runSqliteExec, escapeSql } from "./assets-sqlite";

/** R4 聚显主进程口径锁(10-19-script-asset-corridor-blank D3):
 * listAssetFamilyAssets = batchMatch 同源候选全集(buildAssetNameCandidateCondition
 * 语义:name 精确/LIKE/remark LIKE,天然含别名件)+ updatedAt 倒序;
 * role/scene/tool 三类同口径。生产体量锚点:晏燎族 31 行(本体+衍生,prd R4)。 */

let tempAssetRoot: string | undefined;

function initTempAssetsStorage() {
  tempAssetRoot = mkdtempSync(join(tmpdir(), "mystudio-asset-family-test-"));
  initAssetsStorage(tempAssetRoot);
}

function seedImageFile(tag: string) {
  const source = join(tempAssetRoot!, `${tag}.png`);
  writeFileSync(source, "fake image");
  return source;
}

/** addAsset 落库时 updatedAt=now;测试需自定族内时序 → 直改行(ISO 串字典序=时间序)。 */
function setUpdatedAt(id: string, iso: string) {
  runSqliteExec(getDbPath(), `UPDATE assets SET updatedAt='${escapeSql(iso)}' WHERE id='${escapeSql(id)}';`);
}

function isoAt(minutes: number) {
  return new Date(Date.UTC(2026, 9, 15, 0, 0, 0) + minutes * 60_000).toISOString();
}

afterEach(() => {
  if (tempAssetRoot) {
    rmSync(tempAssetRoot, { recursive: true, force: true });
    tempAssetRoot = undefined;
  }
});

describe("listAssetFamilyAssets(R4 聚显聚合查询)", () => {
  it("候选全集=精确+name LIKE 衍生+remark 命中;排除同名异类/无关行;updatedAt 倒序", async () => {
    initTempAssetsStorage();
    const body = addAsset({ type: "role", name: "晏燎", description: "本体", sourceFilePath: seedImageFile("body") });
    const newer = addAsset({ type: "role", name: "晏燎_练气期_3", description: "衍生", sourceFilePath: seedImageFile("d1") });
    const older = addAsset({ type: "role", name: "晏燎_筑基期", description: "衍生", sourceFilePath: seedImageFile("d2") });
    const remarkHit = addAsset({ type: "role", name: "剑修甲", description: "剑修", remark: "与晏燎同门", sourceFilePath: seedImageFile("d3") });
    const stranger = addAsset({ type: "role", name: "独孤剑尘", description: "无关", sourceFilePath: seedImageFile("d4") });
    const sameNameOtherType = addAsset({ type: "scene", name: "晏燎", description: "同名场景", sourceFilePath: seedImageFile("d5") });
    setUpdatedAt(body.id, isoAt(10));
    setUpdatedAt(newer.id, isoAt(30));
    setUpdatedAt(older.id, isoAt(20));
    setUpdatedAt(remarkHit.id, isoAt(25));
    setUpdatedAt(stranger.id, isoAt(40));
    setUpdatedAt(sameNameOtherType.id, isoAt(50));

    const family = await listAssetFamilyAssets("role", "晏燎");

    expect(family.map((item) => item.id)).toEqual([newer.id, remarkHit.id, older.id, body.id]);
    expect(family.map((item) => item.previewUrl?.startsWith("asset-file://role/"))).toEqual([true, true, true, true]);
  });

  it("别名串行(「李先生;管事」)由候选条件天然覆盖", async () => {
    initTempAssetsStorage();
    const shared = addAsset({ type: "role", name: "李先生;管事", description: "塾馆先生", sourceFilePath: seedImageFile("s1") });
    setUpdatedAt(shared.id, isoAt(10));

    const byAlias = await listAssetFamilyAssets("role", "李先生");
    const byAlias2 = await listAssetFamilyAssets("role", "管事");

    expect(byAlias.map((item) => item.id)).toEqual([shared.id]);
    expect(byAlias2.map((item) => item.id)).toEqual([shared.id]);
  });

  it("生产体量锚点:晏燎族 31 行(本体+30 衍生)全入列,倒序", async () => {
    initTempAssetsStorage();
    const ids: string[] = [];
    const body = addAsset({ type: "role", name: "晏燎", description: "本体", sourceFilePath: seedImageFile("anchor-body") });
    ids.push(body.id);
    for (let i = 1; i <= 30; i += 1) {
      const row = addAsset({
        type: "role",
        name: `晏燎_练气期_${i}`,
        description: "衍生",
        sourceFilePath: seedImageFile(`anchor-${i}`),
      });
      ids.push(row.id);
    }
    ids.forEach((id, index) => setUpdatedAt(id, isoAt(index)));
    const unrelated = addAsset({ type: "role", name: "独孤剑尘", description: "族外", sourceFilePath: seedImageFile("anchor-other") });
    setUpdatedAt(unrelated.id, isoAt(99));

    const family = await listAssetFamilyAssets("role", "晏燎");

    expect(family).toHaveLength(31);
    // updatedAt 倒序:isoAt(30) 的衍生行在前,本体(isoAt(0))殿后
    expect(family[0]?.id).toBe(ids[30]);
    expect(family[30]?.id).toBe(body.id);
  });

  it("场景/道具同口径(候选全集+倒序)", async () => {
    initTempAssetsStorage();
    const sceneBody = addAsset({ type: "scene", name: "道口镇", description: "镇", sourceFilePath: seedImageFile("sc1") });
    const sceneDerivative = addAsset({ type: "scene", name: "道口镇_夜景", description: "夜", sourceFilePath: seedImageFile("sc2") });
    const toolBody = addAsset({ type: "tool", name: "替死蛊", description: "蛊", sourceFilePath: seedImageFile("t1") });
    const toolDerivative = addAsset({ type: "tool", name: "替死蛊_变异", description: "变", sourceFilePath: seedImageFile("t2") });
    setUpdatedAt(sceneBody.id, isoAt(1));
    setUpdatedAt(sceneDerivative.id, isoAt(2));
    setUpdatedAt(toolBody.id, isoAt(1));
    setUpdatedAt(toolDerivative.id, isoAt(2));

    await expect(listAssetFamilyAssets("scene", "道口镇")).resolves.toMatchObject([
      { id: sceneDerivative.id },
      { id: sceneBody.id },
    ]);
    await expect(listAssetFamilyAssets("tool", "替死蛊")).resolves.toMatchObject([
      { id: toolDerivative.id },
      { id: toolBody.id },
    ]);
  });

  it("无候选行 → 空数组(渲染层退化为本行图)", async () => {
    initTempAssetsStorage();
    await expect(listAssetFamilyAssets("role", "不存在的角色")).resolves.toEqual([]);
  });
});
