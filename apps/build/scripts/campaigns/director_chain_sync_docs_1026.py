"""Synchronize this task's current receipts, keeping prior records as history. No Git/API."""
from pathlib import Path
import json
import shutil

repo = Path(__file__).resolve().parents[3]
task = repo / '.trellis/tasks/10-25-daojie-director-rule-conflict-validation'
research = task / 'research'
backup = task / 'backups/chain-1026/document-sync'
backup.mkdir(exist_ok=True)
report = 'research/chain-generation-and-install-review-1026.md'
summary = ('1026当前：生产生成链路已按用户批准修复，新增剧本格式/时长硬门；'
           '04:14定点11文件261测试、七生产文件lint和当次typecheck exit0。'
           '04:19全量测试/全量lint仍受在途资产弹窗解析/变量错误影响，聚合门因旧任务审批文件缺失失败，不能称全仓通过。'
           '最终唯一build-mac.sh覆盖安装exit0，installed smoke和系统启动退出通过，五手册/七标识/七源码hash匹配。'
           '累计114/114调用，新增15次中9审核仅1模型PASS；R3仍增写，P5旧稿有格式/时长问题，现均被离线结构门拒绝。'
           '无新的完整三阶段实模通过链；AC5开放、task保持in_progress。'
           '54处主来源引用加2处R4歧义引用，共56处hash吻合。不提交、不归档。详见' + report + '。')

def save(path, content):
    old = path.read_text()
    target = backup / ('__'.join(path.relative_to(repo).parts))
    assert not target.exists(), f'already backed up: {path.name}'
    shutil.copy2(path, target)
    path.write_text(content)

# PRD: current AC/scope remain visible; prior dates and results are explicitly history.
p = task / 'prd.md'
s = p.read_text().replace('最后核账:2026-10-25', '最后核账:2026-10-26', 1)
a = s.index('## 本轮追加执行授权与当前结果')
b = s.index('## 本轮续做', a)
s = s[:a] + '## 当前执行结果与授权\n\n' + summary + '\n\n用户已批准扩大至生成链路、Git只读核账及唯一入口打包覆盖安装；glm-5.3与最小片段外发按既有授权执行。114次上限已耗尽，不自动追加；凭证不落盘。\n\n' + s[b:]
updates = {
    '- [x] AC1': '- [x] AC1 (R1): 静态九境/终态口径完成，历史RED和234/238回归保留；本轮chain-script-format-regression.log为11文件261项exit0。全仓并行资产错误与本任务结果分账，见当前报告。',
    '- [x] AC3': '- [x] AC3 (R3): fs真实手册→stored-copy→三阶段实际hook请求及严格审核写回/互斥/版本隔离离线测试完成；最后格式门亦在261项回归中。mock和旧R2审核不作真实三阶段通过证据。',
    '- [ ] AC5': '- [ ] AC5 (R4，语义质量门未过): 历史final-v3/fidelity-v6七卡仍有硬门失败；本轮新增15次已用满114/114，v10仅P5剧本模型审核PASS但格式/时长不合格，R3仍增写且审核引用协议无效。最终格式门离线拒绝两稿，没有新的完整三阶段实模通过链；需另获预算后再验。',
    '- [x] AC6': '- [x] AC6 (R4): 历史提交只读核实保留，旧安装不倒推。本轮最终chain-final-build-mac.log exit0；installed smoke/系统启动退出通过，构建/安装asar同为df1092888baa48c391716021a683c9245342b2a3da422dd56d4bfb195801b2e8，五手册全文、七处新标识与七源码hash匹配。见research/chain-final-installed-content-verification.json，realMediaGeneration=false。',
}
lines = s.splitlines()
for i,line in enumerate(lines):
    for prefix,new in updates.items():
        if line.startswith(prefix): lines[i] = new; break
s = '\n'.join(lines) + '\n'
a = s.index('当前授权范围：', s.index('## Scope and Constraints'))
b = s.index('真实模型、最小材料', a)
s = s[:a] + '当前授权范围：原五手册/测试/专用工具/任务工件与母PRD末尾追加，并扩至道劫真实原文改编的七个生产文件及关联测试：daojie-generation-audit.ts、script-planning.ts、manuals.ts、director-plan.ts、storyboard-table.ts与两个阶段动作hook。生产函数保持不变的旧限制已被用户明确覆盖；最终文件/hash/验证局限见当前报告。其他题材、原创、4000默认值、fusion按需及既有软警告行为不改。\n' + s[b:]
s = s.replace('## 2026-10-26 已批准生成链路修复（当前权威范围）', '## 2026-10-26 扩范围批准时的方案快照（范围仍有效，执行结果见页首）')
save(p,s)

# Keep the detailed earlier plans intact while replacing their current-result section.
for name, heading, historical in (
    ('design.md', '## 当前核验结论', '## 本轮追加执行决定'),
    ('implement.md', '## 当前执行结果', '## 本轮追加授权与当时下一切片'),
):
    p = task / name
    s = p.read_text().replace('最后核账:2026-10-25', '最后核账:2026-10-26', 1)
    a,b = s.index(heading), s.index(historical)
    extra = ('\nSpec判断：本轮新增三阶段严格写回与剧本格式/时长契约，已同步.trellis/spec/guides/daojie-manual-code-contract-guide.md；私有设定和单次实验输出保留本task。\n'
             if name == 'design.md' else '\n当前实施七生产文件、关联测试、实模桥与最终安装均见当前报告；模型验收仍未完成。Git写与归档无授权，无在途模型调用；不会因预算用尽补认完成。\n')
    s = s[:a] + '## 当前执行结果（2026-10-26）\n\n' + summary + '\n' + extra + '\n## 以下为1025计划与执行快照（历史，当前范围/结果以上文为准）\n\n' + s[b:]
    s = s.replace('## 交付四标（当前）', '## 1025交付四标（历史）')
    s = s.replace('## 2026-10-26 已批准生成链路修复（当前权威范围）', '## 2026-10-26 扩范围批准时的方案快照（范围仍有效，执行结果见页首）')
    save(p,s)

p = task / 'task.json'
d = json.loads(p.read_text())
assert d['status'] == 'in_progress' and d['completedAt'] is None
d['notes'] = summary + '\n以下为此前notes历史记录，已由以上结果覆盖：' + d['notes']
save(p,json.dumps(d,ensure_ascii=False,indent=2)+'\n')

for name in ('implement.jsonl','check.jsonl'):
    p = task / name
    rows = [json.loads(line) for line in p.read_text().splitlines() if line]
    for file,reason in (
        ('.trellis/spec/guides/daojie-manual-code-contract-guide.md','1026道劫严格改编、三阶段审核写回、时长硬门及版本隔离契约'),
        (str((research/'chain-generation-and-install-review-1026.md').relative_to(repo)),'114调用预算、最终源码/安装收据及全仓/实模开放项；历史记录不补绿'),
    ):
        if not any(row.get('file') == file for row in rows): rows.append({'file':file,'reason':reason})
    save(p,''.join(json.dumps(row,ensure_ascii=False)+'\n' for row in rows))
print('updated PRD/design/implementation/metadata/context; status remains in_progress')
