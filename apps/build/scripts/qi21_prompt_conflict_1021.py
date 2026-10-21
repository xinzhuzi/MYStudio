"""Precisely patch the three approved Round12 data fields without reformatting."""
from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RESEARCH = ROOT / ".trellis/tasks/10-20-trellis-audit-remediation/research/round12-prompt-conflict"
RELATIVE = "apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json"
SOURCE = ROOT / RELATIVE
BACKUP = RESEARCH / "backups" / RELATIVE
manifest = json.loads((RESEARCH / "backup-manifest.json").read_bytes())
expected_sha = next(entry["beforeSha256"] for entry in manifest if entry["path"] == RELATIVE)
before = BACKUP.read_bytes()
assert hashlib.sha256(before).hexdigest() == expected_sha
original = json.loads(before)
updated = copy.deepcopy(original)
entry = next(item for item in updated["types"] if item["zh"] == "人物多视图")
edits = [
    ("同一角色的多视图设定参考图：", "同一角色的多视图设定参考图，共四幅："),
    ("整幅仅取正面构图", "仅左侧特写区域取正面构图"),
    ("右侧展示同一角色正面、侧面、背面全身三视图，全身可见，三视图并排等宽排列",
     ("右侧展示同一角色正面、纯90度侧面、背面全身三视图，全身可见，三视图并排等宽、等高排列，"
      "头顶与脚底分别对齐；正面朝向仅约束左侧特写与右侧正面全身像，不约束侧面或背面")),
]
damage = ("来源明确要求的伤痕、破损与身体缺失仅在当前可见视面按同一物理位置保留，"
          "不可见处不另造副本。")
for field in ("positive_text", "rgba_positive"):
    for old, new in edits:
        assert entry[field].count(old) == 1, (field, old)
        entry[field] = entry[field].replace(old, new, 1)
assert entry["positive_text"].count("来源明确要求的伤痕、破损与身体缺失逐格保留。") == 1
entry["positive_text"] = entry["positive_text"].replace(
    "来源明确要求的伤痕、破损与身体缺失逐格保留。", damage, 1)
assert entry["rgba_positive"].count("完整头肩半身正面细节图") == 1
entry["rgba_positive"] = entry["rgba_positive"].replace(
    "完整头肩半身正面细节图", "完整头肩/胸口正面细节图", 1) + damage
updated["rgba"]["_doc"] = (
    "RGBA透明包裹句——1008 用户令全英文:head/tail=head_en/tail_en=QwenLM官方原句(逐字);"
    "w1_closing 英文版仅留历史兼容数据,全部路径(含select旧路、PE开/关、透明开/关)均停用自动追加;"
    "旧画布W1快照参数忽略,不删除正文中的用户原话;中文句退役;改法入口=README「字段字典」节")
previous_entry = next(item for item in original["types"] if item["zh"] == "人物多视图")
changes = [(original["rgba"]["_doc"], updated["rgba"]["_doc"])]
changes.extend((previous_entry[field], entry[field]) for field in ("positive_text", "rgba_positive"))
after = before
for old, new in changes:
    old_bytes = json.dumps(old, ensure_ascii=False).encode()
    new_bytes = json.dumps(new, ensure_ascii=False).encode()
    assert after.count(old_bytes) == 1
    after = after.replace(old_bytes, new_bytes, 1)
assert json.loads(after) == updated
assert SOURCE.read_bytes() in (before, after), "Source changed outside the approved surgery; stop."
if SOURCE.read_bytes() != after:
    SOURCE.write_bytes(after)
print(json.dumps({"beforeSha256": expected_sha, "afterSha256": hashlib.sha256(after).hexdigest(),
                  "fieldsChanged": ["rgba._doc", "人物多视图.positive_text", "人物多视图.rgba_positive"]}))
