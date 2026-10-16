#!/usr/bin/env python3
"""Assemble a labeled contact sheet and review index from inspected receipts."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import flux3_daojie_workflow as w

if __name__=='__main__':
    rows=[json.loads(p.read_text()) for p in sorted((w.TASK/'artifacts').glob('*/receipt.json'))]
    assert len(rows)==10 and all(r['visual_status']!='pending' and r['visual_notes'] for r in rows)
    sheet=Image.new('RGB',(2000,1040),'#e6e1d5');draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('/System/Library/Fonts/STHeiti Light.ttc',24)
    for i,r in enumerate(rows):
        x=(i%5)*400;y=(i//5)*520
        folder=w.TASK/'artifacts'/f"{r['index']:02d}"
        im=Image.open(folder/'image.png');im.thumbnail((380,450))
        sheet.paste(im,(x+(400-im.width)//2,y+42+(450-im.height)//2))
        draw.text((x+12,y+8),f"{r['index']:02d} {r['type']}",font=font,fill='#272d32')
        draw.text((x+12,y+491),'生成成功 · '+('型格通过' if r['visual_status']=='pass' else '存在视觉偏差'),font=font,fill='#272d32')
    sheet.save(w.TASK/'artifacts/contact-sheet.png',optimize=True)
    sheet.thumbnail((768,768));sheet.save(w.TASK/'artifacts/contact-sheet_thumb.png',optimize=True)
    assert (w.TASK/'artifacts/contact-sheet_thumb.png').stat().st_size<1000000
    out=['# Windows FLUX.3 道劫十型 RGB 实测','', '十型全部生成成功：指定9B扩写、对应history success、PNG/hash/尺寸逐件核验通过。视觉质量分开评价：1型型格通过，9型存在已记录偏差；GUI现场打开未验证。', '', '![十型总览](artifacts/contact-sheet.png)','', '|序|类型|实际尺寸|生成|视觉记录|产物与完整提示词|','|---|---|---|---|---|---|']
    for r in rows:
        n=f"{r['index']:02d}"
        out.append(f"|{n}|{r['type']}|{r['width']}×{r['height']}|成功|{'型格通过' if r['visual_status']=='pass' else '存在偏差'}|[原图](artifacts/{n}/image.png) · [收据/完整提示词](artifacts/{n}/receipt.json)|")
    out+=['','## 逐型观察与问题','']
    for r in rows:
        out += [f"### {r['index']:02d} {r['type']}", '',*['- '+note for note in r['visual_notes']], '',f"render prompt_id: `{r['prompt_id']}`；PE prompt_id: `{r['pe_prompt_id']}`。",'']
    out += ['## 文件与验证','', 'Windows 原图：`E:\\IP\\漫影工作室\\comfyui\\output\\flux3\\ten-types-1016\\`。Windows完整收据：`E:\\IP\\flux3-ten-types-1016\\01…10\\`。', '', '工作流：`apps/backend/engines/comfyui/workflows/1_图片/Flux3图像/flux3-道劫-t2i.json`；Windows repo/App resources已部署。', '', '[机器验收](reports/final-verification.json) · [Windows复核](reports/windows-final-verification.json) · [测试与限制](reports/final-review.md) · [原会话漏项审计](research/session-audit.md)', '', '原会话的“全部完成”仅覆盖旧战役；十型已被明确下令，却被助手重新当作等待发车的后续事项，未形成执行收据。本任务补齐该漏项。', '', '不包含抠图或原生透明；CFG1不承诺负向额外抑制。未执行Git、打包或归档。']
    (w.TASK/'RESULTS.md').write_text('\n'.join(out)+'\n')
    print(json.dumps({'count':len(rows),'sheet':str(w.TASK/'artifacts/contact-sheet.png'),'index':str(w.TASK/'RESULTS.md')},ensure_ascii=False))
