import json, time, urllib.request, sys, datetime
BASE="http://127.0.0.1:17598"
PID=sys.argv[1]
t0=time.time()
while True:
    try:
        with urllib.request.urlopen(f"{BASE}/history/{PID}",timeout=15) as r:
            h=json.load(r)
        if PID in h:
            st=h[PID].get("status",{})
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] DONE status={st.get('status_str')} completed={st.get('completed')}")
            for nid,out in h[PID].get("outputs",{}).items():
                for k,v in (out or {}).items():
                    if isinstance(v,list) and v and isinstance(v[0],dict) and "filename" in v[0]:
                        print(f"  output node {nid}: {[x['filename']+' sub:'+x.get('subfolder','') for x in v]}")
            for m in st.get("messages",[]):
                if m[0]=='execution_error': print("ERROR:",json.dumps(m[1],ensure_ascii=False)[:600])
            break
    except Exception as e:
        print(f"[poll err] {e}",flush=True)
    if time.time()-t0 > 3000: print("TIMEOUT"); break
    time.sleep(20)
