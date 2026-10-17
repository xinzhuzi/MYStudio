from pathlib import Path
import shutil,json
root=Path('apps/build/scripts/project-gap-audit-1017')
b=Path('apps/output/automation/project-gap-audit-1017/backups-1018/probes');b.mkdir(parents=True,exist_ok=True)
for p in root.iterdir():
 if p.is_file() and not (b/p.name).exists():shutil.copy2(p,b/p.name)
p=root/'write-ack.test.ts';s=p.read_text().replace('failed disk write resolves and migration removes sole browser copy','failed disk write rejects and migration retains sole browser copy').replace('await expect(fileStorage.setItem("audit-save",payload)).resolves.toBeUndefined();','await expect(fileStorage.setItem("audit-save",payload)).rejects.toThrow();').replace('expect(localStorage.getItem("audit-migrate")).toBeNull();','expect(localStorage.getItem("audit-migrate")).toBe(payload);');p.write_text(s)
p=root/'split-storage.test.ts';s=p.read_text().replace('saving while sharing is disabled clears existing shared resources','saving while sharing is disabled preserves existing shared resources').replace('expect(JSON.parse(storageMocks.values.get("_shared/characters")!).state.items).toEqual([]);','expect(JSON.parse(storageMocks.values.get("_shared/characters")!).state.items).toEqual([{id:"shared"}]);').replace('removing the last other-project item leaves its disk file unchanged','removing the last loaded other-project item remains deleted after reload').replace('expect(reloaded.state.items.map((i:TestItem)=>i.id)).toEqual(["last"]);','expect(reloaded.state.items.map((i:TestItem)=>i.id)).toEqual([]);');p.write_text(s)
p=root/'queue.test.ts';s=p.read_text().replace('parallel commits reuse seq and journal-only recovery loses one job','parallel commits use unique seq and journal-only recovery preserves both jobs').replace('expect(events.map(e=>e.seq)).toEqual([1,1]);','expect(events.map(e=>e.seq)).toEqual([1,2]);').replace('toHaveLength(1);','toHaveLength(2);').replace('blocked jobs cannot be canceled when no executor owns them','blocked jobs cancel without an executor').replace('expect(queue.cancel(input.job.jobId).success).toBe(false);','expect((await queue.cancel(input.job.jobId)).success).toBe(true);').replace('expect(calls).toBe(1);','expect(calls).toBe(0);').replace('expect(queue.getJob(input.job.jobId)?.status).toBe("blocked");','expect(queue.getJob(input.job.jobId)?.status).toBe("canceled");').replace('public parallel enqueue produces duplicate journal sequence','public parallel enqueue produces unique journal sequences').replace('expect(new Set(events.map(e=>e.seq)).size).toBeLessThan(events.length);','expect(new Set(events.map(e=>e.seq)).size).toBe(events.length);');p.write_text(s)
p=root/'read-boundary.test.ts';s=p.read_text().replace('currently reports both a missing file and a failed read as null','distinguishes missing files from read failures').replace('    const unreadable = await get({}, "audit-read");','    await expect(get({}, "audit-read")).rejects.toThrow("isolated permission failure");').replace('    expect(unreadable).toBeNull();','    expect(probe.readFileSync).toHaveBeenCalledOnce();');p.write_text(s)
p=root/'README.json';d=json.loads(p.read_text());d['note']='Positive regression assertions after 2026-10-18 repair. Original defect probes and logs are retained in audit/backups-1018/probes.';p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
p=Path('apps/build/scripts/project-gap-audit-1017.py');shutil.copy2(p,b/p.name)
p.write_text('''"""Verify the retained, positive regression probes; never regenerate old defect assertions."""
from pathlib import Path
import hashlib
import json

base = Path(__file__).with_suffix("")
files = sorted(base.glob("*.test.ts"))
if len(files) != 4:
    raise SystemExit("Expected four retained audit regression test files")
print(json.dumps({"probes": [{"path": str(p), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in files]}, indent=2))
''')
