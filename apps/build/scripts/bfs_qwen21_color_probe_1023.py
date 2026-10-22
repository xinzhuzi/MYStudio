"""Read-only CPU probe for the BFS colour chain; writes task research only."""
import ast
from enum import Enum
from fractions import Fraction
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
TASK = ROOT / '.trellis/tasks/10-22-bfs-qwen21-color-diagnosis'
HOME_DIR = Path('/Users/zhengbingjin/Project/IP/漫影工作室/comfyui')
CORE = HOME_DIR / 'ComfyUI'
sys.path.insert(0, str(CORE))
sys.argv = [sys.argv[0], '--cpu']
import av
import numpy as np
from PIL import Image
import torch
from comfy_api.latest._input_impl.video_types import VideoFromFile

torch.set_num_threads(2)
research = TASK / 'research'
trial = Path(subprocess.check_output(['fd', '-a', '-t', 'd', 'trial_', str(ROOT / 'apps/output'), '--no-ignore'], text=True).strip())
files = list(trial.iterdir())
body = next(p for p in files if p.name.endswith('v1_原版.png'))
head = next(p for p in files if p.name.startswith('参考_'))
result = next(p for p in files if p.name.endswith('v2.png'))
report = {'source_files': {}, 'input_decode': {}, 'limitations': ['CPU probe of current node source, not a new diffusion render.', 'Reference colour influence and BFS LoRA causality require controlled generation.']}
for path in [body, head, result]:
    im = Image.open(path)
    report['source_files'][path.name] = {'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'size': list(im.size), 'mode': im.mode}
    if path != result:
        components = VideoFromFile(str(path)).get_components()
        pixels = components.images[0]
        expected = np.asarray(im.convert('RGB'))
        error = np.abs(pixels.numpy() * 255.0 - expected).max()
        item = {'image_shape': list(components.images.shape), 'alpha_shape': None if components.alpha is None else list(components.alpha.shape), 'rgb_decode_max_error_255': float(error)}
        if components.alpha is not None:
            alpha = components.alpha[0, ..., 0]
            transparent = alpha == 0
            item['fully_transparent_fraction'] = float(transparent.float().mean())
            item['transparent_rgb_mean_255'] = (pixels[transparent].mean(dim=0) * 255.0).tolist()
        report['input_decode'][path.name] = item
prompt = json.loads(Image.open(result).info['prompt'])
(research / 'v2.actual-api.json').write_text(json.dumps(prompt, ensure_ascii=False, indent=2) + '\n')
report['actual_sampler'] = prompt['490']['inputs']
report['actual_lora'] = prompt['493']['inputs']
lora = HOME_DIR / 'models/loras' / prompt['493']['inputs']['lora_name']
with lora.open('rb') as stream:
    length = struct.unpack('<Q', stream.read(8))[0]
    report['lora_metadata'] = json.loads(stream.read(length)).get('__metadata__', {})
namespace = {'torch': torch, 'np': np, 'av': av, 'Enum': Enum, 'Fraction': Fraction}
for relative, names in [('comfy_extras/nodes_compositing.py', {'PorterDuffMode', 'porter_duff_composite'}), ('comfy_extras/nodes_images.py', {'_FORMAT_SPECS', '_encode_image'})]:
    path = CORE / relative
    tree = ast.parse(path.read_text())
    selected = []
    for node in tree.body:
        if getattr(node, 'name', None) in names or (isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id in names for t in node.targets)):
            selected.append(node)
    assert len(selected) == len(names), relative
    exec(compile(ast.Module(body=selected, type_ignores=[]), str(path), 'exec'), namespace)
    report.setdefault('node_sources', {})[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
rng = np.random.default_rng(42)
rgba = rng.random((32, 32, 4), dtype=np.float32)
rgba[0, :, 3] = 0
rgba[1, :, 3] = 1
samples = torch.from_numpy(rgba)
mask = 1 - samples[..., 3:4]
threshold = (mask > .996).float()
washed, _ = namespace['porter_duff_composite'](samples[..., :3], threshold, samples[..., :3], torch.zeros_like(mask), namespace['PorterDuffMode'].SRC)
keep = samples[..., 3] >= .004
preserved = float(torch.abs(washed[keep] - samples[..., :3][keep]).max())
joined = torch.cat((washed, samples[..., 3:4]), dim=-1)
encoded = namespace['_encode_image'](joined, 'png', '8-bit', 'sRGB')
decoded = np.asarray(Image.open(io.BytesIO(encoded))).astype(np.float32)
quantized = np.clip(joined.numpy() * 255, 0, 255).astype(np.uint8)
save_error = float(np.abs(decoded - quantized).max())
report['postprocess_probe'] = {'pixels_tested': 1024, 'visible_rgb_max_float_error': preserved, 'save_png8_max_error_vs_expected_bytes': save_error, 'passed': preserved == 0 and save_error == 0}
assert report['postprocess_probe']['passed'], report['postprocess_probe']
body_im = Image.open(body).convert('RGBA')
head_im = Image.open(head).convert('RGBA')
result_im = Image.open(result).convert('RGBA')
body_arr = np.asarray(body_im.resize(result_im.size, Image.Resampling.LANCZOS))
result_arr = np.asarray(result_im)
opaque = result_arr[..., 3] > 250
report['image_measurements'] = {'v2_opaque_rgb_median': np.median(result_arr[..., :3][opaque], axis=0).tolist(), 'v1_resized_rgb_median_under_v2_opaque_mask': np.median(body_arr[..., :3][opaque], axis=0).tolist(), 'note': 'Spatial mask comparison is descriptive; generation shifted some geometry.'}
# A compact evidence preview, not a repaired image.
canvas = Image.new('RGB', (768, 256), (249, 246, 241))
for index, im in enumerate([body_im, head_im, result_im]):
    preview = im.copy()
    preview.thumbnail((256, 256), Image.Resampling.LANCZOS)
    tile = Image.new('RGBA', (256, 256), (249, 246, 241, 255))
    tile.alpha_composite(preview, ((256-preview.width)//2, (256-preview.height)//2))
    canvas.paste(tile.convert('RGB'), (index * 256, 0))
thumb = research / 'body-head-result_thumb.png'
canvas.save(thumb)
assert thumb.stat().st_size < 1_000_000
report['preview'] = {'path': str(thumb), 'bytes': thumb.stat().st_size, 'order': ['original body', 'head reference', 'BFS result']}
output = research / 'color-probe.json'
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ['input_decode', 'postprocess_probe', 'image_measurements', 'preview']}, ensure_ascii=False, indent=2))
print('REPORT', output)
