"""Offline accounting/dependency safety tests. Never calls an API."""
import json
from pathlib import Path
import pytest
import director_chain_acceptance_1026 as run

def make_ledger(path, calls=114):
    rows=[]
    for call in range(1,calls+1):
        if call <= 2: rows.append({'event':'probe','call':call})
        else:
            rows.extend([{'event':'attempt','call':call,'key':str(call)}, {'event':'response','call':call,'key':str(call),'systemic':False}])
    path.write_text(''.join(json.dumps(row)+'\n' for row in rows))
    return path

def test_start114_add115_and_preserve_history(tmp_path):
    p=make_ledger(tmp_path/'ledger.jsonl'); prefix=p.read_bytes()
    with run.AcceptanceLedger(p,114) as ledger:
        assert ledger.attempt('new','hash')['call']==115
        ledger.record({'event':'response','key':'new','call':115,'systemic':False})
    assert p.read_bytes().startswith(prefix)
    with run.AcceptanceLedger(p,115) as ledger: assert ledger.count==115

def test_cap156(tmp_path):
    with run.AcceptanceLedger(make_ledger(tmp_path/'ledger',156),156) as ledger:
        with pytest.raises(run.old.HarnessError, match='call_limit_reached'): ledger.attempt('new','hash')

def test_duplicate_no_retry(tmp_path):
    with run.AcceptanceLedger(make_ledger(tmp_path/'ledger'),114) as ledger:
        with pytest.raises(run.old.HarnessError,match='already_recorded'): ledger.attempt('114','hash')

def test_orphan_attempt_blocks_next_send(tmp_path):
    p=make_ledger(tmp_path/'ledger')
    with p.open('a') as f: f.write(json.dumps({'event':'attempt','call':115,'key':'orphan'})+'\n')
    with pytest.raises(run.old.HarnessError,match='unfinished_attempt'):
        with run.AcceptanceLedger(p,115): pass

def test_expected_count_and_systemic_failures(tmp_path):
    p=make_ledger(tmp_path/'ledger')
    with pytest.raises(run.old.HarnessError,match='unexpected_call'):
        with run.AcceptanceLedger(p,113): pass
    with p.open('a') as f: f.write(json.dumps({'event':'diagnostic','systemic':True})+'\n')
    with pytest.raises(run.old.HarnessError,match='systemic_failure'):
        with run.AcceptanceLedger(p,114): pass

def test_primary_hash_and_first_batch_barrier(tmp_path, monkeypatch):
    monkeypatch.setattr(run,'ROOT',tmp_path)
    for case in ('P5','R3'):
        for stage in run.old.STAGES:
            p=tmp_path/'chains'/case/stage
            (p/'generation').mkdir(parents=True);(p/'audit').mkdir()
            (p/'generation/output.md').write_text('original')
            (p/'audit/decision.json').write_text('{"passed":true}')
            (p/'primary-review.json').write_text(json.dumps({'passed':True,'outputSha256':run.old.digest(b'original')}))
    assert run.check_dependencies('P1','script')=={'scriptText':'','planRaw':''}
    (tmp_path/'chains/P5/script/generation/output.md').write_text('changed')
    with pytest.raises(run.old.HarnessError,match='hash_mismatch'): run.check_dependencies('P1','script')
    with pytest.raises(run.old.HarnessError,match='hash_mismatch'): run.check_dependencies('P5','planning')
