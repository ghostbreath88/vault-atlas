# Draws the app icons (brand mark) at several sizes.
from PIL import Image, ImageDraw
import os
OUT = os.path.join(os.path.dirname(__file__), '..', 'public')
BG = (18, 20, 24); ACC = (224, 170, 98)
def icon(size, maskable=False):
    s = 4; S = size * s
    im = Image.new('RGBA', (S, S), BG + (255,))
    d = ImageDraw.Draw(im)
    pad = S * (0.22 if maskable else 0.12)
    def P(x, y): return (pad + (S - 2 * pad) * x / 32, pad + (S - 2 * pad) * y / 32)
    k = (S - 2 * pad) / 32
    c = P(16, 16); r = 13 * k
    d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], outline=ACC + (115,), width=int(1.6 * k))
    d.line([P(8.5, 20.5), P(14, 10), P(19.5, 17), P(23.5, 11)], fill=ACC + (255,), width=int(2.2 * k), joint='curve')
    for (x, y, rr) in [(14, 10, 2.6), (19.5, 17, 2.2), (8.5, 20.5, 1.3), (23.5, 11, 1.3)]:
        q = P(x, y); R = rr * k
        d.ellipse([q[0] - R, q[1] - R, q[0] + R, q[1] + R], fill=ACC + (255,))
    return im.resize((size, size), Image.LANCZOS)
icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, True).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(64).save(os.path.join(OUT, 'favicon.png'))
