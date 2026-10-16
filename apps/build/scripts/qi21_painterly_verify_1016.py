"""Verify the exact style-only rollout and both real generation histories."""
from pathlib import Path
import copy,hashlib,importlib.util,json
from PIL import Image,ImageDraw,ImageFont,ImageChops,ImageStat
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'apps/output/automation/qi21-painterly-ab-1016'
MANUAL=ROOT/'apps/frontend/assets/studio-manuals/art_skills/daojie_ink_guofeng'
sha=lambda b:hashlib.sha256(b).hexdigest()
dump=lambda p,d:p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
exp=json.loads((OUT/'experiment.json').read_text());old,new=exp['old_style'],exp['new_style']
ledger=json.loads((OUT/'migration-changes.json').read_text());checks=[]
for row in ledger:
 p=Path(row['path']);b=Path(row['backup']).read_bytes();a=p.read_bytes()
 assert sha(b)==row['before'],p
 assert sha(a)==row['after'],p
 t=b.decode()
 for x,y,n in row['replacements']:
  assert t.count(x)==n,(p,x)
  t=t.replace(x,y)
 assert t.encode()==a,p
 if p.suffix=='.json':
  bd,ad=json.loads(b),json.loads(a)
  if p.name=='qi21_bases.json':
   for k in bd:
    if k not in ('art_style_base','layer_contract'):assert bd[k]==ad[k],(p,k)
   assert bd['art_style_base']['negative_text']==ad['art_style_base']['negative_text']
   assert ad['art_style_base']['positive_text']==new
  elif p.name=='lock-anchors.json':
   assert [r['maAnchors'] for r in bd['locks']]==[r['maAnchors'] for r in ad['locks']]
  elif p.name=='runtime-contract.json':
   assert ad['modules']['style.gongbi-base']['text']==new
   assert ad['localRevision']['styleSourceSha256']==sha((MANUAL/'json/qi21_bases.json').read_bytes())
   assert ad['contractSha256']==sha(json.dumps({k:v for k,v in ad.items() if k!='contractSha256'},ensure_ascii=False,sort_keys=True,separators=(',',':')).encode())
  elif 'nodes' in bd:assert a.decode().replace(new,old)==b.decode(),p
 checks.append({'path':str(p),'exact_replacements_verified':True})
# Previously audited 54 documents plus current complete style manual and production snapshots.
prior=json.loads((ROOT/'apps/output/automation/qi21-color-hierarchy-1016/document-coverage-full.json').read_text())
paths={Path(r['path']) for r in prior}
paths.update(MANUAL.rglob('*.md'));paths.update(MANUAL.rglob('*.json'))
paths.update(p for p in (ROOT/'apps/backend/engines/comfyui/workflows').glob('1_*/Q2-1*/**/*.json'))
paths.update((ROOT/'apps/backend/engines/comfyui/my_nodes/subgraphs').glob('qi21-*.json'))
coverage=[]
for p in sorted(paths):
 t=p.read_text();assert old not in t,('stale style',p)
 coverage.append({'path':str(p),'sha256':sha(p.read_bytes()),'old_style_count':0,'new_style_count':t.count(new)})
for w in ['背景','光照','时段','血痕','尘土','身体状态','近景','远景','构图','留白']:assert w not in new,w
for w in ['白描式线条主导形体结构','轮廓线与内部结构线共同承担造型','明暗融入设色层次','丰富多彩','协调统一','主色统领','辅色呼应','点睛色突出']:assert w in new,w
node_path=ROOT/'apps/backend/engines/comfyui/my_nodes/nodes/my_qi21_bases_text.py'
spec=importlib.util.spec_from_file_location('painterly_style_probe',node_path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
node=module.MyQi21美术风格底座();default=node.INPUT_TYPES()['optional']['美术风格'][1]['default'];r=node.output()
assert default==new and r['result'][0]==new and new in json.dumps(r['ui'],ensure_ascii=False)
dump(OUT/'ui-node-probe.json',{'source':str(module._BASES_JSON),'default_equal':True,'output_equal':True,'ui':r['ui']})
images={};graphs={};jobs=[]
for arm in ['A_old','B_new']:
 g=json.loads((OUT/(arm+'.api.json')).read_text());h=json.loads((OUT/(arm+'.history.json')).read_text())
 assert h['status']['status_str']=='success' and h['prompt'][2]==g
 assert g['4015']['inputs']['prompt']==(OUT/(arm+'.positive.txt')).read_text().rstrip('\n')
 im=Image.open(OUT/(arm+'.png')).convert('RGB');assert im.size==(exp['width'],exp['height'])
 images[arm]=im;graphs[arm]=copy.deepcopy(g)
 graphs[arm]['4015']['inputs'].pop('prompt');graphs[arm]['8']['inputs'].pop('filename_prefix')
 jobs.append({'arm':arm,'prompt_id':h['prompt'][1],'status':'success','image_sha256':sha((OUT/(arm+'.png')).read_bytes())})
assert graphs['A_old']==graphs['B_new']
a=json.loads((OUT/'A_old.api.json').read_text())['4015']['inputs']['prompt']
b=json.loads((OUT/'B_new.api.json').read_text())['4015']['inputs']['prompt']
assert a.replace(old,new)==b
font_path=Path('/Library/Fonts/Arial Unicode.ttf');assert font_path.exists()
font=ImageFont.truetype(str(font_path),29);small=ImageFont.truetype(str(font_path),21)
canvas=Image.new('RGB',(1664,1180),'#f4f1ea');draw=ImageDraw.Draw(canvas)
for i,(arm,title) in enumerate([('A_old','旧底座：画风融合描述'),('B_new','新底座：线描造型＋设色塑形')]):
 x=16+i*832;draw.text((x+10,12),title,font=font,fill='#202020')
 canvas.paste(images[arm].resize((816,1080),Image.Resampling.LANCZOS),(x,58))
draw.text((26,1144),'相同主体、类型与生成参数｜seed 0｜1088×1440｜Turbo 8 步',font=small,fill='#404040')
canvas.save(OUT/'comparison.png')
# Identical coordinates and display size on both sides, no enhancement.
crops=[('面部与线条',(420,90,710,360)),('衣料与设色',(400,380,760,720)),('山石与云海',(740,260,1088,820))]
detail=Image.new('RGB',(1040,1350),'#f4f1ea');d=ImageDraw.Draw(detail)
d.text((30,10),'旧底座',font=font,fill='#202020');d.text((550,10),'新底座',font=font,fill='#202020')
for j,(label,box) in enumerate(crops):
 y=55+j*430;d.text((30,y),label,font=small,fill='#404040')
 for i,arm in enumerate(['A_old','B_new']):
  im=images[arm].crop(box);im.thumbnail((480,380),Image.Resampling.LANCZOS);detail.paste(im,(20+i*520+(480-im.width)//2,y+34))
detail.save(OUT/'comparison-details.png')
reference=Image.open(OUT/'original-reference.png').convert('RGB')
stats={'old_new_rgb_mean_absolute_difference':ImageStat.Stat(ImageChops.difference(images['A_old'],images['B_new'])).mean,'original_and_old_replay_pixels_identical':ImageChops.difference(reference,images['A_old']).getbbox() is None}
report={'ok':True,'changed_files':len(checks),'documents_in_previous_full_scope':len(prior),'current_scanned_files':len(coverage),'old_style_remaining':0,'node_ui_verified':True,'jobs':jobs,'controls_identical_except_style':True,'pixel_diagnostic_only':stats,'checks':checks}
dump(OUT/'verification.json',report);dump(OUT/'document-coverage.json',coverage)
print(json.dumps({k:v for k,v in report.items() if k!='checks'},ensure_ascii=False,indent=2))
