"""Preserve the 21 named source entries and verify their recorded blob identities."""
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/11-10-humanizer-fusion'
OUT = TASK / 'research/source-snapshots-20261110'
OUT.mkdir(exist_ok=True)
entries = [
    ('lieflat-local', '/Users/zhengbingjin/.agents/skills/lieflat-less-ai-tone/SKILL.md', None),
    ('human-writing-local', '/Users/zhengbingjin/.agents/skills/human-writing/SKILL.md', None),
    ('script-doctor-local', '/Users/zhengbingjin/.zcode/skills/script-doctor/SKILL.md', None),
    ('op7418', '/tmp/humanizer_sources/op7418--Humanizer-zh.md', 'ef07b54da21a41d4a7e4fe0b0afb928f597eb684'),
    ('story-deslop', '/tmp/humanizer_sources/zenstory-ai--oh-story-claudecode.md', '503e87175aee4451718c9ee412829348f7ef834c'),
    ('mrgediao', '/tmp/humanizer_sources/MrGeDiao--shuorenhua.md', '0dec98237e38c1b41b24704ca8e88ab94a2043d4'),
    ('human-writing-upstream', '/tmp/humanizer_sources/kkkkhazix--human-writing.md', '23980c628d2195ed154e96925a1233967fc693f5'),
    ('ai-zixun', '/tmp/humanizer_sources/ai-zixun--humanizer-zh.md', '6d63916672a4c64c0cc62e709c502a37970d28d8'),
    ('ljg-plain', '/tmp/humanizer-ljg-plain-64646767.md', None),
    ('ra-renhua', '/tmp/humanizer_sources/pluviobyte--rnskill.md', '6312fca687c92e1519820a07be6ccb2f05e0fd5b'),
    ('blader', '/tmp/humanizer_sources/blader--humanizer.md', '19fc634208e8cc6ae55d4ff287152583216fd244'),
    ('cursor', '/tmp/humanizer_sources/cursor--plugins.md', '1b3827c7f991182149a7abda696af43ff8f17a12'),
    ('brian-historical', str(TASK / 'research/brian-provenance-20261110/deslop-author-version.md'), '6e5b88444096f674299bb5ea2fe884e10f911c6a'),
    ('samber', '/tmp/humanizer_sources/samber--cc-skills.md', '3c8659eba8fc163f60663ff573dccd9c87203efa'),
    ('finnish', '/tmp/humanizer_sources/github--awesome-copilot.md', 'b850aa40aec79881e51536d9f4703ebee25854e7'),
    ('nomad', '/tmp/humanizer_sources/nomadamas--k-skill.md', 'fbca1e0d4b551a05f20dfb5aed75a27281adca4a'),
    ('daleseo', '/tmp/humanizer_sources/daleseo--korean-skills.md', 'cc6a9a6c3e3cb7ffb32f90b2303d4780d6c8245d'),
    ('qu-ai-wei', '/tmp/humanizer_sources/hardydai-cell--qu-ai-wei.md', '99fbfb84d073731df9836fa5f5da471d6a37ebee'),
    ('human-tone', '/tmp/humanizer_sources/betterwu7889--human-tone-writing.md', '611db595a18aad85ef19e62c7d890cab4164862f'),
    ('one-skill', '/tmp/humanizer_sources/1-skill--shuorenhua.md', '254e5d4d132c3868f421bc95939ddda9c8e85829'),
    ('jay', '/tmp/humanizer-research-1111/jay-de-gpt-ify-fixed.md', None),
]
records = []
for identity, filename, expected_blob in entries:
    source = Path(filename)
    data = source.read_bytes()
    blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
    if expected_blob is not None and blob != expected_blob:
        raise ValueError(f'Recorded blob mismatch: {identity}')
    destination = OUT / (identity + '.md')
    if destination.exists() and destination.read_bytes() != data:
        raise ValueError(f'Preserved snapshot changed: {identity}')
    destination.write_bytes(data)
    records.append({'id':identity, 'original_path':str(source), 'snapshot':destination.name, 'bytes':len(data), 'sha256':hashlib.sha256(data).hexdigest(), 'blob':blob, 'expected_blob':expected_blob, 'identity_check':'recorded blob matched' if expected_blob else 'local bytes only; see source ledger for version evidence'})
manifest = {'date':'2026-11-10', 'entries':records, 'scope':'21 named entry snapshots; related references are audited separately; hashes do not verify author claims or behavioral quality.'}
(OUT / 'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'snapshots':len(records),'recorded_blob_matches':sum(x['expected_blob'] is not None for x in records),'total_bytes':sum(x['bytes'] for x in records)},ensure_ascii=False))
