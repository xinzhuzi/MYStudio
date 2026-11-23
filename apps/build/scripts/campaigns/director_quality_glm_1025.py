"""Task-local GLM comparison. Preparation is offline; only --run enables HTTP."""

import argparse
import collections
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid


REPO = Path(__file__).resolve().parents[3]
RESEARCH = REPO / ".trellis/tasks/10-25-daojie-director-rule-conflict-validation/research"
COMPARISON = RESEARCH / "model-comparison"
DRY_RUN = RESEARCH / "model-harness-dry-run"
SOURCES = RESEARCH / "model-source-locations.json"
PROBES = RESEARCH / "model-transport-probes.json"
ENDPOINT = "https://open.bigmodel.cn/api/anthropic/v1/messages"
STAGES = ("script", "planning", "storyboard")
ARMS = ("baseline", "revised")
OUTPUT_NAMES = {"script": "script.md", "planning": "director-plan.md", "storyboard": "storyboard.md"}
SCOPE = "只适配给定片段，不续写上下文，不补新事件、动作、受害者、台词或资产，不把拍法变成剧情事实。只输出该阶段结果，不调用工具。"
PROBE_SCOPE = "这是设定边界探针，probeConstraints仅为测试条件，不是已发生剧情。禁止生成新事件、动作、受害者、台词或资产；无剧情不可逐镜化时仅输出 [N/A:canonical_boundary_probe] 加原因，不强造剧本或规划。"


class HarnessError(Exception):
    pass


def digest(value):
    return hashlib.sha256(value.encode("utf-8") if isinstance(value, str) else value).hexdigest()


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def load_json(path):
    return json.loads(Path(path).read_bytes())


def require(condition, message):
    if not condition:
        raise HarnessError(message)


def persist(path, value):
    path = Path(path)
    data = value.encode("utf-8") if isinstance(value, str) else encoded(value)
    require(path.resolve().is_relative_to(RESEARCH.resolve()), "write_outside_task_research")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.read_bytes() == data, "immutable_artifact_conflict:" + path.name)
        return
    with path.open("xb") as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def append_json(path, value):
    with Path(path).open("a", encoding="utf-8") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")
        stream.flush()
        os.fsync(stream.fileno())


def excerpt(reference):
    raw = Path(reference["path"]).read_bytes()
    require(digest(raw) == reference["sha256"], "source_file_hash_mismatch")
    lines = raw.decode("utf-8").splitlines(keepends=True)
    start, end = reference["startLine"], reference["endLine"]
    require(isinstance(start, int) and isinstance(end, int) and 1 <= start <= end <= len(lines), "source_line_range_invalid")
    text = "".join(lines[start - 1:end])
    require(digest(text) == reference["excerptSha256"], "source_excerpt_hash_mismatch")
    return text


def source_reference(case, canonical=False):
    return {
        "path": case["canonPath" if canonical else "sourcePath"],
        "startLine": case["canonStartLine" if canonical else "startLine"],
        "endLine": case["canonEndLine" if canonical else "endLine"],
        "sha256": case["canonSha256" if canonical else "sourceSha256"],
        "excerptSha256": case["canonExcerptSha256" if canonical else "sourceExcerptSha256"],
    }


def load_sources(source_path=SOURCES):
    source_path = Path(source_path)
    canonical_path = (RESEARCH / "model-source-locations-canonical.json").resolve()
    require(source_path.resolve() in (SOURCES.resolve(), (RESEARCH / "model-source-locations-expanded.json").resolve(), canonical_path), "source_manifest_not_allowed")
    document = load_json(source_path)
    cases = document["cases"]
    require(len(cases) == 19 and len({case["id"] for case in cases}) == 19, "source_case_count_changed")
    expected_blocked = {"P2", "P4", "P5", "R3"} if source_path.resolve() == SOURCES.resolve() else {"P2", "P4"}
    if source_path.resolve() == canonical_path:
        expected_blocked = set()
        require(all(case["inputType"] == "canonical_boundary_probe" for case in cases if case["id"] in ("P2", "P4")), "technique_probe_type_changed")
    require({case["id"] for case in cases if case["status"] == "blocked"} == expected_blocked, "blocked_case_set_changed")
    require(digest(Path(document["caseSpecification"]["path"]).read_bytes()) == document["caseSpecification"]["sha256"], "case_specification_changed")
    checked = 0
    for case in cases:
        references = [source_reference(case, True), *case["supportingSources"], *case["rejectedSources"]]
        if case["sourcePath"]:
            references.append(source_reference(case))
        for ambiguity in case.get("sourceAmbiguities", []):
            references.extend(ambiguity["references"])
        for reference in references:
            excerpt(reference)
            checked += 1
    return document, checked


def load_manuals(manual_root=None):
    manual_root = Path(manual_root) if manual_root else COMPARISON / "manuals"
    require(manual_root.resolve() in ((COMPARISON / "manuals").resolve(), (COMPARISON / "manuals-v3").resolve(), (COMPARISON / "manuals-v5").resolve()), "manual_root_not_allowed")
    arms = {}
    baseline = {item["file"].split("assets/studio-manuals/")[-1]: item["sha256"] for item in load_json(RESEARCH / "baseline-hashes.json")}
    for arm in ARMS:
        root = manual_root / arm
        files = sorted(root.rglob("*.md"))
        require(len(files) == 5, "frozen_manual_count_changed")
        arms[arm] = []
        for file in files:
            raw = file.read_bytes()
            relative = file.relative_to(root).as_posix()
            if arm == "baseline":
                require(baseline.get(relative) == digest(raw), "baseline_manual_hash_mismatch")
            arms[arm].append({"relativePath": relative, "content": raw.decode("utf-8"), "sha256": digest(raw)})
    return arms


def make_input(case, registry):
    source = source_reference(case)
    text = excerpt(source)
    assets = []
    for index, entry in enumerate(registry.get(case["id"], []), 1):
        require(isinstance(entry, dict) and entry.get("kind") in ("character", "scene", "prop"), "invalid_asset_kind")
        name = entry.get("name")
        require(isinstance(name, str) and name.strip() == name and name and name in text, "asset_not_in_source_excerpt")
        require(not any(asset["name"] == name for asset in assets), "duplicate_asset_name")
        assets.append({"id": f"dq1025-{case['id']}-{index:03d}", "name": name, "kind": entry["kind"], "source": source})
    table = {"mode": "isolated-text-only", "productAssets": False, "generated": False, "entries": assets}
    asset_version = digest(encoded(table))
    inventory = "仅为实验隔离文本登记，不是用户产品资产，不提供图片，不得创建新资产。\n"
    inventory += "\n".join(f"- {asset['kind']}：{asset['name']}（实验ID：{asset['id']}）" for asset in assets) or "无已登记实体；不能猜测资产。"
    bible_parts = ["## 原著设定片段（仅供事实边界，不是待新增剧情）", excerpt(source_reference(case, True))]
    for reference in case["supportingSources"]:
        bible_parts.extend(["### 补充原文依据（不扩写为当前事件）", excerpt(reference)])
    bible_parts.extend(["### 已知进度及依据（未知保持未知）", json.dumps(case["progress"], ensure_ascii=False, sort_keys=True)])
    if case.get("probeConstraints"):
        bible_parts.extend(["### 设定探针条件（并非已发生剧情）", case["probeConstraints"]])
    if case.get("sourceAmbiguities"):
        bible_parts.extend(["### 来源差异：保留冲突，不合并时序", *[item["note"] for item in case["sourceAmbiguities"]]])
        bible_parts.append("排除主题：" + "；".join(case.get("excludedTopics", [])))
    bible = "\n\n".join(bible_parts)
    scope = SCOPE + ("\n" + PROBE_SCOPE if case["inputType"] == "canonical_boundary_probe" else "")
    return {
        "caseId": case["id"], "episodeId": f"dq1025-{case['id']}", "inputType": case["inputType"],
        "chapterTitle": f"{case['id']} {case['title']}（限定片段）", "chapterText": text,
        "bibleContext": bible, "scopeConstraint": scope, "assetsInventory": inventory,
        "assets": table, "assetVersion": asset_version, "sourceCase": case,
        "inputSha256": digest(text), "bibleSha256": digest(bible), "scopeSha256": digest(scope),
    }


def bridge(operation, jobs, manuals):
    invocation = uuid.uuid4().hex
    folder = DRY_RUN / "bridge" / invocation
    payload = {"schemaVersion": 1, "operation": operation, "jobs": jobs, "manualArms": manuals}
    persist(folder / "input.json", payload)
    environment = dict(os.environ)
    environment.pop("GLM_DIRECTOR_API_KEY", None)
    environment.update(DIRECTOR_QUALITY_INPUT=str(folder / "input.json"), DIRECTOR_QUALITY_OUTPUT=str(folder / "output.json"))
    command = ["npm", "test", "--", "build/scripts/director_quality_requests_1025.test.ts", "--no-cache", "--maxWorkers", "1"]
    execution = {"command": command, "cwd": str(REPO / "apps"), "input": str(folder / "input.json"), "output": str(folder / "output.json")}
    started = time.monotonic()
    try:
        completed = subprocess.run(command, cwd=REPO / "apps", env=environment, capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        execution.update(exit=None, status="timeout")
        persist(folder / "execution.json", execution)
        append_json(DRY_RUN / "bridge-executions.jsonl", execution)
        raise HarnessError("offline_bridge_timeout") from None
    persist(folder / "vitest.log", (completed.stdout + completed.stderr).decode("utf-8", errors="replace"))
    execution.update(exit=completed.returncode, elapsed=round(time.monotonic() - started, 3))
    persist(folder / "execution.json", execution)
    append_json(DRY_RUN / "bridge-executions.jsonl", execution)
    require(completed.returncode == 0, "offline_bridge_failed:" + invocation)
    return load_json(folder / "output.json")


def sample_dir(root, job):
    return root / job["caseId"] / job["arm"] / "sample-001"


def save_request(folder, result):
    stage = result["stage"]
    persist(folder / f"{stage}-request.json", result["request"])
    persist(folder / f"{stage}-injected-context.json", result["context"])
    persist(folder / f"{stage}-injected-context.md", "\n\n".join(f"## {key}\n{value}" for key, value in result["context"].items()))
    persist(folder / f"{stage}-request-evidence.json", {key: value for key, value in result.items() if key not in ("request", "context")})


def prepare(root, selected, registry, budgets=None, source_path=SOURCES, manual_root=None):
    sources, checked = load_sources(source_path)
    known = {case["id"] for case in sources["cases"]}
    require(not selected or set(selected) <= known, "unknown_case_id")
    require(set(registry) <= known, "unknown_asset_case_id")
    for entries in registry.values():
        require(isinstance(entries, list), "asset_case_entries_must_be_list")
    manuals = load_manuals(manual_root)
    inputs, jobs = {}, []
    for case in sources["cases"]:
        if selected and case["id"] not in selected:
            continue
        if case["status"] != "ready":
            persist(root / case["id"] / "input-blocked.json", case)
            continue
        common = make_input(case, registry)
        if budgets is not None:
            common["tokenBudgets"] = budgets
        inputs[case["id"]] = common
        persist(root / "inputs" / f"{case['id']}.json", common)
        for arm in ARMS:
            jobs.append({**common, "arm": arm, "stage": "script"})
    require(jobs or selected, "no_ready_inputs")
    built = bridge("build", jobs, manuals)
    code_files = [
        "apps/frontend/lib/studio/manuals.ts", "apps/frontend/lib/studio/script-planning.ts",
        "apps/frontend/lib/studio/director-plan.ts", "apps/frontend/lib/studio/storyboard-table.ts",
        "apps/frontend/components/panels/studio/workflow-helpers.ts",
        "apps/build/scripts/director_quality_requests_1025.test.ts", "apps/build/scripts/director_quality_glm_1025.py",
    ]
    experiment = {
        "schemaVersion": 1, "model": "glm-5.3", "endpoint": ENDPOINT, "temperature": 0.2,
        "maxTokens": budgets or {"script": 2048, "planning": 4096, "storyboard": 4096},
        "sourceManifestSha256": digest(Path(source_path).read_bytes()), "publicSkills": built["skills"], "publicSkillsSha256": built["skillsSha256"],
        "manuals": {arm: [{key: file[key] for key in ("relativePath", "sha256")} for file in files] for arm, files in manuals.items()},
        "codeHashes": {file: digest((REPO / file).read_bytes()) for file in code_files},
        "semanticAssessment": "not_performed", "comparisonUnit": "within-arm sequential three-stage chain, not planning-only attribution",
    }
    persist(root / "experiment-lock.json", experiment)
    for result in built["results"]:
        common = inputs[result["caseId"]]
        folder = sample_dir(root, result)
        persist(folder / "input-manifest.json", {
            **common, "arm": result["arm"], "sampleId": "sample-001", "config": result["config"],
            "publicSkillsSha256": built["skillsSha256"], "experimentSha256": digest(encoded(experiment)),
            "manualFiles": experiment["manuals"][result["arm"]],
        })
        save_request(folder, result)
    return inputs, manuals, experiment, checked


class Ledger:
    def __init__(self, path, probes_path, limit):
        self.path = Path(path)
        self.probes = load_json(probes_path)
        self.limit = limit
        self.stream = None
        self.records = []

    def __enter__(self):
        require(self.probes["callsAttempted"] == 2 and len(self.probes["results"]) == 2, "probe_accounting_changed")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.path.open("a+", encoding="utf-8")
        try:
            fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.stream.seek(0)
            self.records = [json.loads(line) for line in self.stream if line.strip()]
            if not self.records:
                for result in self.probes["results"]:
                    self.record({"event": "probe", "call": result["attempt"], "httpStatus": result["httpStatus"], "requestSha256": result["payloadSha256"]})
            imported = [item for item in self.records if item["event"] == "probe"]
            require(len(imported) == 2, "ledger_probe_count_mismatch")
            for item, probe in zip(imported, self.probes["results"]):
                require(item["call"] == probe["attempt"] and item["requestSha256"] == probe["payloadSha256"], "ledger_probe_evidence_mismatch")
            calls = [item["call"] for item in self.records if item["event"] in ("probe", "attempt")]
            require(calls == list(range(1, len(calls) + 1)) and self.count <= 114, "ledger_sequence_invalid")
            attempt_counts = collections.Counter(item["key"] for item in self.records if item["event"] == "attempt")
            require(all(count == 1 for count in attempt_counts.values()), "ledger_duplicate_attempt")
            require(not any(item.get("systemic") for item in self.records), "prior_systemic_failure_requires_review")
            return self
        except BaseException:
            self.stream.close()
            raise

    def __exit__(self, *unused):
        self.stream.close()

    @property
    def count(self):
        return sum(item["event"] in ("probe", "attempt") for item in self.records)

    def record(self, value):
        self.stream.seek(0, os.SEEK_END)
        self.stream.write(json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n")
        self.stream.flush()
        os.fsync(self.stream.fileno())
        self.records.append(value)

    def prior_attempt(self, key):
        return next((item for item in self.records if item["event"] == "attempt" and item["key"] == key), None)

    def attempt(self, key, request_hash):
        require(self.count < min(self.limit, 114), "call_limit_reached")
        require(not self.prior_attempt(key), "attempt_already_recorded_no_retry")
        value = {"event": "attempt", "key": key, "call": self.count + 1, "requestSha256": request_hash, "timestamp": time.time()}
        self.record(value)
        return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        return None


def timeout_handler(signum, frame):
    raise TimeoutError("bounded_http_timeout")


def transport(body, key, timeout):
    request = urllib.request.Request(ENDPOINT, data=encoded(body), method="POST", headers={
        "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01",
    })
    started = time.monotonic()
    metadata = {"httpStatus": None, "modelReturned": None, "usage": None, "stop_reason": None, "status": "failed", "systemic": True}
    text = ""
    previous_handler = signal.signal(signal.SIGALRM, timeout_handler)
    signal.setitimer(signal.ITIMER_REAL, timeout)
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            metadata["httpStatus"] = response.status
            raw = response.read(8 * 1024 * 1024 + 1)
        require(len(raw) <= 8 * 1024 * 1024, "response_too_large")
        result = json.loads(raw)
        require(isinstance(result, dict), "response_not_object")
        metadata.update(modelReturned=result.get("model"), usage=result.get("usage"), stop_reason=result.get("stop_reason"))
        content = result.get("content")
        require(isinstance(content, list), "response_content_invalid")
        text = "\n".join(block["text"] for block in content if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str))
        if metadata["stop_reason"] in ("max_tokens", "model_context_window_exceeded"):
            metadata.update(error="truncated", systemic=False)
        elif not text.strip():
            metadata["error"] = "empty_visible_response"
        elif metadata["stop_reason"] != "end_turn":
            metadata["error"] = "unexpected_stop_reason"
        else:
            metadata.update(status="received", systemic=False)
    except urllib.error.HTTPError as error:
        metadata.update(httpStatus=error.code, error="http_error")
    except (TimeoutError, urllib.error.URLError):
        metadata["error"] = "timeout_or_connection_error"
    except (ValueError, HarnessError, OSError):
        metadata["error"] = "malformed_or_unreadable_response"
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
    metadata["elapsed"] = round(time.monotonic() - started, 3)
    metadata = json.loads(json.dumps(metadata, ensure_ascii=False).replace(key, "[REDACTED]"))
    return text.replace(key, "[REDACTED]"), metadata


def emit(case="-", arm="-", stage="-", status="ok", elapsed=0, calls=None):
    if calls is None:
        try:
            calls = cumulative_calls()
        except (OSError, ValueError, KeyError):
            calls = None
    print(json.dumps({"case": case, "arm": arm, "stage": stage, "status": status, "elapsed": elapsed, "callCount": calls}, ensure_ascii=False), flush=True)


def cumulative_calls():
    count = load_json(PROBES)["callsAttempted"]
    ledger_path = COMPARISON / "ledger.jsonl"
    if ledger_path.exists():
        count += sum(json.loads(line)["event"] == "attempt" for line in ledger_path.read_text().splitlines() if line.strip())
    return count


def execute_chain(root, common, arm, manuals, experiment, ledger, key, timeout):
    job = {**common, "arm": arm}
    folder = sample_dir(root, job)
    sample_result = folder / "sample-result.json"
    if sample_result.exists():
        emit(common["caseId"], arm, status="resume_terminal_sample", calls=ledger.count)
        return
    for stage_index, stage in enumerate(STAGES):
        job["stage"] = stage
        result_path = folder / f"{stage}-result.json"
        metadata_path = folder / f"{stage}-response-metadata.json"
        output_path = folder / OUTPUT_NAMES[stage]
        experiment_prefix = root.relative_to(COMPARISON).as_posix() + "/" if root != COMPARISON and root.is_relative_to(COMPARISON) else ""
        call_key = f"{experiment_prefix}{common['caseId']}/{arm}/sample-001/{stage}"
        previous = ledger.prior_attempt(call_key)
        if any(file.exists() for file in (result_path, metadata_path, output_path)):
            require(previous is not None, "orphan_response_missing_attempt_no_send")
        for file, expected_hash in experiment.get("codeHashes", {}).items():
            require(digest((REPO / file).read_bytes()) == expected_hash, "production_code_changed_during_batch")
        if result_path.exists():
            require(metadata_path.exists() and output_path.exists(), "completed_stage_missing_response")
            metadata = load_json(metadata_path)
            require(digest(output_path.read_bytes()) == metadata["visibleTextSha256"], "response_hash_changed")
            require(digest((folder / f"{stage}-request.json").read_bytes()) == previous["requestSha256"], "attempt_request_hash_changed")
            parsed = load_json(result_path)
        else:
            if stage != "script":
                built = bridge("build", [job], manuals)
                require(built["skillsSha256"] == experiment["publicSkillsSha256"], "public_skills_changed")
                save_request(folder, built["results"][0])
            request_path = folder / f"{stage}-request.json"
            body = load_json(request_path)
            request_hash = digest(request_path.read_bytes())
            if previous:
                require(previous["requestSha256"] == request_hash, "attempt_request_hash_changed")
                if not metadata_path.exists() or not output_path.exists():
                    persist(folder / f"{stage}-failure.json", {"status": "ambiguous_attempt", "error": "attempt_recorded_without_complete_response_no_retry", "call": previous["call"]})
                    raise HarnessError("ambiguous_attempt_no_retry")
                metadata = load_json(metadata_path)
            else:
                attempt = ledger.attempt(call_key, request_hash)
                text, metadata = transport(body, key, timeout)
                metadata.update(call=attempt["call"], requestSha256=request_hash, visibleTextSha256=digest(text))
                persist(output_path, text)
                persist(metadata_path, metadata)
                ledger.record({"event": "response", "key": call_key, "call": attempt["call"], "status": metadata["status"], "httpStatus": metadata["httpStatus"], "systemic": metadata["systemic"]})
            emit(common["caseId"], arm, stage, metadata["status"], metadata["elapsed"], ledger.count)
            if metadata["status"] != "received":
                parsed = {"status": "failed", "error": metadata["error"], "systemic": metadata["systemic"]}
                persist(folder / f"{stage}-failure.json", metadata)
            else:
                visible = output_path.read_bytes().decode("utf-8")
                require(digest(visible) == metadata["visibleTextSha256"], "response_hash_changed")
                try:
                    parsed_output = bridge("parse", [{**job, "text": visible}], {})
                    require(parsed_output["skillsSha256"] == experiment["publicSkillsSha256"], "public_skills_changed")
                    parsed = parsed_output["results"][0]
                    if parsed["status"] == "failed":
                        persist(folder / f"{stage}-failure.json", parsed)
                except HarnessError:
                    persist(folder / f"{stage}-failure.json", {"status": "failed", "error": "offline_parser_bridge_failed", "rawPreserved": True})
                    raise
            persist(result_path, parsed)
        if parsed["status"] != "parsed":
            persist(sample_result, {"status": parsed["status"], "stage": stage, "downstreamBlocked": list(STAGES[stage_index + 1:]), "semanticAssessment": "not_performed", "inputType": common["inputType"]})
            if parsed.get("systemic"):
                raise HarnessError("systemic_transport_failure_stopped_batch")
            return
        if stage == "script":
            job["scriptText"] = parsed["text"]
        elif stage == "planning":
            job["planRaw"] = output_path.read_bytes().decode("utf-8")
    persist(sample_result, {"status": "three_stage_outputs_parsed", "inputType": common["inputType"], "semanticAssessment": "not_performed"})


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--prepare-only", action="store_true", help="Offline: validate all sources, freeze inputs and prepare both arms script requests")
    mode.add_argument("--run", action="store_true", help="Explicitly enable bounded HTTP; reads GLM_DIRECTOR_API_KEY only from environment")
    parser.add_argument("--case", action="append", dest="cases", help="Exact case ID, repeatable; default all 19 (blocked cases never call)")
    parser.add_argument("--arm", action="append", choices=ARMS, dest="arms", help="Select execution arms; preparation still freezes both. Default both")
    parser.add_argument("--limit-calls", type=int, default=114, help="Cumulative ceiling INCLUDING two probes and failed sends (2..114)")
    parser.add_argument("--timeout", type=int, default=180, help="HTTP wall-time and socket bound, seconds (1..300)")
    parser.add_argument("--output-profile", choices=("initial", "reviewed", "final"), default="initial", help="Equal arm caps: reviewed 4096/6144/8192; final 4096/6144/16384 after two documented truncation checks")
    parser.add_argument("--sources-file", type=Path, default=SOURCES, help="Original or reviewed expanded task source manifest")
    parser.add_argument("--manual-root", type=Path, help="Original frozen manuals or reviewed manuals-v3")
    parser.add_argument("--output-root", type=Path, default=COMPARISON, help="Prepare-only may use a subdirectory of model-harness-dry-run")
    parser.add_argument("--assets-file", type=Path, help='Optional task-local JSON: {"P1":[{"name":"literal source entity","kind":"character|scene|prop"}]}')
    return parser.parse_args(argv)


def main(argv=None):
    options = arguments(argv)
    started = time.monotonic()
    require(2 <= options.limit_calls <= 114, "limit_calls_must_be_2_to_114")
    require(1 <= options.timeout <= 300, "timeout_must_be_1_to_300")
    root = options.output_root.resolve()
    reviewed_root = (COMPARISON / "reviewed-output-v2").resolve()
    final_root = (COMPARISON / "final-v3").resolve()
    canonical_root = (COMPARISON / "canonical-p2p4-v4").resolve()
    fidelity_root = (COMPARISON / "fidelity-v5").resolve()
    fidelity_v6_root = (COMPARISON / "fidelity-v6").resolve()
    require(root in (COMPARISON.resolve(), reviewed_root, final_root, canonical_root, fidelity_root, fidelity_v6_root) or root.is_relative_to(DRY_RUN.resolve()), "output_root_not_allowed")
    require(not options.run or root in (COMPARISON.resolve(), reviewed_root, final_root, canonical_root, fidelity_root, fidelity_v6_root), "network_run_requires_comparison_root")
    require(options.output_profile == "initial" or root != COMPARISON.resolve(), "reviewed_profile_requires_separate_evidence_root")
    budgets = {"script": 4096, "planning": 6144, "storyboard": 8192} if options.output_profile == "reviewed" else None
    if options.output_profile == "final":
        budgets = {"script": 4096, "planning": 6144, "storyboard": 16384}
    registry = {}
    if options.assets_file:
        require(options.assets_file.resolve().is_relative_to(RESEARCH.resolve()), "assets_file_must_be_task_local")
        registry = load_json(options.assets_file)
        require(isinstance(registry, dict), "asset_registry_must_be_object")
    if options.prepare_only:
        inputs, manuals, experiment, checked = prepare(root, options.cases, registry, budgets, options.sources_file, options.manual_root)
        receipt = {"readyCases": list(inputs), "checkedReferences": checked, "preparedRequests": len(inputs) * 2, "networkCalls": 0, "publicSkillsSha256": experiment["publicSkillsSha256"]}
        persist(DRY_RUN / "preparations" / f"{uuid.uuid4().hex}.json", receipt)
        emit(status=f"prepared_{len(inputs)}_cases_{checked}_references", elapsed=round(time.monotonic() - started, 3), calls=cumulative_calls())
        return 0
    key = os.environ.get("GLM_DIRECTOR_API_KEY", "")
    require(bool(key.strip()), "missing_GLM_DIRECTOR_API_KEY")
    with Ledger(COMPARISON / "ledger.jsonl", PROBES, options.limit_calls) as ledger:
        inputs, manuals, experiment, checked = prepare(root, options.cases, registry, budgets, options.sources_file, options.manual_root)
        for common in inputs.values():
            for arm in ARMS:
                if options.arms and arm not in options.arms:
                    continue
                execute_chain(root, common, arm, manuals, experiment, ledger, key, options.timeout)
        emit(status="batch_finished_semantics_unassessed", elapsed=round(time.monotonic() - started, 3), calls=ledger.count)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except HarnessError as error:
        emit(status=str(error))
        sys.exit(2)
    except KeyboardInterrupt:
        emit(status="interrupted_no_automatic_retry")
        sys.exit(130)
    except Exception as error:
        emit(status="unexpected_" + type(error).__name__)
        sys.exit(2)
