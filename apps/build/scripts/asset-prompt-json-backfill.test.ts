// @vitest-environment node
/**
 * asset_prompt_json_backfill.py 接线测试(10-27 应用侧接线:store 位提示词真源回填)。
 *
 * 仓内 *.test.ts 零 python spawn 先例(本任务 grep 实证)——本件首行探测 python3,
 * 不可用时 python 实弹段 skipIf 跳过并显式打印跳过原因;TS 侧 fixture 断言
 * (剥除规则/家夹键单源行为)不依赖 python,任何环境照跑兜底。
 *
 * 硬约束=剥除规则 parity 三钉:
 *  ① 脚本产物 body_base.主体词 与 vitest 直调 TS deriveBareSubjectFromClothed 同输入逐字节相等;
 *  ② 脚本内 Python 实现(--derive-probe)对同批输入与 TS 输出逐字节相等(CLOTHING_SEGMENT
 *    任何改动即红);
 *  ③ sanitize 移植(--sanitize-probe)对资产名用例集与 assets-sqlite.ts
 *    sanitizeAssetFolderName 输出相等。
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";

import { deriveBareSubjectFromClothed } from "@/lib/studio/asset-character-json";
import { sanitizeAssetFolderName } from "@/electron/storage/assets-sqlite";

const SCRIPT = path.resolve(import.meta.dirname, "asset_prompt_json_backfill.py");
/** repo 源真身(scripts→build→apps→repo 三级上溯,再进 apps/frontend)。 */
const REPO_YANLIAO = path.resolve(
  import.meta.dirname,
  "../../../apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/晏燎.json",
);

/** python3 探测(不可用=python 实弹段跳过;TS 侧断言照跑)。 */
const PYTHON = (() => {
  try {
    const probe = spawnSync("python3", ["--version"], { encoding: "utf-8" });
    return probe.status === 0 ? "python3" : null;
  } catch {
    return null;
  }
})();
if (!PYTHON) {
  // eslint-disable-next-line no-console -- 显式打印跳过原因(testPlan 钉死:skipIf 不可用须明示)
  console.warn("[asset-prompt-json-backfill.test] python3 不可用:python 实弹段全部跳过,TS 侧 fixture 断言照跑");
}

// ---------------------------------------------------------------------------
// 勘察-DB 真实句(剥除 parity 输入;与 asset-character-json.test.ts 回归句同源)
// ---------------------------------------------------------------------------

const XIAOZAYI_CLOTHED =
  "约十岁的男童,码头杂役,谨小慎微、眼神怯生,非少年非青年,圆脸稚气未脱、脸颊圆润,偏大的深色眼睛。肤色微黄,身形瘦小,身高仅及成人胸口、约一百三十厘米,五头身幼态比例,五官由稚气孩童神态自然推导。素颜状态,中性微表情含怯意,目视前方,自然站立、双臂自然下垂、双脚微分。土黄粗布短褐缀补丁,配旧布裤,腰束栗褐布绳,衣裤完整可穿;赤足。凌乱的及肩墨黑短发,碎发垂在额前与耳侧。";
const XIAOZAYI_FULL_DB =
  "约十岁的男童,码头杂役,谨小慎微、眼神怯生,非少年非青年,圆脸稚气未脱、脸颊圆润,偏大的深色眼睛。肤色微黄,身形瘦小,身高仅及成人胸口、约一百三十厘米,五头身幼态比例,五官由稚气孩童神态自然推导。素颜状态,中性微表情含怯意,目视前方,自然站立、双臂自然下垂、双脚微分。土黄粗布短褐缀补丁,配旧布裤,腰束栗褐布绳,衣裤完整可穿;赤足。凌乱的及肩墨黑短发,碎发垂在额前与耳侧。无持物、无发饰配饰。宣纸白纯色背景,无场景元素。同一画面从左至右并排四视图:人像特写自头顶至锁骨完整入画,正面、侧面、背面全身立像自头顶至脚底完整入画;21:9 横幅,均匀柔和散光。四视图面容、体型、发型、基础服装完全一致。";
const MIXED_SINGLE_CLAUSE = "圆脸稚气的男童,着土黄粗布短褐,凌乱的及肩墨黑短发。";
const ALL_CLOTHING = "土黄粗布短褐缀补丁,配旧布裤。宣纸白纯色背景,无场景元素。";
const BARE_DECLARED = "男童全身素体,赤足站立。";

const DERIVE_BATCH = [XIAOZAYI_CLOTHED, XIAOZAYI_FULL_DB, MIXED_SINGLE_CLAUSE, ALL_CLOTHING, BARE_DECLARED, "", "   "];

const SANITIZE_CASES = [
  "CON",
  "con",
  "COM3",
  "0002_R-3239_回元丹",
  "01_人皇苍_海报",
  "未命名.",
  ".  尾点.",
  'a/b\\:*?"<>|b',
  `超长${"名".repeat(100)}`,
  "",
  "   ",
  "小杂役",
];

// ---------------------------------------------------------------------------
// 方案 schemaTemplates 定文(与 asset_truth_prompts_provision_1027.py 同源;断言钉形)
// ---------------------------------------------------------------------------

const SCENE_KIND_TEMPLATES: Record<string, string> = {
  场景: "{主体词}。空镜场景图,画面无人物;空间层次与景别以主体词为准,画风与色调与设定一致。",
  概念气氛图: "{主体词}。以此景为核心的宽幅概念气氛图,强调光影氛围与整体色调,构图留白舒展。",
  "3D剖面场景图": "{主体词}。以剖面视角呈现该场景的空间层次与结构关系,剖面切面清晰可读。",
};
const TOOL_KIND_TEMPLATE =
  "{主体词}。纯器物静物独立陈列,单一物件完整入画,居中平视构图,均匀漫射光;图为带透明通道的RGBA透明底素材图,背景全透明。";
const SCENE_NOTE_VERBATIM = "DB 原句直录(不剥除,样例句本身即完整场景指令含前景/中景/远景层次语言)";
const TOOL_NOTE_VERBATIM = "DB 原句直录(竹筹/青盐鞭样例已含静物陈列语言)";
const EMPTY_NOTE = "DB 无 prompt 且无 description,主体词待补";
const ROLE_NOTE_DERIVED =
  "自动派生:DB句按 asset-character-json.ts deriveBareSubjectFromClothed 同规则剥衣物/持物/背景段;衣物走各型编辑注入";
const ROLE_NOTE_FAILED = "剥除失败,待人工补";

// ---------------------------------------------------------------------------
// TS 侧 fixture 断言(无 python 环境的兜底段;不依赖脚本运行)
// ---------------------------------------------------------------------------

describe("TS 侧剥除/家夹键单源行为(python 缺席时的 fixture 兜底)", () => {
  it("deriveBareSubjectFromClothed:小杂役带衣句剥衣留身份+素体基准尾", () => {
    const derived = deriveBareSubjectFromClothed(XIAOZAYI_CLOTHED);
    expect(derived).toBeTruthy();
    expect(derived).toContain("约十岁的男童");
    expect(derived).toContain("码头杂役");
    expect(derived).toContain("墨黑短发");
    expect(derived).toContain("通身素体呈现");
    expect(derived).not.toMatch(/短褐|布裤|布绳|衣/);
  });

  it("deriveBareSubjectFromClothed:全衣物句剥空返回 null;混排单句降级子句剥除", () => {
    expect(deriveBareSubjectFromClothed(ALL_CLOTHING)).toBeNull();
    const mixed = deriveBareSubjectFromClothed(MIXED_SINGLE_CLAUSE);
    expect(mixed).toBeTruthy();
    expect(mixed).toContain("圆脸稚气的男童");
    expect(mixed).toContain("墨黑短发");
    expect(mixed).not.toContain("短褐");
  });

  it("sanitizeAssetFolderName:保留名/尾点/非法字符/截断/空名用例集", () => {
    expect(sanitizeAssetFolderName("CON")).toBe("CON_");
    expect(sanitizeAssetFolderName("con")).toBe("con_");
    expect(sanitizeAssetFolderName("COM3")).toBe("COM3_");
    expect(sanitizeAssetFolderName("末点.")).toBe("末点");
    expect(sanitizeAssetFolderName('a/b\\:*?"<>|b')).toBe("a_b________b");
    expect(sanitizeAssetFolderName("")).toBe("未命名");
    expect(sanitizeAssetFolderName("   ")).toBe("未命名");
    const truncated = sanitizeAssetFolderName(`超长${"名".repeat(100)}`);
    expect(truncated.length).toBe(80);
    expect([...truncated].length * 3).toBe(240); // 全 3 字节汉字恰触 240B 上限
  });
});

// ---------------------------------------------------------------------------
// python 实弹段(python3 不可用整段跳过)
// ---------------------------------------------------------------------------

describe.skipIf(!PYTHON)("asset_prompt_json_backfill.py 实弹(fixture store 回填)", () => {
  let workDir: string;
  let storeRoot: string;
  let skillsRoot: string;

  /** 造 fixture sqlite 库(经 python3 sqlite3;仅实弹段消费)。行=[type,name,prompt,description?,filePath?]。 */
  function buildFixtureDb(
    dbPath: string,
    rows: Array<[string, string, string, string?, string?]>,
  ): void {
    const sql = rows
      .map(
        ([type, name, prompt, description, filePath], index) =>
          `INSERT INTO assets (id,type,name,prompt,description,filePath,createdAt,updatedAt) VALUES ('row-${index}','${type}','${name.replace(/'/g, "''")}','${prompt.replace(/'/g, "''")}','${(description ?? "").replace(/'/g, "''")}',${filePath === undefined ? "NULL" : `'${filePath.replace(/'/g, "''")}'`},'2026-10-27','2026-10-27');`,
      )
      .join("\n");
    const script = [
      "import sqlite3, os",
      `os.makedirs(os.path.dirname(${JSON.stringify(dbPath)}), exist_ok=True)`,
      `con = sqlite3.connect(${JSON.stringify(dbPath)})`,
      "con.execute('''CREATE TABLE assets (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '', prompt TEXT DEFAULT '', setting TEXT DEFAULT '', remark TEXT DEFAULT '', tags TEXT DEFAULT '[]', filePath TEXT, images TEXT DEFAULT '[]', promptOverrides TEXT, source TEXT DEFAULT 'manying-local', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)''')",
      ...sql.split("\n").map((line) => (line ? `con.execute(${JSON.stringify(line)})` : "")),
      "con.commit()",
      "con.close()",
    ].filter(Boolean);
    const result = spawnSync(PYTHON!, ["-c", script.join("\n")], { encoding: "utf-8" });
    expect(result.status, result.stderr).toBe(0);
  }

  function runScript(...args: string[]) {
    return spawnSync(PYTHON!, [SCRIPT, ...args], { encoding: "utf-8" });
  }

  /** 骨架产物形状(方案 schemaTemplates;可选键=按型缺省/无主图省略)。 */
  type PromptSkeletonDoc = {
    schema_version?: number;
    asset_type?: string;
    identity_source?: string;
    body_base?: { 主体词: string; 主体词注记: string };
    scene_base?: { 主体词: string; 主体词注记: string };
    prop_base?: { 主体词: string; 主体词注记: string };
    kind_prompts?: Record<string, string>;
    provenance?: Record<string, string>;
  };

  function readPromptJson(fileName: string): PromptSkeletonDoc {
    const raw = readFileSync(path.join(storeRoot, "files", "prompts", fileName), "utf-8");
    return JSON.parse(raw) as PromptSkeletonDoc;
  }

  function listPrompts(): string[] {
    const dir = path.join(storeRoot, "files", "prompts");
    return existsSync(dir) ? readdirSync(dir).sort() : [];
  }

  function snapshotPrompts(): Record<string, string> {
    const dir = path.join(storeRoot, "files", "prompts");
    const out: Record<string, string> = {};
    for (const name of listPrompts()) {
      out[name] = readFileSync(path.join(dir, name), "utf-8");
    }
    return out;
  }

  beforeAll(() => {
    workDir = mkdtempSync(path.join(os.tmpdir(), "asset-prompt-backfill-"));
    storeRoot = path.join(workDir, "store", "assets");
    skillsRoot = path.join(workDir, "skills");
    mkdirSync(storeRoot, { recursive: true });
    buildFixtureDb(path.join(storeRoot, "assets.db"), [
      ["role", "小杂役", XIAOZAYI_CLOTHED, "", "role/小杂役/小杂役_人物图.png"],
      ["role", "无句者", "", "", undefined],
      ["role", "晏燎", "约十七八岁的男孩,道口镇散修孤儿。"],
      ["role", "万妖金庭", "未指定;正文生成前须回查上位设定。"],
      ["scene", "万妖金庭", "金庭巍峨,妖气缭绕。"],
      ["role", "蛟龙", ""],
      ["tool", "蛟龙", "蛟龙概念图,青鳞覆体。"],
      ["scene", "山门远景", "云雾山门,残碑与剑痕。", "", "scene/山门远景/山门远景_概念.png"],
      ["tool", "斩魂剑", "断剑三尺半,断面参差如犬牙。"],
      ["role", "CON", "保留名用例角色。", "", "role/CON/CON_定妆.png"],
      ["role", "末点.", "尾点用例角色。", "", "role/末点./末点.png"],
      ["role", `超长${"名".repeat(100)}`, "截断用例角色。", "", `role/超长${"名".repeat(100)}/主图.png`],
      ["role", "0002_R-3239_回元丹", "序号编码段剥除用例角色。", "", "role/0002_R-3239_回元丹/回元丹_主图.png"],
      ["role", "全衣者", ALL_CLOTHING],
      // description 回落用例(scopeRule:主体词源=DB prompt,空回落 description)
      ["role", "管事替身", "", "中年男性,清瘦精明,灰褐粗布长衫,怀揣竹筹。"],
      ["tool", "旧布背囊", "", "粗布缝制的旧背囊,补丁累累。", "tool/旧布背囊/旧布背囊_a1.png"],
      ["scene", "空景者", "", "", undefined],
    ]);
  });

  afterAll(() => {
    if (workDir) rmSync(workDir, { recursive: true, force: true });
  });

  it("断言三:sanitize 移植与 assets-sqlite.ts sanitizeAssetFolderName 用例集逐个相等", () => {
    const probe = spawnSync(PYTHON!, [SCRIPT, "--sanitize-probe"], {
      input: JSON.stringify(SANITIZE_CASES),
      encoding: "utf-8",
    });
    expect(probe.status, probe.stderr).toBe(0);
    const got = JSON.parse(probe.stdout.trim()) as string[];
    expect(got).toEqual(SANITIZE_CASES.map((name) => sanitizeAssetFolderName(name)));
  });

  it("断言二:--derive-probe 对同批输入与 TS deriveBareSubjectFromClothed 逐字节相等", () => {
    const probe = spawnSync(PYTHON!, [SCRIPT, "--derive-probe"], {
      input: JSON.stringify(DERIVE_BATCH),
      encoding: "utf-8",
    });
    expect(probe.status, probe.stderr).toBe(0);
    const got = JSON.parse(probe.stdout.trim()) as Array<string | null>;
    expect(got).toEqual(DERIVE_BATCH.map((text) => deriveBareSubjectFromClothed(text)));
  });

  it("dry-run 零写盘", () => {
    const run = runScript("--store-root", storeRoot, "--skills-root", skillsRoot, "--dry-run");
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("dry_run=True");
    expect(existsSync(path.join(storeRoot, "files", "prompts"))).toBe(false);
  });

  it("实弹回填:产物数/撞名命名/平铺位不落/骨架域", () => {
    const run = runScript("--store-root", storeRoot, "--skills-root", skillsRoot);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("collisions=['万妖金庭', '蛟龙']");

    const files = listPrompts();
    // 17 行=17 件;撞名 4 行各落 @type 位,平铺位不落
    expect(files).toHaveLength(17);
    expect(files).toContain("小杂役.json");
    expect(files).toContain("无句者.json");
    expect(files).toContain("山门远景.json");
    expect(files).toContain("斩魂剑.json");
    expect(files).toContain("万妖金庭@role.json");
    expect(files).toContain("万妖金庭@scene.json");
    expect(files).toContain("蛟龙@role.json");
    expect(files).toContain("蛟龙@tool.json");
    expect(files).not.toContain("万妖金庭.json");
    expect(files).not.toContain("蛟龙.json");
    // identity_source=`<type>/<家夹键>/<文件名>`(pathConvention①:文件名=filePath 尾段;
    // 家夹键= sanitize 后:保留名/尾点/截断/序号编码剥除)
    expect(readPromptJson("小杂役.json").identity_source).toBe("role/小杂役/小杂役_人物图.png");
    expect(readPromptJson("CON.json").identity_source).toBe("role/CON_/CON_定妆.png");
    expect(readPromptJson("末点..json").identity_source).toBe("role/末点/末点.png");
    expect(readPromptJson(`超长${"名".repeat(100)}.json`).identity_source).toBe(
      `role/${sanitizeAssetFolderName(`超长${"名".repeat(100)}`)}/主图.png`,
    );
    expect(readPromptJson("0002_R-3239_回元丹.json").identity_source).toBe("role/回元丹/回元丹_主图.png");
    // 无主图→identity_source 整键省略(不落目录形占位)
    expect(readPromptJson("无句者.json")).not.toHaveProperty("identity_source");
    expect(readPromptJson("空景者.json")).not.toHaveProperty("identity_source");
    // asset_type 全件落型(role/scene/tool;store 读路校验吃这个字段)
    expect(readPromptJson("小杂役.json").asset_type).toBe("role");
    expect(readPromptJson("山门远景.json").asset_type).toBe("scene");
    expect(readPromptJson("斩魂剑.json").asset_type).toBe("tool");
    // 剥除失败计入汇总(stdout 汇总行可见;空源不计,仅源非空剥除全灭者计)
    expect(run.stdout).toContain("strip_failures=1");
  });

  it("scene/tool 骨架=方案 schemaTemplates(scene_base/prop_base 直录+占位符模板,schema_version=1)", () => {
    const scene = readPromptJson("山门远景.json");
    expect(scene.schema_version).toBe(1);
    expect(scene.scene_base).toEqual({
      主体词: "云雾山门,残碑与剑痕。",
      主体词注记: SCENE_NOTE_VERBATIM,
    });
    expect(scene.kind_prompts).toEqual({
      场景: SCENE_KIND_TEMPLATES["场景"].replace("{主体词}", "云雾山门,残碑与剑痕。"),
      概念气氛图: SCENE_KIND_TEMPLATES["概念气氛图"].replace("{主体词}", "云雾山门,残碑与剑痕。"),
      "3D剖面场景图": SCENE_KIND_TEMPLATES["3D剖面场景图"].replace("{主体词}", "云雾山门,残碑与剑痕。"),
    });
    expect(scene).not.toHaveProperty("body_base");
    expect(scene).not.toHaveProperty("prop_base");

    const tool = readPromptJson("斩魂剑.json");
    expect(tool.schema_version).toBe(1);
    expect(tool.prop_base).toEqual({ 主体词: "断剑三尺半,断面参差如犬牙。", 主体词注记: TOOL_NOTE_VERBATIM });
    expect(tool.kind_prompts).toEqual({ 道具: TOOL_KIND_TEMPLATE.replace("{主体词}", "断剑三尺半,断面参差如犬牙。") });
    expect(tool).not.toHaveProperty("scene_base");

    // 主体词源=DB prompt 空回落 description(scopeRule);provenance 信封双 db 字段留痕
    const toolFallback = readPromptJson("旧布背囊.json");
    expect(toolFallback.prop_base?.主体词).toBe("粗布缝制的旧背囊,补丁累累。");
    expect(toolFallback.prop_base?.主体词注记).toBe(TOOL_NOTE_VERBATIM);
    expect(toolFallback.kind_prompts).toEqual({
      道具: TOOL_KIND_TEMPLATE.replace("{主体词}", "粗布缝制的旧背囊,补丁累累。"),
    });
    expect(toolFallback.provenance?.db_prompt).toBe("");
    expect(toolFallback.provenance?.db_description).toBe("粗布缝制的旧背囊,补丁累累。");

    // 均空→空串骨架(待补)+{主体词}占位符保留
    const emptyScene = readPromptJson("空景者.json");
    expect(emptyScene.scene_base).toEqual({ 主体词: "", 主体词注记: EMPTY_NOTE });
    expect(emptyScene.kind_prompts).toEqual(SCENE_KIND_TEMPLATES);
  });

  it("断言一:产物 body_base.主体词 与 TS deriveBareSubjectFromClothed 同输入逐字节相等", () => {
    const doc = readPromptJson("小杂役.json");
    expect(doc.schema_version).toBe(2);
    // role 骨架=主体词+主体词注记子集(方案定文;无 zh/出图配方额外键)
    expect(Object.keys(doc.body_base ?? {})).toEqual(["主体词", "主体词注记"]);
    expect(doc.body_base?.主体词).toBe(deriveBareSubjectFromClothed(XIAOZAYI_CLOTHED));
    expect(doc.body_base?.主体词注记).toBe(ROLE_NOTE_DERIVED);
    // provenance 公共信封(方案:generator/generated_at/db_prompt/db_description/note)
    expect(doc.provenance?.generator).toBe("asset_prompt_json_backfill.py");
    expect(doc.provenance?.generated_at).toBeTruthy();
    expect(doc.provenance?.db_prompt).toBe(XIAOZAYI_CLOTHED);
    expect(doc.provenance?.db_description).toBe("");
    expect(doc.provenance?.note).toBe("db 字段仅审计溯源,消费端不读");

    const bare = readPromptJson("全衣者.json");
    expect(bare.body_base?.主体词).toBe("");
    expect(bare.body_base?.主体词注记).toBe(ROLE_NOTE_FAILED);
    const empty = readPromptJson("无句者.json");
    expect(empty.body_base?.主体词).toBe("");

    // 主体词源=DB prompt 空回落 description:role 派生吃 description,与 TS 同输入逐字节 parity
    const steward = readPromptJson("管事替身.json");
    expect(steward.body_base?.主体词).toBe(
      deriveBareSubjectFromClothed("中年男性,清瘦精明,灰褐粗布长衫,怀揣竹筹。"),
    );
    expect(steward.body_base?.主体词).not.toContain("长衫");
    expect(steward.provenance?.db_prompt).toBe("");
    expect(steward.provenance?.db_description).toBe("中年男性,清瘦精明,灰褐粗布长衫,怀揣竹筹。");
  });

  it("晏燎种子迁移:store 缺+技能副本缺→repo 源逐字节复制", () => {
    const storeCopy = readFileSync(path.join(storeRoot, "files", "prompts", "晏燎.json"));
    const repoSource = readFileSync(REPO_YANLIAO);
    expect(storeCopy.equals(repoSource)).toBe(true);
  });

  it("幂等:重跑零 diff(已存在默认跳过)", () => {
    const before = snapshotPrompts();
    const run = runScript("--store-root", storeRoot, "--skills-root", skillsRoot);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("skipped_existing=17");
    expect(run.stdout).toContain("generated=0");
    expect(snapshotPrompts()).toEqual(before);
  });

  it("技能副本迁移分支:store 缺+技能副本在→复制技能副本而非 repo(保旧版用户编辑)", () => {
    const store2 = path.join(workDir, "store2", "assets");
    mkdirSync(store2, { recursive: true });
    buildFixtureDb(path.join(store2, "assets.db"), [["role", "晏燎", "过时 DB 句。"]]);
    const skills2 = path.join(workDir, "skills2");
    const skillsCopy = path.join(skills2, "art_skills", "daojie_ink_guofeng", "json", "晏燎.json");
    mkdirSync(path.dirname(skillsCopy), { recursive: true });
    const userEdited = '{"user":"edited"}';
    writeFileSync(skillsCopy, userEdited, "utf-8");

    const run = runScript("--store-root", store2, "--skills-root", skills2);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("seeded_skills_copy=1");
    expect(readFileSync(path.join(store2, "files", "prompts", "晏燎.json"), "utf-8")).toBe(userEdited);
  });

  it("同型同名多行→硬失败退出码非零并报错列名", () => {
    const store3 = path.join(workDir, "store3", "assets");
    mkdirSync(store3, { recursive: true });
    buildFixtureDb(path.join(store3, "assets.db"), [
      ["role", "重名者", "第一行句。"],
      ["role", "重名者", "第二行句。"],
    ]);
    const run = runScript("--store-root", store3, "--skills-root", skillsRoot);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("重名者");
    expect(existsSync(path.join(store3, "files", "prompts"))).toBe(false);
  });

  it("撞名行 repo 真源命中→同轨种子迁移(不落骨架,双 @type 位各得逐字节副本)", () => {
    const store4 = path.join(workDir, "store4", "assets");
    mkdirSync(store4, { recursive: true });
    buildFixtureDb(path.join(store4, "assets.db"), [
      ["role", "撞名真源", "骨架句不应出现。"],
      ["scene", "撞名真源", "骨架句不应出现。"],
    ]);
    const repoAssets4 = path.join(workDir, "repo-assets-4");
    const repoTruth = path.join(repoAssets4, "art_skills", "testpkg", "json", "撞名真源.json");
    mkdirSync(path.dirname(repoTruth), { recursive: true });
    const truthText = '{"repo":"撞名真源手工真源"}';
    writeFileSync(repoTruth, truthText, "utf-8");

    const run = runScript(
      "--store-root", store4,
      "--skills-root", skillsRoot,
      "--repo-assets", repoAssets4,
    );
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("seeded_repo_copy=2");
    expect(run.stdout).toContain("generated=0");
    const prompts4 = path.join(store4, "files", "prompts");
    expect(readdirSync(prompts4).sort()).toEqual(["撞名真源@role.json", "撞名真源@scene.json"]);
    expect(readFileSync(path.join(prompts4, "撞名真源@role.json"), "utf-8")).toBe(truthText);
    expect(readFileSync(path.join(prompts4, "撞名真源@scene.json"), "utf-8")).toBe(truthText);
    // 平铺位不落(撞名组恒 @ 形)
    expect(existsSync(path.join(prompts4, "撞名真源.json"))).toBe(false);
  });
});
