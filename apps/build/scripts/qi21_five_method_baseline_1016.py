"""Recheck failing tests against pre-change bytes without touching production files."""
import json,re,sys
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/qi21-five-method-style-1016'
rows=json.loads((OUT/'sync-changes.json').read_text())
preimages={str(Path(r['path']).resolve()):Path(r['backup']).read_bytes() for r in rows if Path(r['path']).suffix in ('.json','.md')}
src=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng/json/qi21_bases.json'
preimages[str(src.resolve())]=(OUT/'backups/qi21_bases.before-source.json').read_bytes()
orig_text=Path.read_text;orig_bytes=Path.read_bytes

def read_bytes(p):
    key=str(p.resolve())
    return preimages[key] if key in preimages else orig_bytes(p)

def read_text(p,encoding=None,errors=None,**kw):
    key=str(p.resolve())
    return preimages[key].decode(encoding or 'utf-8',errors or 'strict') if key in preimages else orig_text(p,encoding=encoding,errors=errors,**kw)

failed=re.findall(r'^FAILED (\S+)',(OUT/'backend-tests.log').read_text(),re.M)
assert len(failed)==14
Path.read_bytes=read_bytes;Path.read_text=read_text
code=pytest.main(['-q',*failed])
print('BASELINE_TEST_EXIT',code)
sys.exit(int(code))
