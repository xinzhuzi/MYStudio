import re, subprocess, sys, statistics

p = sys.argv[1]

def run(vf):
    return subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", p, "-vf", vf, "-f", "null", "-"],
                          capture_output=True, text=True).stderr

def meta(text, key):
    return [float(v) for v in re.findall(rf"{key}[=:]([0-9.eE+-]+)", text)]

d = run("scdet,metadata=print")
score = meta(d, r"lavfi\.scd\.score")
print(f"scdet    n={len(score)} max={max(score):.1f} cuts>=8:{sum(1 for s in score if s>=8)} soft>=4:{sum(1 for s in score if s>=4)}")

t = run("siti,metadata=print")
ti, si = meta(t, r"lavfi\.siti\.ti"), meta(t, r"lavfi\.siti\.si")
ti_m = ti[1:] if len(ti) > 1 else ti
still = sum(1 for x in ti_m if x < 0.5) / len(ti_m)
print(f"siti     TI mean={statistics.mean(ti_m):.2f} p95={sorted(ti_m)[int(len(ti_m)*0.95)]:.2f} max={max(ti_m):.2f} 静止帧占比(TI<0.5)={still*100:.1f}% | SI mean={statistics.mean(si):.1f}")

b = run("blurdetect")
bm = re.search(r"blur mean:\s*([0-9.]+)", b)
print(f"blur     mean={bm.group(1) if bm else 'NA'}")

g = run("signalstats,metadata=print")
y, s = meta(g, r"YAVG"), meta(g, r"SATAVG")
print(f"exposure YAVG min={min(y):.1f} max={max(y):.1f} mean={statistics.mean(y):.1f} | SATAVG max={max(s):.1f}")

f = run("freezedetect=n=6:d=0.5")
print(f"freeze   segs={len(re.findall(r'freeze_start', f))}")
print(f"black    segs={len(re.findall(r'black_start', run('blackdetect=d=0.05:pix_th=0.10')))}")

a = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", p, "-af", "ebur128=metadata=1", "-f", "null", "-"],
                   capture_output=True, text=True).stderr
i, tp = re.search(r"\n\s*I:\s*(-?[0-9.]+) LUFS", a), re.search(r"\n\s*Peak:\s*(-?[0-9.]+) dBTP", a)
print(f"audio    I={i.group(1) if i else 'NA'} LUFS TP={tp.group(1) if tp else 'NA'} dBTP silence_segs={len(re.findall(r'silence_start', run('silencedetect=n=-35dB:d=0.8')))}")

try:
    from scenedetect import detect, ContentDetector
    sc = detect(p, ContentDetector(threshold=27.0))
    print(f"scenedetect thr=27 -> 场景数={len(sc)} 区间={[(round(x[0].get_seconds(),2), round(x[1].get_seconds(),2)) for x in sc][:4]}")
except Exception as e:
    print("scenedetect FAIL", type(e).__name__, e)
