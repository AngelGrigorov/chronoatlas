"""Нарязва релефа на Natural Earth (NE2_50M_SR_W, равнопромежутъчна проекция)
на плочки 256px в Web Mercator за мащаб 0..5 -> public/tiles/relief/{z}/{x}/{y}.webp.

python tools/build-relief.py
"""
import math
import os
import sys

import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.cache/ne/NE2_50M_SR_W/NE2_50M_SR_W/NE2_50M_SR_W.tif')
OUT = os.path.join(ROOT, 'public/tiles/relief')
MAX_Z = 5
T = 256

src = Image.open(SRC).convert('RGB')
print('source', src.size)

for z in range(MAX_Z + 1):
    n = 2 ** z
    W = T * n
    # Хоризонтално мащабът е линеен; вертикално всеки ред на плочката
    # се взима от реда в изходника с неговата географска ширина.
    level = np.asarray(src.resize((W, W // 2), Image.LANCZOS))
    H = level.shape[0]
    py = np.arange(W) + 0.5
    lat = np.degrees(np.arctan(np.sinh(math.pi * (1 - 2 * py / W))))
    rows = np.clip(((90 - lat) / 180 * H).astype(int), 0, H - 1)
    world = level[rows]
    for x in range(n):
        for y in range(n):
            d = os.path.join(OUT, str(z), str(x))
            os.makedirs(d, exist_ok=True)
            tile = world[y * T:(y + 1) * T, x * T:(x + 1) * T]
            Image.fromarray(tile).save(os.path.join(d, f'{y}.webp'), quality=78, method=6)
    print('z', z, n * n, 'tiles')
    sys.stdout.flush()
