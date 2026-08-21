#!/usr/bin/env python3
"""Generate the Android adaptive launcher icon from the iOS app icon.

Run from the repo root:  python3 scripts/android/make-launcher-icon.py

Writes ic_launcher_foreground.png and ic_launcher_monochrome.png into every mipmap-* bucket. The
background is a flat colour (@color/iconBackground) set in values/colors.xml, so there is no
background bitmap to generate.

Pure stdlib on purpose — this machine has neither Pillow nor ImageMagick, and an icon pipeline that
cannot be re-run is how the two platforms drifted apart in the first place.
"""
import zlib, struct, os

SRC = 'ios/airgapp/Images.xcassets/AppIcon.appiconset/icon.png'
RED = (227, 25, 55)          # #E31937, sampled from the iOS artwork
BBOX = (175, 833, 205, 791)  # the white "A", measured
# Adaptive icons are 108dp but only the CENTRE 72dp is guaranteed visible — launchers mask to a
# circle/squircle/rounded-square and the outer ring exists purely so the icon can be parallaxed.
#
# So the glyph must be sized against the VISIBLE 72dp, not the 108dp layer. On iOS the "A" spans
# 64.3% of the icon's visible square; matching that here means 0.643 * 72dp = 46.3dp, i.e.
# 46.3/108 = 0.43 of the layer. Sizing it against the full layer (0.60) is what left the Android
# icon with almost no margin next to iOS — it filled ~90% of the visible area.
GLYPH_FRAC = 0.643 * (72.0 / 108.0)
DENSITIES = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

def decode(p):
    d = open(p, 'rb').read(); pos = 8; idat = b''
    while pos < len(d):
        ln = struct.unpack('>I', d[pos:pos+4])[0]; typ = d[pos+4:pos+8]; body = d[pos+8:pos+8+ln]
        if typ == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', body[:10])
        elif typ == b'IDAT': idat += body
        elif typ == b'IEND': break
        pos += 12 + ln
    raw = zlib.decompress(idat); ch = {0:1, 2:3, 4:2, 6:4}[ct]; stride = w*ch
    rows = []; prev = bytearray(stride); i = 0
    for _ in range(h):
        f = raw[i]; i += 1; line = bytearray(raw[i:i+stride]); i += stride
        for x in range(stride):
            a = line[x-ch] if x >= ch else 0; b = prev[x]; c = prev[x-ch] if x >= ch else 0
            if f == 1: line[x] = (line[x]+a) & 255
            elif f == 2: line[x] = (line[x]+b) & 255
            elif f == 3: line[x] = (line[x]+(a+b)//2) & 255
            elif f == 4:
                pp = a+b-c; pa = abs(pp-a); pb = abs(pp-b); pc = abs(pp-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x]+pr) & 255
        rows.append(bytes(line)); prev = line
    return w, h, ch, rows

def encode(path, w, h, px):
    raw = b''.join(b'\x00' + px[y*w*4:(y+1)*w*4] for y in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(raw, 9))
    out += chunk(b'IEND', b'')
    open(path, 'wb').write(out)

W, H, CH, ROWS = decode(SRC)
x0, x1, y0, y1 = BBOX
gw, gh = x1-x0, y1-y0
cx, cy = (x0+x1)/2, (y0+y1)/2

def alpha_at(sx, sy):
    """How white this source pixel is. The art is a two-colour blend of RED and white, and the
    green channel separates them furthest (25 → 253), so it carries the cleanest antialiasing."""
    if sx < 0 or sy < 0 or sx >= W or sy >= H: return 0
    g = ROWS[int(sy)][int(sx)*CH + 1]
    a = (g - RED[1]) / (253 - RED[1])
    return 0 if a < 0 else (255 if a > 1 else int(round(a*255)))

def render(L):
    """Glyph centred in an L×L transparent layer, box-filtered down from the 1024px source."""
    target = GLYPH_FRAC * L
    scale = target / max(gw, gh)          # source px -> layer px
    inv = 1.0 / scale
    step = max(1, int(inv / 3))           # supersample: ~3 taps per axis per dest pixel
    px = bytearray(L*L*4)
    for dy in range(L):
        for dx in range(L):
            # dest centre -> source coords
            sx0 = cx + (dx + 0.5 - L/2) * inv
            sy0 = cy + (dy + 0.5 - L/2) * inv
            tot = n = 0
            yy = 0
            while yy < inv:
                xx = 0
                while xx < inv:
                    tot += alpha_at(sx0 - inv/2 + xx, sy0 - inv/2 + yy); n += 1
                    xx += step
                yy += step
            a = tot // max(n, 1)
            o = (dy*L + dx) * 4
            px[o] = px[o+1] = px[o+2] = 255   # white glyph
            px[o+3] = a
    return bytes(px)

res = 'android/app/src/main/res'
for dens, L in DENSITIES.items():
    data = render(L)
    d = f'{res}/mipmap-{dens}'
    encode(f'{d}/ic_launcher_foreground.png', L, L, data)
    encode(f'{d}/ic_launcher_monochrome.png', L, L, data)
    for stale in ('ic_launcher_foreground.webp', 'ic_launcher_monochrome.webp', 'ic_launcher_background.webp'):
        p = f'{d}/{stale}'
        if os.path.exists(p): os.remove(p)
    print(f'{dens}: {L}x{L} foreground + monochrome written')
