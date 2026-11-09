# Draws the app icons (brand mark) for the web app (public/) and the Android launcher (android/.../res/mipmap-*).
from PIL import Image, ImageDraw, ImageFilter
import os
HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', 'public')
RES = os.path.join(HERE, '..', 'android', 'app', 'src', 'main', 'res')
BG = (14, 4, 24); MAG = (255, 79, 216); CYAN = (53, 232, 255); LIME = (140, 255, 102)

def mark(S, pad, bg):
    im = Image.new('RGBA', (S, S), (bg + (255,)) if bg else (0, 0, 0, 0))
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    k = (S - 2 * pad) / 32
    def P(x, y): return (pad + k * x, pad + k * y)
    for layer, wmul in ((glow, 2.2), (im, 1.0)):
        d = ImageDraw.Draw(layer)
        c = P(16, 16); r = 13 * k
        d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], outline=MAG + (170,), width=max(1, int(1.6 * k * wmul)))
        d.line([P(8.5, 20.5), P(14, 10), P(19.5, 17), P(23.5, 11)], fill=MAG + (255,), width=max(1, int(2.2 * k * wmul)), joint='curve')
        for (x, y, rr, col) in [(14, 10, 2.6, CYAN), (19.5, 17, 2.2, LIME), (8.5, 20.5, 1.3, CYAN), (23.5, 11, 1.3, CYAN)]:
            q = P(x, y); R = rr * k * (1.4 if layer is glow else 1)
            d.ellipse([q[0] - R, q[1] - R, q[0] + R, q[1] + R], fill=col + (255,))
    glow = glow.filter(ImageFilter.GaussianBlur(S / 70))
    base = Image.new('RGBA', (S, S), (bg + (255,)) if bg else (0, 0, 0, 0))
    base.alpha_composite(glow); base.alpha_composite(im)
    return base

def icon(size, maskable=False):
    S = size * 4
    return mark(S, S * (0.22 if maskable else 0.12), BG).resize((size, size), Image.LANCZOS)

icon(192).save(os.path.join(OUT, 'icon-192.png'))
icon(512).save(os.path.join(OUT, 'icon-512.png'))
icon(512, True).save(os.path.join(OUT, 'icon-maskable-512.png'))
icon(180).save(os.path.join(OUT, 'apple-touch-icon.png'))
icon(64).save(os.path.join(OUT, 'favicon.png'))

if os.path.isdir(RES):
    for dpi, mult in {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}.items():
        d = os.path.join(RES, 'mipmap-' + dpi)
        os.makedirs(d, exist_ok=True)
        legacy = int(48 * mult)
        icon(legacy).save(os.path.join(d, 'ic_launcher.png'))
        rnd = icon(legacy); m = Image.new('L', rnd.size, 0); ImageDraw.Draw(m).ellipse([0, 0, legacy - 1, legacy - 1], fill=255); rnd.putalpha(m)
        rnd.save(os.path.join(d, 'ic_launcher_round.png'))
        fg = int(108 * mult); S = fg * 4
        mark(S, S * (21 / 108), None).resize((fg, fg), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_foreground.png'))
