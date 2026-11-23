"""Offline prepare/parse only; bounded send remains in the existing stdin-key runner."""
import argparse
import hashlib
import json
from pathlib import Path
import director_chain_glm_1026 as chain

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chapter001-repair-1026'
FILES = {'script': 'text-v4/script.md', 'planning': 'planning-v3/plan.md', 'storyboard': 'storyboard-v3/output.md'}
HASHES = {'script': '86792c6f7a9608c8c875c6afdc718e4e65e1036ab808bbae3fc1e5311165190a', 'planning': '77bc5e72a8e7eb6d9a2378e6608380ab9aeea86a6efb71926161824b994f900d', 'storyboard': '40ca7928e1e607285c02f88d780d90998753667ed5be506a01e83ad87c371eac'}


def load(file):
    return json.loads(file.read_text())


def new_json(file, value):
    with file.open('x', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['prepare', 'parse'])
    parser.add_argument('stage', choices=list(FILES))
    args = parser.parse_args()
    texts = {stage: (BASE / file).read_text() for stage, file in FILES.items()}
    for stage, text in texts.items():
        assert hashlib.sha256(text.encode()).hexdigest() == HASHES[stage]
    folder = (BASE / FILES[args.stage]).parent / 'audit-v1'
    if args.operation == 'prepare':
        assert not folder.exists()
        job = load(BASE / 'storyboard-v2/audit-v2/job.json')
        job.update(operation='audit', stage=args.stage, scriptText=texts['script'], planRaw=texts['planning'], outputText=texts[args.stage])
        prepared = chain.bridge(job)
        assert prepared['structurePassed']
        if args.stage == 'storyboard':
            assert prepared['totalDurationSeconds'] == 180
        prepared['request']['max_tokens'] = 16384
        addendum = ''
        if args.stage == 'storyboard':
            indices = [index for index, line in enumerate([x.strip() for x in texts['storyboard'].splitlines() if x.strip()]) if line.startswith('| ') and line.split('|')[1].strip().isdigit()]
            assert len(indices) == 18
            addendum = '本次18个数据行的目录索引为' + json.dumps(indices) + '。这些整行都包含现场动作/台词/道具状态；按既有整行分类协议，各维引用这些行时统一kind=physical_fact，不能把这种整行当作独立纯身份行，因此也不能对这种整行使用sourceKind=bible。只有独立纯身份目录行才能用identity和圣经。该分类约束绝不表示事实受支持，仍逐项回查全部事实、时序、动作起止与出镜；任何不受支持项须false并给出精确索引findings，不拿相关却不支持的来源充数。'
            prepared['request']['system'] += '\n\n' + addendum
        folder.mkdir()
        new_json(folder / 'job.json', job)
        new_json(folder / 'prepared.json', prepared)
        new_json(folder / 'protocol.json', {'operator': 'root', 'reason': 'F1-F5 source-verified editorial corrections create new immutable hashes; old audits preserved', 'automaticRetry': False, 'maximumSendCallsThisStage': 1, 'maximumSendCallsThisSlice': 3, 'initialCumulativeCalls': 134, 'ceiling': 156, 'helperSha256': hashlib.sha256((ROOT / 'apps/frontend/lib/studio/daojie-generation-audit.ts').read_bytes()).hexdigest(), 'sourceSha256': '79da99d9390a71010fa4a6b7949de19a6b963c549c0988d59ad784894bf7587b', 'outputs': HASHES, 'protocolAddendum': addendum, 'projectWrites': 0})
        print(json.dumps({'stage': args.stage, 'structurePassed': True, 'folder': str(folder), 'networkCalls': 0}))
    else:
        job = load(folder / 'job.json')
        meta = load(folder / 'send/response.json')
        decision = chain.bridge({**job, 'operation': 'parse-audit', 'reviewText': (folder / 'send/output.md').read_text(), 'responseSuccess': meta['status'] == 'received', 'responseError': meta.get('error')})
        new_json(folder / 'decision.json', decision['review'])
        print(json.dumps({'stage': args.stage, 'passed': decision['review']['passed'], 'reasonLine': decision['review']['report'].split('\n\n')[1], 'networkCalls': 0}, ensure_ascii=False))


if __name__ == '__main__':
    main()
