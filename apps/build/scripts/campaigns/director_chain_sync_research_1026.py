"""Update current research pointers and append to the archived PRD, without changing history."""
from pathlib import Path
import json
import shutil
repo=Path(__file__).resolve().parents[3]
task=repo/'.trellis/tasks/10-25-daojie-director-rule-conflict-validation'
r=task/'research'
backup=task/'backups/chain-1026/document-sync'
summary=('1026当前：已按用户批准扩大至生产生成链路并补剧本格式/时长门。'
         '定点11文件261项、七文件lint与当次typecheck通过；随后全仓测试6文件失败、全量lint资产弹窗解析失败，聚合门因旧审批文件缺失停止。'
         '最终唯一入口覆盖安装exit0、installed smoke/系统启动退出通过，当前asar为df1092888baa48c391716021a683c9245342b2a3da422dd56d4bfb195801b2e8。'
         '累计114/114调用，无新增完整三阶段实模通过链；R3仍有增写，P5模型PASS不覆盖格式/时长，最终离线门拒绝两稿，AC5开放。'
         '完整结果与局限见chain-generation-and-install-review-1026.md。')
def save(p,s):
 b=backup/('__'.join(p.relative_to(repo).parts))
 assert not b.exists()
 shutil.copy2(p,b)
 p.write_text(s)

p=r/'current-model-protocol.md'
s=p.read_text()
a=s.index('\n- 沿用原19卡规格')
s='# 1026 当前模型协议与证据版本\n\n'+summary+'\n\n当前已耗尽114次，不自动重试/追加。最后15次=6生成+9审核，1模型PASS、8拒绝，其中2引用协议无效。最后补修格式门未再调用实模，离线回放不计模型通过。当前材料为54处主引用＋2处R4歧义引用，共56处，来源hash均核实。新预算须用户另行明确批准。\n\n## 以下为1025批次协议快照（历史，调用计数与生产范围以上文为准）\n'+s[a:]
s=s.replace('早期临时统计56已纠正，', '该54口径不包含R4两处歧义引用；当前load_sources核算为56处，')
save(p,s)

p=r/'next-scope-proposal.md'
s=p.read_text().replace('状态：提案，尚未修改生产函数。复用当前task，不新建、不归档、不追加API预算。','状态：用户已批准扩大生成链路，已实施并安装；'+summary+'\n\n## 以下为批准前提案（历史，非当前待答问题）',1)
s=s.replace('## 2026-10-26 已批准生成链路修复（当前权威范围）','## 2026-10-26 批准时的方案快照（范围有效，执行结果见页首）')
save(p,s)

p=r/'resume-verification.md'
s=p.read_text().replace('最后核账:2026-10-25','最后核账:2026-10-26',1)
a=s.index('## 当前最新收据')
b=s.index('## 较早追加收据',a)
s=s[:a]+'## 当前最新收据（2026-10-26最终包）\n\n'+summary+'\n\n当前收据为chain-final-installed-content-verification.json、chain-final-installed-smoke-report.json、chain-current-evidence-audit.json、chain-final-offline-script-replay.json。五手册全文/七标识/七生产源码hash匹配，realMediaGeneration=false。261项定点与typecheck为04:14运行；04:19全仓受并行资产改动影响，不能称整个当前工作树全通过。此前99调用、238测试和format-v7收据均为历史。\n\n'+s[b:]
save(p,s)

p=r/'verification.md'
s=p.read_text().replace('最后核账:2026-10-25','最后核账:2026-10-26',1)
a=s.index('## 当前结论')
b=s.index('## 以下为首轮离线',a)
current='''## 当前结论（2026-10-26）

'''+summary+'''

| 腿 | 当前实际证据 | 判定 | 剩余边界 |
|---|---|---|---|
| 历史提交 | de2b7dec存在且6文件范围核实 | 只读核账完成 | 不归因本轮修复 |
| 历史安装 | 保留原PRD/旧收据 | 不追认完整旧链 | 当前安装不倒推历史 |
| 静态/质量 | 04:14定点261项、定点lint/typecheck通过；04:19全量6文件失败、全量lint解析失败，聚合Python缺旧文件 | 任务切片通过，全仓门未过 | 并行资产在途修改，不覆盖其文件 |
| 请求/写回 | 三阶段实际builder/hook的mock测试、严格协议与时长门、版本隔离 | 离线完成 | 不是安装App真实模型生成链 |
| 模型 | 累计114；本轮15次，9审核仅1模型PASS；R3增写，P5格式/时长失败 | AC5开放 | 无新完整三阶段实模通过链；12设定探针不作剧情通过 |
| 当前安装 | chain-final-build-mac.log exit0；最终内容/installed smoke收据均ok=true | AC6当前版本完成 | realMediaGeneration=false |

来源重新核验为54主引用+2歧义引用=56处；当前源码hash以chain-final-production-source-hashes.json为准。任务仍in_progress，不提交、不归档。

'''
s=s[:a]+current+s[b:]
save(p,s)

mother=repo/'.trellis/tasks/archive/2026-10/10-25-daojie-story-skill-canon-alignment/prd.md'
old=mother.read_text()
addition='\n\n### 1026承接任务追加结果（历史条目不改）\n\n用户已批准“扩大到生成链路，继续修复”；此前生产函数保持不变限制已覆盖，仍仅承接任务范围、不新建、不Git写、不归档。'+summary+'\n完整报告位于 `.trellis/tasks/10-25-daojie-director-rule-conflict-validation/research/chain-generation-and-install-review-1026.md`。本追加仅同步当前授权/结果，不移动本母档、不修改历史checkbox/completed metadata，不把证据齐全或装机smoke当成模型质量通过。\n'
save(mother,old+addition)
assert mother.read_text().startswith(old)

for name,code in {
 'chain-script-format-red':1,'chain-script-format-green':1,'chain-script-format-regression':0,
 'chain-script-format-typecheck':0,'chain-script-format-lint':0,'chain-final-build-mac':0,
 'chain-final-quality-gate':1,'chain-final-full-vitest':1,'chain-final-full-lint':1,
}.items():
 p=r/(name+'.exit')
 assert not p.exists()
 p.write_text(str(code)+'\n')
print('research and archived PRD append synchronized; no task status or history checkboxes changed')
