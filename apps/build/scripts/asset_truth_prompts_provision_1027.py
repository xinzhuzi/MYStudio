#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""资产提示词真源 JSON 一次性铺货脚本(10-27)。

用途:读 store 资产库 assets.db(role/scene/tool 三轨全行),为每个资产生成提示词
真源骨架 JSON 写入 <store>/assets/files/prompts/;同时把 repo 手工真源
(daojie_ink_guofeng/json/ 档案族,晏燎.json 为首件)逐字节复制进 store。

用法:
    python3 apps/build/scripts/asset_truth_prompts_provision_1027.py [--dry-run]
        [--force] [--force-refresh] [--store-root <路径>]

旗标:
    --dry-run        零写盘,只打印计划与校验内存态产物。
    --force          已存在的「脚本生成的骨架」按 DB 重刷(手工真源名恒保护,不参与)。
    --force-refresh  已存在的手工真源副本按 repo 种子重拷(晏燎等 repo 手改进 store
                     的唯一通道;默认手工真源只补缺不覆盖)。
    --store-root     显式指定 store 根(=含 assets/assets.db 的 store 目录,或直接给
                     store/assets 目录亦可);默认走 asset-home.json→lastKnownLocation
                     →store/ 自动定位,失败即报错退出并列候选。

产物规则(方案 schemaTemplates/scopeRule/pathConvention 落地):
    文件名 = <资产名>.json;跨类型撞名者落 <资产名>@<type>.json(全组皆 @ 形,平铺
    位不落);同型同名多行=硬失败拒跑。已存在默认跳过(幂等,保护手工/应用编辑)。
    role  → schema_version 2,body_base.主体词 = DB 句按 deriveBareSubjectFromClothed
            同规则剥衣物/持物/背景段后的自动派生素体句(剥除全灭→空串+「剥除失败,
            待人工补」注记,fail-safe)。
    scene → schema_version 1,scene_base.主体词 = DB 原句直录(不剥除)+kind_prompts
            (场景/概念气氛图/3D剖面场景图)占位模板。
    tool  → schema_version 1,prop_base.主体词 = DB 原句直录+kind_prompts(道具)。
    主体词源 = DB prompt,空回落 description,均空→空串骨架(待补)。
    identity_source(可选)= <type>/<家夹键>/<文件名>,家夹键=sanitizeAssetFolderNameDetailed
    全套移植;骨架内引用纯相对路径,不带 asset-file:// 前缀,绝不落绝对路径。

排序注意(实测定谳):DB 现库晏燎本身是 role 行(本回合 sqlite 实查 id=a985c52a-…),
故手工真源复制(方案步骤③④)必须先于骨架生成(方案步骤②)执行——否则骨架会先占
晏燎.json 平铺位,把方案要求的 repo 手工真源逐字节副本顶掉。手工名恒不入骨架重刷集。

依赖:Python 3.9+ 纯 stdlib(argparse/json/os/re/shutil/sqlite3/sys/datetime/
pathlib/urllib.parse)。脚本零触 repo 文件(只读),零写 store 以外任何位置。
"""

import argparse
import json
import os
import re
import shutil
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from urllib.parse import quote

# ---------------------------------------------------------------------------
# 路径常量(repo 侧只读;store 侧=唯一写区)
# ---------------------------------------------------------------------------

def _find_repo_root() -> Path:
    """仓根定位:向上找含 .git 与 apps/ 的祖先目录;兜底 parents[3]。
    (本脚本位 <repo>/apps/build/scripts/,parents[3]=仓根;parents[2]=<repo>/apps
    是首跑翻车点——曾拼出 apps/apps/frontend/… 导致手工真源目录判定不存在。)"""
    here = Path(__file__).resolve()
    for parent in here.parents:
        if (parent / "apps").is_dir() and (parent / ".git").exists():
            return parent
    return here.parents[3]


REPO_ROOT = _find_repo_root()
REPO_JSON_DIR = REPO_ROOT / "apps" / "frontend" / "assets" / "studio-manuals" / "art_skills" / "daojie_ink_guofeng" / "json"
USER_DATA_DIR = Path(os.environ.get("HOME", "")) / "Library" / "Application Support" / "漫影工作室"
SKILL_JSON_DIR = USER_DATA_DIR / "skills" / "art_skills" / "daojie_ink_guofeng" / "json"
ASSET_HOME_MARKER = USER_DATA_DIR / "asset-home.json"
PROJECT_LOCATIONS = USER_DATA_DIR / "project-locations.json"
# 仅用于报错时的候选提示(本机已知项目根),不参与自动定位。
KNOWN_PROJECT_ROOT_HINT = "/Users/zhengbingjin/Project/IP/MA"

MANUAL_PRIORITY_NAME = "晏燎"  # 方案步骤③:repo 源逐字节复制,首跑必落平铺位
GENERATOR_NAME = os.path.basename(__file__)
GENERATED_TYPES = ("role", "scene", "tool")  # audio(706)/clip 零生成

TODAY = date.today().isoformat()
GENERATED_AT = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

# ---------------------------------------------------------------------------
# 素体句剥除规则 —— 逐字移植 apps/frontend/lib/studio/asset-character-json.ts
#   CLOTHING_SEGMENT 正则源::314-315(逐字);
#   派生流程源::319-336(split/剥除/逗号子句兜底/join 半角逗号/尾模板);
#   尾模板源::333-334(半角标点为代码原样,勿"顺手"改全角)。
# Python 语义注意:JS RegExp.test=无锚全串扫描 → 必须 re.search(re.match 锚头=错译)。
# ---------------------------------------------------------------------------

CLOTHING_SEGMENT = re.compile(
    r"衣|袍|装|裙|衫|服|褐|裤|甲|帔|靴|鞋|履|袜|腰束|腰带|腰间|佩戴|缀补丁|持物|手持|握|持一|"
    r"背景|场景|构图|四视图|三视图|多视图|视图|横幅|并排|散光|人像特写|自头顶至"
)

BARE_TAIL = (
    "通身素体呈现,肌肤匀净,全身人体比例与解剖结构清晰可读;正面直立站姿,双臂自然垂于身侧,"
    "双手放松自然,足部赤裸(素体基准态,鞋履后注入);头顶至足底全身完整入画;"
    "图为带透明通道的RGBA透明底素材图,背景全透明"
)

# JS String.prototype.trim 的空白集(含 \uFEFF;Python str.strip 语义≠JS,故显式移植)。
_JS_WS_CLASS = r"\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
_JS_TRIM_RE = re.compile(r"^[" + _JS_WS_CLASS + r"]+|[" + _JS_WS_CLASS + r"]+$")
_SEGMENT_SPLIT_RE = re.compile(r"[。;；\n]")  # JS: text.split(/[。;；\n]/)
_CLAUSE_SPLIT_RE = re.compile(r"[,，]")  # JS: segments[0].split(/[,，]/)


def js_trim(value: str) -> str:
    return _JS_TRIM_RE.sub("", value)


def derive_bare_subject_from_clothed(text):
    """TS deriveBareSubjectFromClothed(:319-336)逐语句移植;剥除全灭/空源→None。"""
    segments = [seg for seg in (js_trim(s) for s in _SEGMENT_SPLIT_RE.split(text)) if seg]
    if not segments:
        return None
    kept = [seg for seg in segments if not CLOTHING_SEGMENT.search(seg)]
    if not kept:
        # 单句混排兜底:降级逗号子句级剥除(TS :327-329)
        clauses = [c for c in (js_trim(c) for c in _CLAUSE_SPLIT_RE.split(segments[0])) if c]
        kept = [c for c in clauses if c and not CLOTHING_SEGMENT.search(c)]
    if not kept:
        return None
    head = ",".join(kept)  # JS join(",") = 半角逗号
    return head + "。" + BARE_TAIL + "。"


# ---------------------------------------------------------------------------
# 家夹键 —— 全套移植 apps/frontend/electron/storage/assets-sqlite.ts
#   sanitizeAssetFolderNameDetailed 源::147-173(a trim;b 非法字符→_+剔控制字符;
#   c 剥首尾空格点号;d Windows 保留名尾缀_;e ≤80 字符且 UTF-8≤240 字节逐码点截断;
#   f 截断后重跑尾剥+保留名复查(L2 修复步);g 空结果兜底「未命名」);
#   assetFamilyHead 源::193-200(跳过前导纯数字段与编码段,全段皆码回落整名)。
# ---------------------------------------------------------------------------

WINDOWS_RESERVED_FOLDER_NAME = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", re.IGNORECASE)
ASSET_FOLDER_NAME_MAX_CHARS = 80   # assets-sqlite.ts:130
ASSET_FOLDER_NAME_MAX_BYTES = 240  # assets-sqlite.ts:131
_FAMILY_CODE_SEG_RE = re.compile(r"^(\d+|[A-Za-z]{1,3}-\d+|[\u4e00-\u9fa5]{1,2}-\d+)$")


def sanitize_asset_folder_name(name):
    """返回 (folderName, truncated);逐字移植 TS :147-173。"""
    value = js_trim("" if name is None else str(name))
    value = re.sub(r'[/\\:*?"<>|]', "_", value)             # (b1) 非法字符→_
    value = re.sub(r"[\u0000-\u001f\u007f-\u009f]", "", value)  # (b2) 剔控制字符
    value = re.sub(r"^[. ]+|[. ]+$", "", value)             # (c) 剥首尾空格点号
    if WINDOWS_RESERVED_FOLDER_NAME.match(value):           # (d) 保留名尾缀 _
        value = value + "_"

    truncated = False
    codepoints = list(value)                                # Array.from = 码点序列
    cut = len(codepoints)
    while cut > 0 and (
        cut > ASSET_FOLDER_NAME_MAX_CHARS
        or len("".join(codepoints[:cut]).encode("utf-8")) > ASSET_FOLDER_NAME_MAX_BYTES
    ):
        truncated = True
        cut -= 1                                            # (e) 逐码点回退截断
    if cut < len(codepoints):
        value = "".join(codepoints[:cut])
    value = re.sub(r"^[. ]+|[. ]+$", "", value)             # (f) L2:截断后重跑尾剥
    if WINDOWS_RESERVED_FOLDER_NAME.match(value):           # (f) L2:保留名复查
        value = value + "_"

    if not value:                                           # (g) 空结果兜底
        return "未命名", truncated
    return value, truncated


def asset_family_head(name):
    """家段提取;逐字移植 TS assetFamilyHead(:193-200)。"""
    text = "" if name is None else str(name)
    for seg in text.split("_"):
        if not _FAMILY_CODE_SEG_RE.match(seg):
            return seg
    return text


def asset_family_folder_key(name):
    return sanitize_asset_folder_name(asset_family_head(name))[0]


def build_identity_source(name, asset_type, file_path):
    """identity_source = <type>/<家夹键>/<文件名>(方案 pathConvention ①②)。"""
    if file_path is None or not str(file_path).strip():
        return None
    file_name = str(file_path).replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    if not file_name:
        return None
    return "{}/{}".format(asset_type, asset_family_folder_key(name)) + "/" + file_name


# ---------------------------------------------------------------------------
# 骨架模板(方案 schemaTemplates 逐字)
# ---------------------------------------------------------------------------

ROLE_NOTE_DERIVED = "自动派生:DB句按 asset-character-json.ts deriveBareSubjectFromClothed 同规则剥衣物/持物/背景段;衣物走各型编辑注入"
ROLE_NOTE_FAILED = "剥除失败,待人工补"
SCENE_NOTE_VERBATIM = "DB 原句直录(不剥除,样例句本身即完整场景指令含前景/中景/远景层次语言)"
TOOL_NOTE_VERBATIM = "DB 原句直录(竹筹/青盐鞭样例已含静物陈列语言)"
EMPTY_NOTE = "DB 无 prompt 且无 description,主体词待补"

SCENE_KIND_TEMPLATES = {
    "场景": "{主体词}。空镜场景图,画面无人物;空间层次与景别以主体词为准,画风与色调与设定一致。",
    "概念气氛图": "{主体词}。以此景为核心的宽幅概念气氛图,强调光影氛围与整体色调,构图留白舒展。",
    "3D剖面场景图": "{主体词}。以剖面视角呈现该场景的空间层次与结构关系,剖面切面清晰可读。",
}
TOOL_KIND_TEMPLATES = {
    "道具": "{主体词}。纯器物静物独立陈列,单一物件完整入画,居中平视构图,均匀漫射光;图为带透明通道的RGBA透明底素材图,背景全透明。",
}

DOC_BY_TYPE = {
    "role": "角色素体真源骨架(脚本自动生成):主体词=DB 句按 deriveBareSubjectFromClothed 同规则剥衣物/持物/背景段后自动派生;衣物走各型编辑注入,不落本件。",
    "scene": "场景提示词真源骨架(脚本自动生成):主体词=DB 原句直录(不剥除);各型模板可在本 JSON 手改,不落引擎真源。",
    "tool": "道具提示词真源骨架(脚本自动生成):主体词=DB 原句直录;道具型模板可在本 JSON 手改,不落引擎真源。",
}


def render_kind_template(template, subject):
    """主体词非空→代入;为空→保留 {主体词} 占位符(待人工补后再代入)。"""
    if subject:
        return template.replace("{主体词}", subject)
    return template


def build_skeleton(row):
    """按行生成骨架 dict;返回 (doc, meta)。meta 记剥除失败/空源/identity 状态。"""
    name = row["name"] if row["name"] is not None else ""
    prompt = row["prompt"] if row["prompt"] is not None else ""
    description = row["description"] if row["description"] is not None else ""
    source = prompt if prompt.strip() else description  # 空 prompt 回落 description
    meta = {"empty_source": not bool(source.strip()), "strip_failed": False, "identity": False}

    doc = {
        "_doc": DOC_BY_TYPE[row["type"]],
        "schema_version": 2 if row["type"] == "role" else 1,
        "zh": name,
        "asset_type": row["type"],
        "updated": TODAY,
    }
    if row["type"] == "role":
        derived = derive_bare_subject_from_clothed(source)
        if derived is None:
            meta["strip_failed"] = True
            doc["body_base"] = {"主体词": "", "主体词注记": ROLE_NOTE_FAILED}
        else:
            doc["body_base"] = {"主体词": derived, "主体词注记": ROLE_NOTE_DERIVED}
    elif row["type"] == "scene":
        note = EMPTY_NOTE if meta["empty_source"] else SCENE_NOTE_VERBATIM
        doc["scene_base"] = {"主体词": source, "主体词注记": note}
        doc["kind_prompts"] = {k: render_kind_template(v, source) for k, v in SCENE_KIND_TEMPLATES.items()}
    else:  # tool(prop)
        note = EMPTY_NOTE if meta["empty_source"] else TOOL_NOTE_VERBATIM
        doc["prop_base"] = {"主体词": source, "主体词注记": note}
        doc["kind_prompts"] = {k: render_kind_template(v, source) for k, v in TOOL_KIND_TEMPLATES.items()}

    identity = build_identity_source(name, row["type"], row["filePath"])
    if identity:
        doc["identity_source"] = identity
        meta["identity"] = True
    doc["provenance"] = {
        "generator": GENERATOR_NAME,
        "generated_at": GENERATED_AT,
        "db_prompt": prompt,
        "db_description": description,
        "note": "db 字段仅审计溯源,消费端不读",
    }
    return doc, meta


# ---------------------------------------------------------------------------
# store 根定位(asset-home.ts 语义子集:marker → lastKnownLocation → store/)
# ---------------------------------------------------------------------------

def _store_assets_dir_of(project_root):
    return Path(project_root) / "store" / "assets"


def resolve_store_root(explicit):
    """返回 (store_assets_dir, 定位说明);失败返回 (None, 报错文案)。"""
    if explicit:
        for cand in (_store_assets_dir_of(explicit), Path(explicit) / "assets", Path(explicit)):
            if (cand / "assets.db").is_file():
                return cand, "显式 --store-root={}".format(explicit)
        return None, "--store-root 指定的位置找不到 assets.db(试过:{}/store/assets、{}/assets、{})".format(
            explicit, explicit, explicit)

    marker = None
    try:
        marker = json.loads(ASSET_HOME_MARKER.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        marker = None
    last_known = marker.get("lastKnownLocation") if isinstance(marker, dict) else None
    if isinstance(last_known, str) and last_known:
        candidate = _store_assets_dir_of(last_known)
        if (candidate / "assets.db").is_file():
            return candidate, "asset-home.json→lastKnownLocation={}→store/assets".format(last_known)
        return None, _candidates_report(last_known)

    return None, _candidates_report(None)


def _candidates_report(last_known):
    lines = ["store 根定位失败:无 asset-home.json 或 lastKnownLocation 指向的目录无资产库。请用 --store-root 显式指定。候选:"]
    seen = []
    if last_known:
        seen.append(("asset-home.json lastKnownLocation", last_known))
    try:
        table = json.loads(PROJECT_LOCATIONS.read_text(encoding="utf-8"))
        locations = table.get("locations") if isinstance(table, dict) else None
        if isinstance(locations, dict):
            for pid, loc in sorted(locations.items()):
                if isinstance(loc, str) and loc:
                    seen.append(("project-locations.json [{}]".format(pid), loc))
    except (OSError, ValueError):
        pass
    seen.append(("本机已知项目根", KNOWN_PROJECT_ROOT_HINT))
    for label, loc in seen:
        ok = (_store_assets_dir_of(loc) / "assets.db").is_file()
        lines.append("  [{}] {} → store/assets/assets.db {}".format(label, loc, "存在" if ok else "不存在"))
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# DB 读取 + 预检
# ---------------------------------------------------------------------------

def load_rows(db_path):
    uri = "file:{}?mode=ro&immutable=1".format(quote(str(db_path), safe="/"))
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    try:
        cur = conn.execute(
            "SELECT id, type, name, description, prompt, filePath FROM assets "
            "WHERE type IN ('role','scene','tool')"
        )
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


def precheck(rows):
    """返回 (collision_names, problems);problems 非空=硬失败(报错列名,不静默覆盖)。"""
    problems = []
    bad_names = [r for r in rows if r["name"] is None or not str(r["name"]).strip()]
    if bad_names:
        problems.append("资产名 trim 为空的行(列:id/type/name): " + "; ".join(
            "id={}, type={}, name={!r}".format(r["id"], r["type"], r["name"]) for r in bad_names[:20]))
    unsafe = [r for r in rows if any(ch in str(r["name"] or "") for ch in ("/", "\\", "\x00"))]
    if unsafe:
        problems.append("资产名含路径分隔符无法落合法文件名(列:id/type/name): " + "; ".join(
            "id={}, type={}, name={!r}".format(r["id"], r["type"], r["name"]) for r in unsafe[:20]))

    same_type = {}
    for r in rows:
        same_type.setdefault((r["type"], str(r["name"])), []).append(r["id"])
    dups = {k: ids for k, ids in same_type.items() if len(ids) > 1}
    if dups:
        parts = []
        for (atype, name), ids in sorted(dups.items()):
            parts.append("type={}, name={!r}, ids={}".format(atype, name, ",".join(map(str, ids))))
        problems.append("同型同名多行,拒绝静默覆盖(列:type/name/id): " + "; ".join(parts))

    by_name = {}
    for r in rows:
        by_name.setdefault(str(r["name"]), set()).add(r["type"])
    collision_names = {name for name, types in by_name.items() if len(types) > 1}
    return collision_names, problems


def build_store_prompt_relative_path(name, asset_type, collision_names):
    """方案 scopeRule:跨类型撞名者 <名>@<type>.json,否则 <名>.json。"""
    if name in collision_names:
        return "{}@{}.json".format(name, asset_type)
    return "{}.{}".format(name, "json")


# ---------------------------------------------------------------------------
# IO 助手(dry-run 零写盘)
# ---------------------------------------------------------------------------

def copy_bytes(src, dst, dry_run, plan):
    data = Path(src).read_bytes()
    plan.append((str(dst), "copy", len(data)))
    if not dry_run:
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
        Path(dst).write_bytes(data)
    return data


def write_text(dst, text, dry_run, plan):
    plan.append((str(dst), "skeleton", len(text.encode("utf-8"))))
    if not dry_run:
        Path(dst).parent.mkdir(parents=True, exist_ok=True)
        Path(dst).write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------

def main(argv=None):
    parser = argparse.ArgumentParser(description="资产提示词真源 JSON 铺货(幂等;详见文件头注释)")
    parser.add_argument("--dry-run", action="store_true", help="零写盘,只打印计划")
    parser.add_argument("--force", action="store_true", help="已存在骨架按 DB 重刷(手工真源名恒保护)")
    parser.add_argument("--force-refresh", action="store_true", help="已存在手工真源副本按 repo 种子重拷")
    parser.add_argument("--store-root", default=None, help="显式 store 根(含 assets/assets.db 的目录)")
    args = parser.parse_args(argv)

    print("=" * 72)
    print("[asset_truth_prompts_provision_1027] dry_run={} force={} force_refresh={}".format(
        args.dry_run, args.force, args.force_refresh))

    store_assets, root_note = resolve_store_root(args.store_root)
    if store_assets is None:
        print("[硬失败] " + root_note)
        return 1
    db_path = store_assets / "assets.db"
    prompts_dir = store_assets / "files" / "prompts"
    print("store 根: {} ({})".format(store_assets, root_note))
    print("DB(只读 mode=ro&immutable=1): {}".format(db_path))
    print("prompts 落点: {}".format(prompts_dir))
    if not db_path.is_file():
        print("[硬失败] 资产库不存在: {}".format(db_path))
        return 1
    if not REPO_JSON_DIR.is_dir():
        print("[硬失败] repo 手工真源目录不存在: {}".format(REPO_JSON_DIR))
        return 1

    rows = load_rows(db_path)
    counts = {t: sum(1 for r in rows if r["type"] == t) for t in GENERATED_TYPES}
    print("DB 行数(role/scene/tool): {} (共 {})".format(counts, len(rows)))

    collision_names, problems = precheck(rows)
    if problems:
        print("[硬失败] 预检不过,拒跑(不静默覆盖):")
        for p in problems:
            print("  - " + p)
        return 2
    if collision_names:
        print("跨类型撞名组(落 <名>@<type>.json,平铺位不落):")
        for name in sorted(collision_names):
            types = sorted({r["type"] for r in rows if str(r["name"]) == name})
            print("  - {} : {} → {}".format(name, "+".join(types),
                  ", ".join("{}@{}.json".format(name, t) for t in types)))
    else:
        print("跨类型撞名组: 无")

    plan = []          # (路径, 动作, 字节数) —— dry-run 审计 + 内存校验清单
    manual_results = []  # (名, 动作, 来源)

    # --- 手工真源阶段(方案步骤③④;先于骨架——DB 现库晏燎是 role 行,后跑会被顶) ---
    manual_stems = []
    for src in sorted(REPO_JSON_DIR.glob("*.json")):
        stem = src.stem
        manual_stems.append(stem)
        if stem == MANUAL_PRIORITY_NAME:
            target = prompts_dir / build_store_prompt_relative_path(stem, "role", collision_names)
            if target.exists() and not args.force_refresh:
                manual_results.append((stem, "已存在跳过", "store 既有"))
            else:
                copy_bytes(src, target, args.dry_run, plan)
                manual_results.append((stem, "已存在按 --force-refresh 重拷" if target.exists() else "复制", "repo 源(逐字节)"))
            continue
        target = prompts_dir / (stem + ".json")
        if target.exists():
            manual_results.append((stem, "已存在跳过", "store 既有"))
            continue
        skill_copy = SKILL_JSON_DIR / src.name
        if skill_copy.is_file():
            copy_bytes(skill_copy, target, args.dry_run, plan)
            manual_results.append((stem, "复制", "技能存储副本(保旧版用户编辑)"))
        else:
            copy_bytes(src, target, args.dry_run, plan)
            manual_results.append((stem, "复制", "repo bundled"))

    # --- 骨架生成阶段(方案步骤②;已存在默认跳过=幂等) ---
    stats = {t: {"generated": 0, "skipped_existing": 0, "forced": 0} for t in GENERATED_TYPES}
    manual_protected = 0
    strip_failures = []   # (name, type) —— role 剥除全灭/空源
    pending_bodies = []   # (path, payload_text) —— 内存态 round-trip 校验清单
    identity_filled = 0

    for row in sorted(rows, key=lambda r: (r["type"], str(r["name"]), str(r["id"]))):
        name = str(row["name"])
        target = prompts_dir / build_store_prompt_relative_path(name, row["type"], collision_names)
        rel = target.relative_to(prompts_dir).as_posix()
        if name in manual_stems:
            manual_protected += 1  # 手工真源名:骨架恒不写不刷(晏燎级手工真源受保护)
            continue
        existed = target.exists()  # 先记再写:--force 下新写/重刷两态统计才不失真
        if existed and not args.force:
            stats[row["type"]]["skipped_existing"] += 1
            continue
        doc, meta = build_skeleton(row)
        payload = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
        try:
            if json.loads(payload) != doc:
                print("[硬失败] round-trip 不等价(不应发生): {}".format(rel))
                return 3
        except ValueError as err:
            print("[硬失败] 生成载荷非法 JSON: {} ({})".format(rel, err))
            return 3
        pending_bodies.append((rel, payload))
        write_text(target, payload, args.dry_run, plan)
        if meta["identity"]:
            identity_filled += 1
        if meta["strip_failed"]:
            strip_failures.append((name, row["type"]))
        if existed and args.force:
            stats[row["type"]]["forced"] += 1
        else:
            stats[row["type"]]["generated"] += 1

    # --- 校验阶段(方案步骤⑤:产物全部 json round-trip) ---
    validation_failures = []
    if args.dry_run:
        for rel, payload in pending_bodies:
            try:
                json.loads(payload)
            except ValueError as err:
                validation_failures.append(("(dry-run 内存态) " + rel, str(err)))
        yanliao_bytes = (prompts_dir / (MANUAL_PRIORITY_NAME + ".json"))
        print("[dry-run] 计划写盘 {} 件(骨架 {} + 手工 {});已对全部待写骨架做内存态 round-trip 校验。".format(
            len(plan), len(pending_bodies), len(manual_results)))
    else:
        checked = 0
        for f in sorted(prompts_dir.glob("*.json")):
            checked += 1
            try:
                json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError) as err:
                validation_failures.append((f.name, str(err)))
        yanliao_target = prompts_dir / build_store_prompt_relative_path(MANUAL_PRIORITY_NAME, "role", collision_names)
        yanliao_repo = REPO_JSON_DIR / (MANUAL_PRIORITY_NAME + ".json")
        yanliao_same = yanliao_target.read_bytes() == yanliao_repo.read_bytes()
        if not yanliao_same:
            validation_failures.append((yanliao_target.name, "与 repo 源不逐字节等(未带 --force-refresh 时为既有文件,请人工核对)"))
        print("round-trip 校验: {} 件 store JSON 全读全解析;晏燎副本与 repo 源逐字节等={}".format(checked, yanliao_same))

    # --- 汇总 ---
    print("-" * 72)
    print("手工真源(repo-glob 档案族,共 {} 件):".format(len(manual_results)))
    for stem, action, source in manual_results:
        print("  - {}: {} [{}]".format(stem, action, source))
    print("骨架生成(按型):")
    for t in GENERATED_TYPES:
        s = stats[t]
        print("  - {}: 新写 {} / 重刷 {} / 已存在跳过 {}".format(t, s["generated"], s["forced"], s["skipped_existing"]))
    print("手工名骨架保护(骨架恒不写): {} 行".format(manual_protected))
    print("identity_source 填充: {} 行(无主图省略)".format(identity_filled))
    print("role 剥除失败(主体词空串+待补注记,消费端 fail-safe): {} 行".format(len(strip_failures)))
    if strip_failures:
        shown = strip_failures[:50]
        for name, atype in shown:
            print("    - [{}] {}".format(atype, name))
        if len(strip_failures) > len(shown):
            print("    … 共 {} 条,以上仅前 50 条".format(len(strip_failures)))
    if validation_failures:
        print("[硬失败] 校验失败清单 ({}):".format(len(validation_failures)))
        for fname, err in validation_failures:
            print("  - {}: {}".format(fname, err))
        return 3
    print("结果: OK{}".format("(dry-run,零写盘)" if args.dry_run else "")
          + ";撞名组 {}".format(len(collision_names)) + ";剥除失败 {}".format(len(strip_failures)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
