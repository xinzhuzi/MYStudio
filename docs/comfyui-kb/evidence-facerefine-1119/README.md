# 铁证备份:1119 双档修脸(facerefine dualmode)清账

- **生成日期**:2026-11-19(1119 当日产出,当日入仓备份)
- **来源目录**:`apps/output/h3-face-refine-survey-1118/fusion/`(autopsy / grill 两件 md)与其 `dualmode/` 子目录(其余 11 件),`cp -p` 原样拷贝保时戳;原件仍在原位未动
- **主题**:H3 双档修脸实弹验证——远景档(5111=False→5023)/高清档(5111=True→5025),含 97 节点 danjing 轮、fire_final 全 93 轮、93 终版校正轮(far93/hd93)三代铁证
- **视频大件见仓外备份**:`~/Backups/myStudio-evidence-1119/`(far93.mp4 25,122,785 B / hd93.mp4 25,129,143 B,各约 25MB,禁入 git,已 cmp 字节级核对一致)

## 文件清单(13 件)

| 文件 | 用途(一句话) |
|---|---|
| `autopsy-1119.md` | 验尸结论:H3FaceStitch.masks 悬空=face_only 正典行为等三条源码级定论+A2 轮数据缺陷(跨生成代理帧)更正记录 |
| `grill-report-1119.md` | 11-19 双档 PRD V1 拷问报告,17 条质询全录(供 PRD 修订吸收) |
| `compare.md` | 真源同帧四路终对比(源/A2 正典/远景档/高清档)量化主表+路由定谳:hd≈源因 5024 masks 分支空贴、far 是唯一真改脸臂 |
| `run-compare.md` | 「从远景跑过来」两档修脸全程对比记录(6 帧位×3 态、脸区定位三源交叉验证、脸区 Laplacian 锐度表) |
| `final-report.json` | fire_final 轮三环量化:far/hd 对源生效量、档位差脸区集中度、同 seed 跨跑漂移 20-21dB 定界 |
| `fire_dualmode_1119.py` | 97 节点 danjing.json 四采段双档实弹发车器(far/hd/hd2=V2.1 替身线,hd2 修 masks 空贴) |
| `fire_93dual_1119.py` | 93 终版单镜.json 四采段校正轮发车器(far93/hd93,seed 42,verify_93 对正典件逐位核验) |
| `metrics.py` | 双视频帧级量化基建:脸区 Laplacian 锐度+对源 RMSE/PSNR(口径铁律:禁跨生成代理帧) |
| `run-compare.jpg` | 6 帧位×3 行(源/远景档/高清档)总对比大图,远景小脸→近景特写全程 |
| `strip-final-far.jpg` | fire_final 轮远景档条带(p3 脸区|终片脸区|p3 4x|终片 4x 四联) |
| `strip-final-hd.jpg` | fire_final 轮高清档条带(同上四联) |
| `strip93-f16.jpg` | 93 校正轮 f16(推近前远景脸)各态条带,视觉判读用 |
| `strip93-f112.jpg` | 93 校正轮 f112(推近后特写)各态条带,视觉判读用 |

## 未拷记录(清账)

- 清单外曾列 `apps/output/视频分析.md`(`fusion/../../视频分析.md`):**查无此件**(全仓 find 无果),按「存在者拷入」规则跳过。
- 视频与大体量中间件(far93/hd93/final-*/src_4k_p3.mp4、object_info_17000.json 等)不入仓:核心两件已备份至上述仓外目录,余者留 `apps/output` 原位。
