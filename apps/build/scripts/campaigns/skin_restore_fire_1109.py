#!/usr/bin/env python3
"""1109 t2i-皮肤-超分 实弹验证(装机版)。"""
from __future__ import annotations
import importlib.util, json, sys, time, urllib.parse, urllib.request
from pathlib import Path
REPO = Path(__file__).resolve().parents[3]
RUNNER = REPO / "apps/build/scripts/arekejoker_posestudio_cdp_1108.py"
OUT = REPO / ".zcode/tmp/posestudio-1108"
PREFIX = "skinrestore1109"
CHAR = "daojie_nvxiu_mounted_1108.png"
DEADLINE = 600

spec = importlib.util.spec_from_file_location("ps", RUNNER)
ps = importlib.util.module_from_spec(spec); spec.loader.exec_module(ps)
# 引擎 input 上的装机版图(不从仓侧取,确保测的是装机实物)
WF_TEXT = None

def main() -> int:
    for _ in range(24):
        r,p=ps.queue_load()
        if r==0 and p==0: break
        time.sleep(20)
    else:
        print("SKIN_VERDICT {\"status\":\"busy\"}"); return 3
    # 从引擎 API 拿工作流?不行——侧栏树扫描的图不在 API 里。直接从 Mac 仓侧读(装机=同 commit)。
    wf_path = REPO / "apps/backend/comfyui/workflows/1_图片/Q2-1图像/1_文生图/t2i-皮肤-超分.json"
    wf = json.loads(wf_path.read_text(encoding="utf-8"))
    for n in wf["nodes"]:
        if n["type"]=="LoadImage" and n.get("widgets_values"):
            n["widgets_values"][0]=CHAR
        if n["type"]=="SaveImage" and n.get("widgets_values"):
            n["widgets_values"][0]=f"{PREFIX}/out"
    page,procs=ps.acquire_page()
    t0=time.monotonic()
    try:
        page.goto(ps.ENGINE+"/",timeout=45); ps.wait_app(page,90)
        page.evaluate(ps.js_call("(a)=>window.app.loadGraphData(a)",wf)); ps.settle(page,2500)
        info=page.evaluate("(()=>{const g=window.app.graph._nodes;return {nodes:g.length};})()")
        print(f"[loaded] {json.dumps(info)}",flush=True)
        page.evaluate("(()=>window.app.queuePrompt())()")
        pid=ps.find_pid_by_prefix(PREFIX)
        if not pid:
            print('SKIN_VERDICT {"status":"error","reason":"pid未发现"}'); return 1
        res=ps.wait_history(pid,DEADLINE)
        secs=round(time.monotonic()-t0,1)
        files=[]
        if res["status_str"]=="success":
            for img in res["images"]:
                q=urllib.parse.urlencode({"filename":img["filename"],
                    "subfolder":img.get("subfolder",""),"type":img.get("type","output")})
                b=urllib.request.urlopen(f"{ps.ENGINE}/view?{q}",timeout=120).read()
                fp=OUT/f"skin_{img['filename']}"; fp.write_bytes(b); files.append(str(fp))
                import struct
                w,h=struct.unpack(">II",b[16:24])
                print(f"  产物 {img['filename']}: {w}×{h} {len(b)//1024}KB",flush=True)
        print(f"SKIN_VERDICT {json.dumps({'status':res['status_str'],'seconds':secs,'files':files,'reason':res.get('reason','')},ensure_ascii=False)}")
        return 0 if res["status_str"]=="success" else 1
    finally:
        for p in procs:
            try: p.terminate()
            except: pass

if __name__=="__main__": sys.exit(main())
