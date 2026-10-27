#!/usr/bin/env python3
"""提示词真源 JSON 回填(10-27 应用侧接线:store 位资产提示词真源铺底)。

读 store/assets/assets.db 的 role/scene/tool 全行,按 scopeRule/schemaTemplates 生成
store/assets/files/prompts/<名>.json 骨架,让 store 位资产拿到与 repo 手工真源
(晏燎.json)同等的「提示词真源JSON」面板/真源素体句待遇(前端读路=项目库
store/assets/files/prompts/ 优先,repo glob 兜底)。

scopeRule(哪些行生成、落什么名):
  - role/scene/tool 全行各生成一份;
  - 跨类型撞名(同名不同 type,现库实查 2 组:万妖金庭 role+scene、蛟龙 role+tool)
    落 `<名>@<type>.json`(平铺位不落件,读写两路同规则);
  - 同型同名多行=数据异常,硬失败报错列名退出(不静默覆盖);
  - repo 手工真源命中行(repo glob <名>.json,现库=晏燎;撞名行同轨走种子迁移,
    不因 @type 形态落骨架)不生成骨架,改种子迁移。

schemaTemplates(三类骨架;与盘上既铺产物 asset_truth_prompts_provision_1027.py
同构=--force-refresh 重刷不换形态):
  - role:schema_version=2,body_base 只填主体词+主体词注记子集;主体词=主体词源经
    derive_bare_subject_from_clothed 剥除衣物/持物/背景段派生(与前端
    deriveBareSubjectFromClothed 逐字节 parity,改动即红——
    asset-prompt-json-backfill.test.ts 双语言 parity 钉死);剥除失败/源空→空串
    +「剥除失败,待人工补」注记;剥不出来的计入汇总 strip_failures;
  - scene:schema_version=1,scene_base.主体词=主体词源原句直录(不剥除)
    +kind_prompts(场景/概念气氛图/3D剖面场景图)占位符模板;
  - tool:schema_version=1,prop_base.主体词=主体词源原句直录+kind_prompts(道具)模板;
  - 主体词源=DB prompt,空回落 description,均空→空串骨架(待补);
  - kind_prompts 模板:主体词非空代入,空则保留 {主体词} 占位符;
  - identity_source(可选)=`<type>/<家夹键>/<文件名>`(有主图填,无主图整键省略;
    家夹键=assetFamilyFolderKey 移植:序号/编码前缀段剥除 + sanitizeAssetFolderName
    移植,与 assets-sqlite.ts 同参);
  - provenance 公共信封=generator/generated_at/db_prompt/db_description/note
    (db 字段仅审计溯源,消费端不读)。

种子迁移(repo 手工真源):
  - store 目标已存在 → 默认跳过(幂等;--force-refresh 才覆盖);
  - store 缺 + 桌面技能存储副本(<user-data>/skills/art_skills/<包>/json/<名>.json)
    在 → 复制技能副本(保旧版用户编辑);
  - 两处皆无 → 逐字节复制 repo 源(apps/frontend/assets/studio-manuals/…)。

store 根定位 = <user-data>/asset-home.json → lastKnownLocation → <loc>/store/assets;
无该文件或位置失联 → 报错退出并列出 project-locations.json 里持有 store/assets/assets.db
的候选;--store-root 显式覆盖。不触 repo 任何文件(只读 repo 源)。

用法:
  python3 asset_prompt_json_backfill.py                # 定位+回填(默认写盘)
  python3 asset_prompt_json_backfill.py --dry-run      # 零写盘只打印计划
  python3 asset_prompt_json_backfill.py --store-root /path/to/store/assets
  python3 asset_prompt_json_backfill.py --force-refresh
  echo '["带衣句A","带衣句B"]' | python3 asset_prompt_json_backfill.py --derive-probe
  echo '["CON","0002_R-3239_回元丹"]' | python3 asset_prompt_json_backfill.py --sanitize-probe
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import date, datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# 常量(与前端/存储层单源对齐)
# ---------------------------------------------------------------------------

PROMPTS_RELATIVE = "files/prompts"
MANAGED_TYPES = ("role", "scene", "tool")
DEFAULT_USER_DATA = Path.home() / "Library" / "Application Support" / "漫影工作室"
GENERATOR_NAME = Path(__file__).name

# schemaTemplates 模板/注记/信封文案(方案定文;与盘上既铺产物
# asset_truth_prompts_provision_1027.py 逐字同源,--force-refresh 重刷不换形态)
ROLE_NOTE_DERIVED = "自动派生:DB句按 asset-character-json.ts deriveBareSubjectFromClothed 同规则剥衣物/持物/背景段;衣物走各型编辑注入"
ROLE_NOTE_FAILED = "剥除失败,待人工补"
SCENE_NOTE_VERBATIM = "DB 原句直录(不剥除,样例句本身即完整场景指令含前景/中景/远景层次语言)"
TOOL_NOTE_VERBATIM = "DB 原句直录(竹筹/青盐鞭样例已含静物陈列语言)"
EMPTY_NOTE = "DB 无 prompt 且无 description,主体词待补"
PROVENANCE_NOTE = "db 字段仅审计溯源,消费端不读"

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

ROLE_BODY_BASE_TAIL = (
    "通身素体呈现,肌肤匀净,全身人体比例与解剖结构清晰可读;正面直立站姿,双臂自然垂于身侧,"
    "双手放松自然,足部赤裸(素体基准态,鞋履后注入);头顶至足底全身完整入画;"
    "图为带透明通道的RGBA透明底素材图,背景全透明"
)

# ---------------------------------------------------------------------------
# deriveBareSubjectFromClothed 移植(与 asset-character-json.ts 逐字节 parity;
# CLOTHING_SEGMENT / 切分式任何改动两侧同步,parity 测试即红)
# ---------------------------------------------------------------------------

CLOTHING_SEGMENT = re.compile(
    r"衣|袍|装|裙|衫|服|褐|裤|甲|帔|靴|鞋|履|袜|腰束|腰带|腰间|佩戴|缀补丁|持物|手持|握|持一"
    r"|背景|场景|构图|四视图|三视图|多视图|视图|横幅|并排|散光|人像特写|自头顶至"
)
SEGMENT_SPLIT = re.compile(r"[。;；\n]")
CLAUSE_SPLIT = re.compile(r"[,，]")


def derive_bare_subject_from_clothed(text: str) -> str | None:
    segments = [seg.strip() for seg in SEGMENT_SPLIT.split(text or "")]
    segments = [seg for seg in segments if seg]
    if not segments:
        return None
    kept = [seg for seg in segments if not CLOTHING_SEGMENT.search(seg)]
    if not kept:
        # 单句混排(身份+衣物同段)兜底:降级到逗号子句级剥除,保身份子句
        clauses = [clause.strip() for clause in CLAUSE_SPLIT.split(segments[0])]
        clauses = [clause for clause in clauses if clause]
        kept = [clause for clause in clauses if not CLOTHING_SEGMENT.search(clause)]
    if not kept:
        return None
    head = ",".join(kept)
    return f"{head}。{ROLE_BODY_BASE_TAIL}。"


# ---------------------------------------------------------------------------
# sanitizeAssetFolderName / assetFamilyHead / assetFamilyFolderKey 移植
# (与 electron/storage/assets-sqlite.ts:134-190 逐字节 parity)
# ---------------------------------------------------------------------------

ASSET_FOLDER_NAME_MAX_CHARS = 80
ASSET_FOLDER_NAME_MAX_BYTES = 240
WINDOWS_RESERVED_FOLDER_NAME = re.compile(r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$", re.IGNORECASE)
FOLDER_ILLEGAL_CHARS = re.compile(r"[/\\:*?\"<>|]")
FOLDER_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f-\x9f]")
FOLDER_EDGE_DOTS = re.compile(r"^[. ]+|[. ]+$")
FAMILY_CODE_SEGMENT = re.compile(r"^(\d+|[A-Za-z]{1,3}-\d+|[\u4e00-\u9fa5]{1,2}-\d+)$")


def sanitize_asset_folder_name(name: str) -> tuple[str, bool]:
    value = str(name if name is not None else "").strip()
    value = FOLDER_ILLEGAL_CHARS.sub("_", value)
    value = FOLDER_CONTROL_CHARS.sub("", value)
    value = FOLDER_EDGE_DOTS.sub("", value)
    if WINDOWS_RESERVED_FOLDER_NAME.match(value):
        value = f"{value}_"

    truncated = False
    code_points = list(value)  # JS Array.from = 码点位;Python str 迭代同为码点位
    cut = len(code_points)
    while cut > 0 and (
        cut > ASSET_FOLDER_NAME_MAX_CHARS
        or len("".join(code_points[:cut]).encode("utf-8")) > ASSET_FOLDER_NAME_MAX_BYTES
    ):
        truncated = True
        cut -= 1
    if cut < len(code_points):
        value = "".join(code_points[:cut])
    # 截断可能切出尾点/尾空格(Windows 致命形态),截断后重剥+保留名复查
    value = FOLDER_EDGE_DOTS.sub("", value)
    if WINDOWS_RESERVED_FOLDER_NAME.match(value):
        value = f"{value}_"

    if not value:
        return "未命名", truncated
    return value, truncated


def asset_family_head(name: str) -> str:
    raw = str(name if name is not None else "")
    for seg in raw.split("_"):
        if not FAMILY_CODE_SEGMENT.match(seg):
            return seg
    return raw


def asset_family_folder_key(name: str) -> str:
    return sanitize_asset_folder_name(asset_family_head(name))[0]


# ---------------------------------------------------------------------------
# store 根定位(asset-home.json → lastKnownLocation → store/assets)
# ---------------------------------------------------------------------------


def _location_table_candidates(user_data: Path) -> list[str]:
    table = user_data / "project-locations.json"
    if not table.is_file():
        return []
    try:
        entries = json.loads(table.read_text(encoding="utf-8")).get("locations") or {}
    except (OSError, ValueError):
        return []
    return sorted({loc for loc in entries.values() if isinstance(loc, str) and loc})


def resolve_store_root(args: argparse.Namespace) -> Path:
    """--store-root 显式覆盖;否则 marker→lastKnownLocation→store/assets,失联报错列候选。"""
    if args.store_root:
        root = Path(args.store_root).expanduser()
        if not (root / "assets.db").is_file():
            print(f"[asset-prompt-json-backfill] 指定 --store-root 下无 assets.db:{root}", file=sys.stderr)
            raise SystemExit(2)
        return root

    user_data = Path(args.user_data).expanduser()
    marker_path = user_data / "asset-home.json"
    marker: dict | None = None
    if marker_path.is_file():
        try:
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            marker = None
    if isinstance(marker, dict) and isinstance(marker.get("lastKnownLocation"), str):
        root = Path(marker["lastKnownLocation"]).expanduser() / "store" / "assets"
        if (root / "assets.db").is_file():
            return root
        print(
            "[asset-prompt-json-backfill] asset-home.json 的 lastKnownLocation 指向的资产库不存在:"
            f"{marker.get('lastKnownLocation')}",
            file=sys.stderr,
        )
    else:
        print(f"[asset-prompt-json-backfill] 找不到 asset-home.json:{marker_path}", file=sys.stderr)

    candidates = [
        loc for loc in _location_table_candidates(user_data)
        if (Path(loc) / "store" / "assets" / "assets.db").is_file()
    ]
    if candidates:
        print("候选(位置表中持有 store/assets/assets.db 的项目根):", file=sys.stderr)
        for loc in candidates:
            print(f"  --store-root {Path(loc) / 'store' / 'assets'}", file=sys.stderr)
    else:
        print("位置表中无候选;请用 --store-root 显式指定 store/assets 目录", file=sys.stderr)
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# repo 手工真源 glob(art_skills/*/json/<名>.json;config 类件名不在 DB 行名域不命中)
# ---------------------------------------------------------------------------


def index_repo_truths(repo_assets: Path) -> dict[str, Path]:
    """repo glob 手工真源索引:<名> → repo 源路径(多包同名保留首个,与前端 glob 命中一致)。"""
    truths: dict[str, Path] = {}
    if not repo_assets.is_dir():
        return truths
    for json_path in sorted(repo_assets.glob("art_skills/*/json/*.json")):
        truths.setdefault(json_path.stem, json_path)
    return truths


# ---------------------------------------------------------------------------
# 骨架生成(schemaTemplates)
# ---------------------------------------------------------------------------


def build_identity_source(name: str, asset_type: str, file_path) -> str | None:
    """identity_source = `<type>/<家夹键>/<文件名>`(方案 pathConvention①:有主图填,无主图 None=整键省略)。"""
    if file_path is None or not str(file_path).strip():
        return None
    file_name = str(file_path).replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]
    if not file_name:
        return None
    return f"{asset_type}/{asset_family_folder_key(name)}/{file_name}"


def render_kind_template(template: str, subject: str) -> str:
    """主体词非空→代入;为空→保留 {主体词} 占位符(待人工补后再代入)。"""
    if subject:
        return template.replace("{主体词}", subject)
    return template


def build_skeleton(row: dict, today: str, generated_at: str) -> tuple[dict, dict]:
    """按行生成骨架 dict(方案 schemaTemplates);返回 (doc, meta)。

    meta:empty_source=主体词源双空;strip_failed=role 源非空但剥除全灭(计入汇总)。
    """
    name = row["name"]
    prompt = row.get("prompt") or ""
    description = row.get("description") or ""
    source = prompt if prompt.strip() else description  # 主体词源:DB prompt 空回落 description
    asset_type = row["type"]
    meta = {"empty_source": not bool(source.strip()), "strip_failed": False}

    doc = {
        "_doc": DOC_BY_TYPE[asset_type],
        "schema_version": 2 if asset_type == "role" else 1,
        "zh": name,
        "asset_type": asset_type,
        "updated": today,
    }
    if asset_type == "role":
        derived = derive_bare_subject_from_clothed(source)
        if derived is None:
            meta["strip_failed"] = bool(source.strip())
            doc["body_base"] = {"主体词": "", "主体词注记": ROLE_NOTE_FAILED}
        else:
            doc["body_base"] = {"主体词": derived, "主体词注记": ROLE_NOTE_DERIVED}
    elif asset_type == "scene":
        note = EMPTY_NOTE if meta["empty_source"] else SCENE_NOTE_VERBATIM
        doc["scene_base"] = {"主体词": source, "主体词注记": note}
        doc["kind_prompts"] = {k: render_kind_template(v, source) for k, v in SCENE_KIND_TEMPLATES.items()}
    else:  # tool(prop)
        note = EMPTY_NOTE if meta["empty_source"] else TOOL_NOTE_VERBATIM
        doc["prop_base"] = {"主体词": source, "主体词注记": note}
        doc["kind_prompts"] = {k: render_kind_template(v, source) for k, v in TOOL_KIND_TEMPLATES.items()}

    identity = build_identity_source(name, asset_type, row.get("filePath"))
    if identity:
        doc["identity_source"] = identity
    doc["provenance"] = {
        "generator": GENERATOR_NAME,
        "generated_at": generated_at,
        "db_prompt": prompt,
        "db_description": description,
        "note": PROVENANCE_NOTE,
    }
    return doc, meta


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


def run_backfill(args: argparse.Namespace) -> int:
    store_root = resolve_store_root(args)
    db_path = store_root / "assets.db"
    prompts_dir = store_root / PROMPTS_RELATIVE
    repo_assets = Path(args.repo_assets).expanduser() if args.repo_assets else \
        Path(__file__).resolve().parents[3] / "apps" / "frontend" / "assets" / "studio-manuals"
    skills_root = Path(args.skills_root).expanduser() if args.skills_root else \
        Path(args.user_data).expanduser() / "skills"
    today = date.today().isoformat()
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        rows = [
            {"type": t, "name": n or "", "prompt": p or "", "description": d or "", "filePath": fp}
            for t, n, p, d, fp in con.execute(
                "SELECT type, name, prompt, description, filePath FROM assets "
                "WHERE type IN ('role','scene','tool') ORDER BY type, name"
            )
        ]
        same_type_dups = con.execute(
            "SELECT type, name, COUNT(*) FROM assets "
            "WHERE type IN ('role','scene','tool') GROUP BY type, name HAVING COUNT(*) > 1"
        ).fetchall()
        cross_type = con.execute(
            "SELECT name FROM assets WHERE type IN ('role','scene','tool') "
            "GROUP BY name HAVING COUNT(DISTINCT type) > 1"
        ).fetchall()
    finally:
        con.close()

    if same_type_dups:
        print("[asset-prompt-json-backfill] 同型同名多行(数据异常,硬失败不静默覆盖):", file=sys.stderr)
        for t, n, c in same_type_dups:
            print(f"  type={t} name={n!r} rows={c}", file=sys.stderr)
        return 2

    colliding_names = {name for (name,) in cross_type}
    repo_truths = index_repo_truths(repo_assets)

    plan: list[tuple[str, Path, Path | None, str | None]] = []  # (action, target, src, payload)
    skipped_existing = 0
    strip_failures = 0
    seeded_repo = 0
    seeded_skills = 0
    generated = 0

    for row in rows:
        name = row["name"].strip()
        if not name:
            continue  # 空名行不落件(与 usesAssetNameFolder 家夹兜底不同域,骨架无锚)
        filename = f"{name}@{row['type']}.json" if name in colliding_names else f"{name}.json"
        target = prompts_dir / filename
        if target.exists() and not args.force_refresh:
            skipped_existing += 1
            continue
        truth = repo_truths.get(name)
        if truth is not None:
            # repo 手工真源:store 缺→技能副本优先(保旧版用户编辑),两处皆无→repo 源逐字节复制
            # (撞名行同轨:target=<名>@<type>.json 也按 repo 真源种子迁移,不落骨架)
            pkg_dir = truth.parent.parent.name  # …/art_skills/<包>/json/<名>.json → <包>
            skills_copy = skills_root / "art_skills" / pkg_dir / "json" / truth.name
            if skills_copy.is_file():
                plan.append(("copy", target, skills_copy, None))
                seeded_skills += 1
            else:
                plan.append(("copy", target, truth, None))
                seeded_repo += 1
            continue
        skeleton, meta = build_skeleton(row | {"name": name}, today, generated_at)
        if meta["strip_failed"]:
            strip_failures += 1
        plan.append(("write", target, None, json.dumps(skeleton, ensure_ascii=False, indent=2) + "\n"))
        generated += 1

    if not args.dry_run and plan:
        prompts_dir.mkdir(parents=True, exist_ok=True)
        for action, target, src, payload in plan:
            if action == "copy":
                target.write_bytes(src.read_bytes() if src else b"")  # type: ignore[union-attr]
            else:
                target.write_text(payload or "", encoding="utf-8")

    print(
        "[asset-prompt-json-backfill] "
        f"store={store_root} rows={len(rows)} generated={generated} "
        f"seeded_repo_copy={seeded_repo} seeded_skills_copy={seeded_skills} "
        f"skipped_existing={skipped_existing} strip_failures={strip_failures} "
        f"collisions={sorted(colliding_names) if colliding_names else '[]'} "
        f"dry_run={args.dry_run}"
    )
    for action, target, src, _payload in plan:
        origin = f" <- {src}" if src is not None else ""
        print(f"  [{action}] {target.name}{origin}")
    return 0


def run_derive_probe() -> int:
    """stdin JSON 数组 → stdout JSON 数组(派生句或 null);parity 测试断言二消费。"""
    inputs = json.loads(sys.stdin.read())
    outputs = [derive_bare_subject_from_clothed(item) if isinstance(item, str) else None for item in inputs]
    print(json.dumps(outputs, ensure_ascii=False))
    return 0


def run_sanitize_probe() -> int:
    """stdin JSON 数组(资产名) → stdout JSON 数组(folderName);parity 测试断言三消费。"""
    inputs = json.loads(sys.stdin.read())
    outputs = [
        sanitize_asset_folder_name(item)[0] if isinstance(item, str) else "未命名" for item in inputs
    ]
    print(json.dumps(outputs, ensure_ascii=False))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="store 位提示词真源 JSON 回填")
    ap.add_argument("--store-root", help="store/assets 目录显式覆盖(含 assets.db/files/)")
    ap.add_argument("--user-data", default=str(DEFAULT_USER_DATA), help="应用 userData 目录(asset-home.json 所在)")
    ap.add_argument("--skills-root", help="桌面技能存储根(默认 <user-data>/skills);种子迁移的副本优先源")
    ap.add_argument("--repo-assets", help="repo studio-manuals 目录覆盖(默认按脚本位置推得)")
    ap.add_argument("--dry-run", action="store_true", help="零写盘,只打印计划")
    ap.add_argument("--force-refresh", action="store_true", help="覆盖已存在的 store JSON(默认跳过=幂等)")
    ap.add_argument("--derive-probe", action="store_true", help="stdin JSON 数组→派生句数组(parity 探针)")
    ap.add_argument("--sanitize-probe", action="store_true", help="stdin JSON 数组→家夹键数组(parity 探针)")
    args = ap.parse_args()
    if args.derive_probe:
        return run_derive_probe()
    if args.sanitize_probe:
        return run_sanitize_probe()
    return run_backfill(args)


if __name__ == "__main__":
    raise SystemExit(main())
