#!/usr/bin/env python3
# 大轮实弹终局汇总(1002):run1 + refire + 四份事后复核 → 逻辑八发终判+发现账。
import json
from pathlib import Path

F = Path("apps/output/biground-1002/fire")
run1 = json.loads((F / "livefire-report.json").read_text())
refire = json.loads((F / "refire-report.json").read_text())
postlog = json.loads((F / "log-fingerprint-posthoc.json").read_text())
posttext = json.loads((F / "pe-text-posthoc.json").read_text())
s5two = json.loads((F / "s5-posthoc-twosegment.json").read_text())["s5_posthoc"]
s6est = json.loads((F / "s6-headbody-estimate.json").read_text())
s6diff = json.loads((F / "s6-pixeldiff.json").read_text())
q4ev = json.loads((F / "q4-compose-evidence.json").read_text())

fail = lambda rep, keys: [x for x in rep["results"] if x["shot"] in keys and not x["pass"]]
S = run1["shots"]

out = []
out.append({
    "name": "①直出九型(人物,pe关,直出40步,seed3001)+懒执行取证(pe关零PE TE)",
    "ok": True,
    "detail": (
        "全绿(11/11 实质检;run1 唯一红=日志 grep 松模式误中排队图回显 JSON,事后精确指纹复核"
        f" pe_t2i 装载指纹=0:{postlog['shots']['s1-t2i-direct-nine']['pe_t2i_load_fingerprint']},"
        "log-fingerprint-posthoc.json)。真采样 1375s/8.2MB;执行级懒文证 6:4013/6:4019 不在执行集;"
        "7:7010 直出支路在执行集;alpha=opaque;最终文本 2185 字含锚句(锚→提示词链路通)。"
        "产物 s1-t2i-direct-nine-seed3001.png"
    ),
})
out.append({
    "name": "②PE九型(人物,pe开默认,FunAcc默认档,seed3002)+PE文证+thinking预览可见文证",
    "ok": False,
    "detail": (
        "PE 核全绿:6:4013 执行+6:4019 装载(storage policy 指纹=1,17947MB)+pe_t2i TE 冷装;"
        "最终文本=PE出文 4678 字 asciiRatio=1.00;[4018].wh_ratio←[4013,2] PE建议画幅;7:7013 FunAcc 支路;"
        "alpha=opaque;336s。红 3 项=附项 thinking 预览可见性【真缺陷】:新预览件 [4020] 子图内死端"
        "被 graphToPrompt 剪枝——PE 开也不入排队图(probe-t2i-peon.json 键集实证)→不执行→history 零文本,"
        "Q5『画布可看 PE 推理』未达成;需迁主图级或子图输出化。产物 s2-t2i-pe-nine-seed3002.png"
    ),
})
out.append({
    "name": "③自由型+透明开(pe开,FunAcc,seed3003)",
    "ok": False,
    "detail": (
        "透明判据红:ratio0=0.4845<0.50 门(差 1.55pp;四角全 0 洁净,真透明带成形但不足半幅)。"
        "两处红为缓存/时序假象已复核:6:4019 不在执行集=PE TE 驻留缓存免执行(s2 已装 17947MB),"
        f"PE 链本体绿(6:4013 执行+终文本 3829 字 asciiRatio={posttext['shots']['s3-t2i-free-alpha']['asciiRatio']} 英文 PE出文,pe-text-posthoc.json);"
        "中性化警告全日志 2 hit=恰两自由型发(s3/s5),stdout 缓冲致窗口错位。"
        "污染因子:[4014] widget 错位使官方头句槽←W1 值(见发现账)——修复后需重验。"
        "产物 s3-t2i-free-alpha-seed3003.png(5.5MB)"
    ),
})
out.append({
    "name": "④道具型跟随(pe关,面板透明=false,seed3004)",
    "ok": False,
    "detail": (
        "跟随链路绿:排队图 [4010].透明覆盖=false(面板未开)而 [4014].透明模式/[4017].switch←[4010 槽3]"
        "(透明值=rgba_default 解析,⑥⑦纯布尔跨边界);懒文证过;最终文本含道具 BASE(尺寸标注设定图)。"
        "透明判据红:corners 94/83/93/156>2 且 ratioAlpha0=0、半透明 61.4%——道具型=尺寸标注设定图"
        "(器物上下引线箭头+标注小字=结构性半透内容),qi21_s6_alpha_check 角洁净+全透占比口径与该型"
        "设计先天失配(同 1002 daotu 剑形门禁失配先例),像素面如实报红,型面判改判据留主会话裁定。"
        "产物 s4-t2i-prop-follow-seed3004.png"
    ),
})
out.append({
    "name": "⑤pe关×透明(Q4 补强:W1 包裹后过 50 门;自由型,seed3005)",
    "ok": False,
    "detail": (
        "Q4 件逻辑文证绿(引擎部署代码实调,q4-compose-evidence.json):pe关×透明路 透明文本逐字=="
        "头句+装配全文+W1收束句+尾句(两路同包 W1);pe关直写路终文本逐字==主体句+锁层A"
        f"(md5 {s5two['finalTextMd5_12']} 逐字匹配,s5-posthoc-twosegment.json;run1 红项=驱动断言把"
        "[6:4011].主体句链接数组字串化,断言构造缺陷非产品红)。透明判据红:出图基本不透明"
        "(corners 224-241,ratioAlpha0=0)——同构 1001 ③态;且 [4014] 错位(头句槽←W1)污染实际入模文本,"
        "50 门未过,修复错位后需重发。产物 s5-t2i-peoff-alpha-seed3005.png"
    ),
})
out.append({
    "name": "⑥㉒头身比对拍(同seed 424242 同主体句,改锚前后各一发,直出40步)",
    "ok": True,
    "detail": (
        "对拍成立:锚臂(BASE 862 字含锚句)终文本 2185 字 hasAnchor=true;基线臂=引擎侧部署副本临时去锚"
        "(run1 改仓库真源零效果全缓存秒回=无效发已标 .INVALID-cached.png 留证;补发改引擎家"
        "custom_nodes/my-nodes/nodes/qi21_bases.json,POST→6:4010 执行→秒恢复+md5 验✓)终文本 2162 字"
        "(=2185-23 恰锚句长)hasAnchor=false,真采样 23min/8.1MB(与锚臂字节不同)。"
        f"程序初裁头身比(s6-headbody-estimate.json,Otsu 剪影行覆盖,绝对值欠准仅看 Δ):锚臂 "
        f"{s6est[0]['head_body_ratio']} vs 基线 {s6est[1]['head_body_ratio']}(Δ-0.29 在方法噪声内,"
        "单 seed 未见可测改善);像素差 mean 5.75/255、18.9% 像素>10(锚句对渲染中度扰动,构图同源"
        "crown/feet 同位)。并排图 s6-headbody-sidebyside.png(左=有锚/右=去锚+8 分格);"
        "人眼终审留用户;prd ㉒自带注记『比例无锚=逐图随机飘』——单对比拍不显效≠锚无效,"
        "方差验证需多种子轮。产物 s6-anchored/baseline-seed424242.png 两臂"
    ),
})
out.append({
    "name": "⑦i2i 直出(兼容;人物,PE关,RGBA透明=跟随型,FunAcc,seed3007)",
    "ok": True,
    "detail": (
        "全绿(7/7 实质检;run1 唯一红=日志松模式误中回显,事后指纹 pe_i2i 装载指纹=0,"
        "log-fingerprint-posthoc.json):迁移后 i2i 拓扑跑新共享件绿——[180] 旧三态件在排队图且执行,"
        "6:4011 装配器执行,终文本 2143 字含人物 BASE+锚句;执行级懒文证 6:4013(TextGenerate)/"
        "6:4019(pe_i2i TE)不在执行集;alpha=opaque;127s。兼容判定成立。"
        "产物 s7-i2i-direct-seed3007.png(3.2MB)"
    ),
})
edit_direct = json.loads((F / "alpha-s8-edit-direct40-seed3011.json").read_text()) if (F / "alpha-s8-edit-direct40-seed3011.json").exists() else None
out.append({
    "name": "⑧edit 改图(兼容;官方换装样例,PE关指令直写)",
    "ok": False,
    "detail": (
        "红(结构性):默认档 FunAcc 两独立 seed(3008/3009)均出全透空白图(alphaMax=0,1.58M 像素全透,"
        "33KB;status=success 无异常=静默坏图;同 seed 重发被节点缓存秒回 0.01s 无法原样重跑,实录在案)。"
        "定位发(edit×viggle seed3010):绿——opaque 4.0MB 真图(alphaMin=252)→空白=FunAcc×edit 支路专属"
        "(t2i FunAcc 四发全绿,edit viggle 绿,edit FunAcc 两 seed 白)非 edit 拓扑全局;"
        f"edit×直出40步 seed3011:{('绿 ' + edit_direct['verdict']) if edit_direct and edit_direct.get('pass') else ('红 ' + (edit_direct or {}).get('verdict', '(运行中/未见))'))}"
        "。兼容面:PE关直写路+6:4014 合成器执行绿;⑱『i2i/edit 默认档同改 FunAcc』对 edit 为危险默认"
        "(用户按默认排队即得空白),修法留主会话(FunAcc×edit 根修或 edit 默认档回退)。"
        "产物 s8-edit-outfit-seed3008/3009.png(空白对)+ s8-edit-viggle-seed3010.png(绿)"
    ),
})

findings = [
    "F1【缺陷·[4014]系 widget 序列化错位】大轮手术后三件工作流 MyQi21PromptSelect 节点 widgets_values 装载错位:"
    "RGBA官方头句槽←W1收束句值(官方头句『This is an RGBA format image with transparency.』丢失),"
    "i2i [153] 更有 pe开关←头句串/PE出文←false(透明支路一旦执行将错路);probe2-widgetmap.json 三连装载确定性复现;"
    "污染③⑤实弹入模文本,静态门(pytest/蓝图对拍)未拦=装载期行为,需修 widgets_values 序并重验透明三发",
    "F2【缺陷·Q5 thinking 预览不可见】[4020] PE思考·showAnything 为子图内死端显示节点,graphToPrompt 剪枝"
    "(PE 开也不入排队图,probe-t2i-peon.json)→永不执行画布无文;②的三红=此缺陷实证;修法=迁主图级或子图输出化",
    "F3【缺陷·edit×FunAcc 全透空白】见⑧;两 seed 复现,viggle 支路绿定位;⑱ 的 edit 默认档=用户即触空白",
    "F4【判据失配候选·道具型透明门】④:尺寸标注设定图=结构性半透+角域标注内容,qi21_s6_alpha_check 角洁净/"
    "全透占比口径与型设计失配(1002 daotu 先例同款),如实报红留裁定",
    "F5【工具教训·引擎执行读引擎家部署副本】改仓库真源 qi21_bases.json 对在跑引擎零效果(mtime 热读的是"
    "custom_nodes/my-nodes/nodes/qi21_bases.json);⑥基线臂补发已按引擎侧操作+秒恢复+md5 验",
    "F6【缓存行为】引擎节点缓存持执行成功的坏图(空白 edit 同 seed 重发=0.01s 秒回);PE TE 二发驻留缓存"
    "(6:4019 不再进执行集,装载指纹仅首发存在)——实弹判据的执行集/日志两项都要按此口径读",
]
final = {
    "task": "10-01-qi21-usetest-batch implement.md 步骤9 实弹八发(大轮术后)",
    "baseline": "git 工作区现态(用户手改后 t2i 禁打回);引擎=~/Library/Application Support/漫影工作室/comfyui 17599",
    "driver": "S8/S5 驱动器形态:loadGraphData 零注入→宿主 widget set+onWidgetChanged→graphToPrompt→POST /prompt→WS 执行取证→/history 取图取文→qi21_s6_alpha_check 校准口径",
    "artifacts": "apps/output/biground-1002/fire/(livefire-report.json/run1+refire-report.json/补发+四份事后复核+逐发 PNG+alpha-*.json+s6 并排图)",
    "shots": out,
    "findings": findings,
}
(F / "final-summary.json").write_text(json.dumps(final, ensure_ascii=False, indent=1))
print(json.dumps(final, ensure_ascii=False, indent=1)[:600])
print("... written final-summary.json")
