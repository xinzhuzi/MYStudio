"""Recover selected historical task receipts without executing their commands."""
import hashlib
import json
import sqlite3
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DATABASE = Path.home() / '.zcode/cli/db/db.sqlite'
TASKS = REPO / '.trellis/tasks'
SOURCES = {
    '10-26-hand-fix-pass': [
        'part_mvoqys1k_668ba9d6-1514-4f91-a7bf-c90eab4155b0',
        'part_mvorh2d1_d68a2895-12a0-4433-9b70-a9cbe1d88746',
        'part_mvot9s0w_eca391fd-1733-47c0-8367-e0cedae5c2cc',
        'part_mvou12so_60e5d99d-f9a6-409c-b2c0-4b42401512b9',
        'part_mvou1lto_a00af25c-8aec-4d8d-b3fa-3ce7ef63f405',
        'part_mvou3ad4_8ff77360-d0a4-46bb-ae82-13ed45f71b33',
    ],
    '10-25-moss-win-campaign': [
        'part_mvncmp99_067bdb8a-4126-45f9-baf2-87bb9d98c994',
        'part_mvncnnp6_a22efe0c-c46f-4502-b2ae-e5819eded152',
        'part_mvncpj5r_141cc337-65c8-4ffd-a52d-b00568fb9bf1',
        'part_mvnd0cm9_1323efe5-5539-4663-bd77-522d5fe34381',
        'part_mvnd5n3h_d1149160-f596-4c87-8c00-fa4f097288cb',
        'part_mvn8h1h6_cb0e95d7-7184-4386-bc0a-b61fc37d21e7',
    ],
}
RUNS = [
    'dwfrun-75d71070-ac63-4bfc-9ffe-e2c7866124b1',
    'dwfrun-63f4156e-8b11-4b7c-a094-8e62e94a3fe9',
]
REPORT_PART = 'part_mvn716tt_c6d65252-bec8-486e-a6e1-71a3033b1867'


def write_new(path, content):
    if path.exists():
        if path.read_text() != content:
            raise ValueError(f'Refusing to overwrite different content: {path}')
        return
    with path.open('x') as stream:
        stream.write(content)


def recover():
    with sqlite3.connect(DATABASE.as_uri() + '?mode=ro', uri=True) as connection:
        for task, identifiers in SOURCES.items():
            destination = TASKS / task / 'research/recovered-history'
            destination.mkdir(parents=True, exist_ok=True)
            for identifier in identifiers:
                row = connection.execute(
                    'SELECT session_id,time_created,data FROM part WHERE id=?',
                    (identifier,),
                ).fetchone()
                if row is None:
                    raise ValueError(f'Missing source row: {identifier}')
                data = json.loads(row[2])
                state = data['state']
                assert state['status'] == 'completed'
                receipt = {
                    'source': str(DATABASE), 'partId': identifier,
                    'sessionId': row[0], 'timeCreated': row[1],
                    'sourceRowSha256': hashlib.sha256(row[2].encode()).hexdigest(),
                    'tool': data['tool'], 'historical': True,
                    'output': state['output'],
                }
                write_new(destination / (identifier + '.json'),
                          json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
            print(task, 'receipts recovered:', len(identifiers))
        destination = TASKS / '10-25-moss-win-campaign/research/recovered-history'
        row = connection.execute('SELECT data FROM part WHERE id=?', (REPORT_PART,)).fetchone()
        state = json.loads(row[0])['state']
        assert state['status'] == 'completed'
        write_new(destination / 'report-original.md', state['input']['content'])
        for identifier in RUNS:
            row = connection.execute(
                'SELECT status,result_json,time_updated FROM dwf_run WHERE id=?',
                (identifier,),
            ).fetchone()
            assert row and row[0] == 'completed'
            result = {'runId': identifier, 'status': row[0], 'timeUpdated': row[2],
                      'historical': True, 'result': json.loads(row[1])}
            write_new(destination / (identifier + '.json'),
                      json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print('Original report and two run results recovered; not fresh verification.')


if __name__ == '__main__':
    recover()
