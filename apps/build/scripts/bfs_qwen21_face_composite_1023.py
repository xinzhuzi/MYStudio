"""Compose only the verified CPU BFS face, with measured image-grid landmarks."""
import hashlib
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
R = ROOT / '.trellis/tasks/10-22-bfs-qwen21-color-diagnosis/research/face-ab-1023'
plan = json.loads((R.parent / 'face-test-input-plan.json').read_text())
original_path = Path(plan['body']['path'])
assert hashlib.sha256(original_path.read_bytes()).hexdigest() == plan['body']['sha256']
for case in ['A', 'B']:
    for seed in [42, 43]:
        h = json.loads((R / f'{case}-vae-cpu-seed{seed}.history.json').read_text())
        assert h['status']['status_str'] == 'success' and h['status']['completed']
original = Image.open(original_path).convert('RGB')
assert original.size == (1254, 1254)
target = Image.open(R / 'body-crop-1024.png').convert('RGB')
source_path = Path(json.loads((R / 'B-vae-cpu-seed42.outputs.json').read_text())[0]['path'])
source = Image.open(source_path).convert('RGB')
# Eye centers and mouth center read from landmark-grid_thumb.png, in 1024-crop pixels.
src = np.array([[433, 410], [606, 410], [521, 576]], dtype=np.float64)
dst = np.array([[463, 492], [586, 491], [526, 615]], dtype=np.float64)
src_center, dst_center = src.mean(0), dst.mean(0)
x, y = src - src_center, dst - dst_center
u, singular, vt = np.linalg.svd(x.T @ y)
rotation = vt.T @ u.T
assert np.linalg.det(rotation) > 0
scale = singular.sum() / np.square(x).sum()
linear = scale * rotation
translation = dst_center - linear @ src_center
residual = np.linalg.norm(src @ linear.T + translation - dst, axis=1)
assert residual.max() < 5, residual
inverse = np.linalg.inv(linear)
offset = -inverse @ translation
coefficients = (*inverse[0], offset[0], *inverse[1], offset[1])
aligned = source.transform((1024, 1024), Image.Transform.AFFINE, coefficients, Image.Resampling.BICUBIC)
# Match only broad face color/illumination; source high-frequency facial marks remain.
source_low = np.asarray(aligned.filter(ImageFilter.GaussianBlur(16)), dtype=np.float32)
target_low = np.asarray(target.filter(ImageFilter.GaussianBlur(16)), dtype=np.float32)
source_pixels = np.asarray(aligned, dtype=np.float32)
luma_weights = np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
source_luma = source_pixels @ luma_weights
detail_luma = (source_pixels - source_low) @ luma_weights
face = target_low + detail_luma[..., None]
# Dark eyes/brows retain the reference hue; skin takes the original broad palette.
new_luma = np.clip(face @ luma_weights, 0, 255)
feature_color = source_pixels * (new_luma / np.maximum(source_luma, 1))[..., None]
feature_weight = np.clip((125 - source_luma) / 50, 0, 1)[..., None]
face = np.clip(face * (1 - feature_weight) + feature_color * feature_weight, 0, 255)
face = Image.fromarray(np.rint(face).astype(np.uint8), 'RGB')
polygon = [(430, 458), (456, 446), (490, 444), (518, 448), (549, 444), (577, 450),
           (603, 465), (614, 490), (616, 521), (605, 552), (590, 584), (568, 616),
           (544, 646), (526, 666), (510, 659), (484, 634), (460, 604), (443, 573),
           (431, 544), (425, 519), (426, 488)]
mask = Image.new('L', (1024, 1024), 0)
ImageDraw.Draw(mask).polygon(polygon, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(8))
# The hair is retained above the eyebrows and outside the manually checked face polygon.
base_pixels = np.asarray(target)
mask_pixels = np.array(mask)
yy, xx = np.indices(mask_pixels.shape)
protect_hair = (yy < 455) & (base_pixels.mean(2) < 85)
mask_pixels[protect_hair] = 0
mask = Image.fromarray(mask_pixels, 'L')
crop_box = plan['proposed_body_crop_xyxy']
patch_size = (crop_box[2] - crop_box[0], crop_box[3] - crop_box[1])
patch = face.resize(patch_size, Image.Resampling.LANCZOS)
patch_mask = mask.resize(patch_size, Image.Resampling.LANCZOS)
layer = original.copy()
layer.paste(patch, crop_box[:2])
full_mask = Image.new('L', original.size, 0)
full_mask.paste(patch_mask, crop_box[:2])
result = Image.composite(layer, original, full_mask)
a, b = np.asarray(original).astype(np.int16), np.asarray(result).astype(np.int16)
support = np.asarray(full_mask) > 0
outside_max = int(np.abs(a[~support] - b[~support]).max())
assert outside_max == 0
assert np.any(a[support] != b[support])
output = original_path.parent / 'BFS_CPU_face_swap_seed42_preserve_original_1023_v2.png'
with output.open('xb') as stream:
    result.save(stream, format='PNG')
with (R / 'composite-v2-mask-1254.png').open('xb') as stream:
    full_mask.save(stream, format='PNG')
report = {'output': str(output), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
          'original': str(original_path), 'original_sha256': plan['body']['sha256'],
          'source': str(source_path), 'source_eye_mouth_xy': src.tolist(), 'target_eye_mouth_xy': dst.tolist(),
          'landmark_residuals_crop_pixels': residual.tolist(), 'scale': float(scale),
          'rotation': rotation.tolist(), 'translation': translation.tolist(), 'mask_polygon_crop_xy': polygon,
          'color_match': 'B luminance facial marks and dark feature hue plus original broad skin palette; face mask only',
          'mask_bbox': full_mask.getbbox(), 'mask_support_pixels': int(support.sum()),
          'outside_mask_max_rgb_difference': outside_max, 'size': list(result.size), 'mode': result.mode,
          'state': 'Awaiting main-session visual acceptance; pixel preservation passed.'}
with (R / 'composite-v2-evidence.json').open('x') as stream:
    json.dump(report, stream, ensure_ascii=False, indent=2)
    stream.write('\n')
canvas = Image.new('RGB', (768,410), (249,246,241))
draw = ImageDraw.Draw(canvas)
for i, (im, label) in enumerate([(original, 'Original'), (result, 'Face only / original hair and body')]):
    im = im.crop(crop_box).resize((384,384), Image.Resampling.LANCZOS)
    canvas.paste(im, (i*384,26))
    draw.text((i*384+8,8),label,fill='black')
thumb = R / 'composite-v2-head_thumb.png'
with thumb.open('xb') as stream:
    canvas.save(stream, format='PNG')
assert thumb.stat().st_size < 1000000
print(json.dumps(report,ensure_ascii=False),flush=True)
print('THUMB',thumb,thumb.stat().st_size,flush=True)
