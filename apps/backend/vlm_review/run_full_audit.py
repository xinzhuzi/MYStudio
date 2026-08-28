"""全章 VLM 视觉一致性审核 — 逐镜跑 VLM 比对，收集结果。"""
import json, os, sys, time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
os.environ.setdefault('MYSTUDIO_STORAGE_BASE', os.path.expanduser('~/Library/Application Support/漫影工作室'))

from vlm_review.adapter import review_image, _load_model
from vlm_review.model_cache import find_cached_vlm_model

# 预加载模型(冷装载一次,后续复用)
model_dir = find_cached_vlm_model()
if not model_dir:
    print("模型未找到"); sys.exit(1)
print(f"模型: {os.path.basename(model_dir)}")
_load_model(model_dir)
print("模型已加载(缓存)\n")

requests = json.load(open('/tmp/vlm-audit-all.json', encoding='utf-8'))
results = []
for req in requests:
    idx = req.get('shotIndex', 0)
    started = time.time()
    try:
        result = review_image(
            generated_path=req['generatedImagePath'],
            reference_paths=[r['path'] for r in req['referenceImages']],
            expected_content=req['expectedContent'],
            expected_characters=req.get('expectedCharacters', []),
            model_dir=model_dir,
        )
        status = result.get('status', 'blocked')
        checks = result.get('checks', {})
        reasons = result.get('reasons', [])
        elapsed = time.time() - started
        icon = '✅' if status == 'accepted' else '❌' if status == 'rejected' else '⚠️'
        print(f"{icon} S{idx:02d} {status:8s} ({elapsed:.1f}s)")
        if status == 'rejected':
            for r in reasons[:3]:
                print(f"     {r}")
        results.append({
            "shotIndex": idx, "shotId": req['shotId'],
            "status": status, "checks": checks, "reasons": reasons,
        })
    except Exception as e:
        print(f"⚠️ S{idx:02d} ERROR: {e}")
        results.append({"shotIndex": idx, "shotId": req['shotId'], "status": "error", "reasons": [str(e)]})

# Summary
accepted = sum(1 for r in results if r['status'] == 'accepted')
rejected = sum(1 for r in results if r['status'] == 'rejected')
blocked = sum(1 for r in results if r['status'] in ('blocked', 'error'))
print(f"\n{'='*50}")
print(f"审核完成: {len(results)} 镜")
print(f"  ✅ 一致(accepted): {accepted}")
print(f"  ❌ 不一致(rejected): {rejected}")
print(f"  ⚠️ 跳过/错误: {blocked}")

if rejected > 0:
    print(f"\n不一致镜清单:")
    for r in results:
        if r['status'] == 'rejected':
            print(f"  S{r['shotIndex']:02d}: {[c for c,v in r.get('checks',{}).items() if v is False]}")

json.dump(results, open('/tmp/vlm-audit-results.json','w',encoding='utf-8'), ensure_ascii=False, indent=2)
print(f"\n结果已写 /tmp/vlm-audit-results.json")
