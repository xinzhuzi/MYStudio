#!/usr/bin/env python3
"""Draw the proposed six-region layout, with placeholders rather than generated art."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'apps/output/automation/daojie-type-docs-charsheet-1016'
FONT = next(p for p in Path('/System/Library/Fonts').iterdir() if p.name == 'STHeiti Medium.ttc')
image = Image.new('RGB', (1600, 1080), '#f5f5f0')
draw = ImageDraw.Draw(image)
font = lambda size: ImageFont.truetype(str(FONT), size)
draw.text((58, 28), '建议：固定六区角色设定卡', fill='#202b31', font=font(38))
draw.text((58, 82), '排版示意，非模型出图；文字和色卡另行后期合成', fill='#56636a', font=font(24))
left, top, right, bottom = 58, 150, 1542, 985
gap = 22
split = left + round((right-left) * .4)
rx = split + gap
rt_bottom = top + round((bottom-top) * .7) - gap//2
rb_top = rt_bottom + gap
rw = right-rx


def panel(box, title, subtitle, color):
    draw.rounded_rectangle(box, radius=12, fill=color, outline='#a4afb2', width=2)
    x0,y0,x1,y1 = box
    for text, yy, sz in [(title,(y0+y1)//2-32,30),(subtitle,(y0+y1)//2+14,23)]:
        f=font(sz);bbox=draw.textbbox((0,0),text,font=f)
        draw.text(((x0+x1-(bbox[2]-bbox[0]))//2,yy),text,font=f,fill='#27383c')

panel((left,top,split,bottom),'1　主视觉全身立绘','左侧约四成宽','#e2ebe6')
for i,(title,sub) in enumerate([('2　正面','完整全身'),('3　纯侧面','朝画面右侧'),('4　背面','完整全身')]):
    x0=rx+round(i*(rw+gap)/3)
    x1=rx+round((i+1)*(rw+gap)/3)-gap
    panel((x0,top,x1,rt_bottom),title,sub,'#e3ebf1')
mid=rx+(rw-gap)//2
panel((rx,rb_top,mid,bottom),'5　面部近景','固定一幅','#eee7d9')
panel((mid+gap,rb_top,right,bottom),'6　连接结构局部','服饰或配器，固定一幅','#eee7d9')
draw.text((58, 1018),'全卡：4 幅全身 + 1 幅面部 + 1 幅局部；三视图等高、等宽并列',font=font(25),fill='#35494e')
OUT.mkdir(parents=True,exist_ok=True)
p=OUT/'layout-proposal.png';image.save(p)
print(p)
