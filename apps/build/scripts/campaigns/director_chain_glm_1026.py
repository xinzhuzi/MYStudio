"""Bounded follow-up: frozen failure audits then current production chains, max 15 sends."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import subprocess
import sys
import uuid
import director_quality_glm_1025 as old

ROOT = old.COMPARISON / "chain-v8"
FROZEN = old.COMPARISON / "fidelity-v6"

def bridge(job):
    folder = ROOT / "bridge" / uuid.uuid4().hex
    old.persist(folder / "input.json", job)
    env = dict(os.environ)
    env.pop("GLM_DIRECTOR_API_KEY", None)
    env.update(DIRECTOR_CHAIN_INPUT=str(folder / "input.json"), DIRECTOR_CHAIN_OUTPUT=str(folder / "output.json"))
    run = subprocess.run(["npm", "test", "--", "build/scripts/director_chain_requests_1026.test.ts", "--maxWorkers", "1"], cwd=old.REPO / "apps", env=env, capture_output=True, timeout=180)
    old.persist(folder / "vitest.log", (run.stdout + run.stderr).decode(errors="replace"))
    old.require(run.returncode == 0, "offline_bridge_failed:" + folder.name)
    return old.load_json(folder / "output.json")

def prepare():
    files = []
    for item in old.load_json(FROZEN / "P5/revised/sample-001/input-manifest.json")["manualFiles"]:
        relative = item["relativePath"]
        file = old.REPO / "apps/frontend/assets/studio-manuals" / relative
        content = file.read_text()
        files.append({"relativePath": relative, "content": content, "sha256": old.digest(content)})
    old.require(len(files) == 5, "five_current_manuals_required")
    old.persist(ROOT / "manuals.json", files)
    return files

def send(folder, job, ledger, key):
    prepared = bridge(job)
    old.persist(folder / "prepared.json", prepared)
    attempt = ledger.attempt(ROOT.name + ":" + str(folder.relative_to(ROOT)), old.digest(old.encoded(prepared["request"])))
    text, metadata = old.transport(prepared["request"], key, 300)
    old.persist(folder / "output.md", text)
    old.persist(folder / "response.json", metadata)
    ledger.record({"event": "response", "key": attempt["key"], "call": attempt["call"], "status": metadata["status"], "httpStatus": metadata["httpStatus"], "systemic": metadata["systemic"]})
    old.emit(stage=str(folder.relative_to(ROOT)), status=metadata["status"], calls=ledger.count)
    old.require(not metadata["systemic"], "systemic_transport_failure_stop")
    return text, metadata

def audit(folder, job, ledger, key):
    prepared = bridge({**job, "operation": "audit"})
    if not prepared["structurePassed"] or (job["stage"] == "storyboard" and not 0 < prepared["totalDurationSeconds"] <= 180):
        old.persist(folder / "decision.json", {"passed": False, "reason": "deterministic_structure_or_duration", "parsed": prepared.get("parsed"), "totalDurationSeconds": prepared.get("totalDurationSeconds")})
        return False
    text, meta = send(folder, {**job, "operation": "audit"}, ledger, key)
    parsed = bridge({**job, "operation": "parse-audit", "reviewText": text, "responseSuccess": meta["status"] == "received", "responseError": meta.get("error")})
    old.persist(folder / "decision.json", parsed["review"])
    return parsed["review"]["passed"]

def main():
    global ROOT
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--profile", choices=("v8", "v9", "v10"), default="v8")
    options = parser.parse_args()
    ROOT = old.COMPARISON / ("chain-" + options.profile)
    files = prepare()
    inputs = {case: old.load_json(FROZEN / case / "revised/sample-001/input-manifest.json") for case in ("P5", "R3", "R2")}
    # Reverify each source reference before any authorized minimal excerpt leaves the machine.
    old.load_sources(old.RESEARCH / "model-source-locations-canonical.json")
    old.persist(ROOT / "protocol.json", {"model": "glm-5.3", "initialCalls": {"v8": 99, "v9": 106, "v10": 110}[options.profile], "ceiling": 114, "noRetry": True, "newChainCases": ["P5", "R3"], "oldFailureAudits": ["P5:script", "R3:script", "R2:storyboard"] if options.profile == "v8" else [], "scope": "production builders and strict review helper; hooks covered separately offline; no real project writes"})
    if not options.run:
        bridge({"operation": "build", "stage": "script", "input": inputs["P5"], "manualFiles": files})
        print("prepared_offline_no_api_calls", flush=True)
        return
    key = sys.stdin.readline().strip()
    old.require(bool(key), "missing_in_memory_key")
    with old.Ledger(old.COMPARISON / "ledger.jsonl", old.PROBES, 114) as ledger:
        old.require(ledger.count == ({"v8": 99, "v9": 106, "v10": 110}[options.profile]), "unexpected_calls_no_resume_or_retry")
        for case, stage, filename in ((("P5", "script", "script.md"), ("R3", "script", "script.md"), ("R2", "storyboard", "storyboard.md")) if options.profile == "v8" else ()):
            sample = FROZEN / case / "revised/sample-001"
            job = {"input": inputs[case], "manualFiles": files, "stage": stage, "outputText": (sample / filename).read_text(), "scriptText": (sample / "script.md").read_text(), "planRaw": (sample / "director-plan.md").read_text()}
            audit(ROOT / "old-failures" / case / stage, job, ledger, key)
        for case in ("P5", "R3"):
            script = plan = ""
            for stage in (("script",) if options.profile == "v10" else old.STAGES):
                if ledger.count + 2 > 114:
                    old.persist(ROOT / "chains" / case / stage / "chain-status.json", {"passed": False, "reason": "cumulative_budget_prevents_stage"})
                    break
                job = {"operation": "build", "input": inputs[case], "manualFiles": files, "stage": stage, "scriptText": script, "planRaw": plan}
                folder = ROOT / "chains" / case / stage
                text, meta = send(folder / "generation", job, ledger, key)
                if meta["status"] != "received":
                    old.persist(folder / "chain-status.json", {"passed": False, "reason": "generation_transport_or_truncation"}); break
                job["outputText"] = text
                if not audit(folder / "audit", job, ledger, key):
                    old.persist(folder / "chain-status.json", {"passed": False, "reason": "audit_rejected_downstream_stopped"}); break
                old.persist(folder / "chain-status.json", {"passed": True, "meaning": "model_review_pass_only_requires_primary_source_review"})
                if stage == "script": script = text
                if stage == "planning": plan = text
        old.persist(ROOT / "run-summary.json", {"finalCalls": ledger.count, "maxCalls": 114, "primarySemanticReview": "pending", "realMediaGeneration": False})
        print("batch_finished_review_required", flush=True)

if __name__ == "__main__":
    main()
