"""Draws the home-screen icons (the site's book logo, white on green) into public/."""
from pathlib import Path
from PIL import Image, ImageDraw

GREEN, WHITE = (35, 79, 66), (255, 254, 250)
OUT = Path(__file__).resolve().parent.parent / 'public'


def bezier(p0, p1, p2, p3, steps=40):
    return [tuple((1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d
                  for a, b, c, d in zip(p0, p1, p2, p3)) for t in (i / steps for i in range(steps + 1))]


def book_outline():
    # Same shape as the "i-book" symbol of the page, in its 24x24 viewBox.
    return (bezier((3, 4.5), (7, 3.5), (9, 4.2), (12, 6.5)) + bezier((12, 6.5), (15, 4.2), (17, 3.5), (21, 4.5))
            + [(21, 19.5)] + bezier((21, 19.5), (17, 18.5), (15, 19.2), (12, 21.5))
            + bezier((12, 21.5), (9, 19.2), (7, 18.5), (3, 19.5)) + [(3, 4.5)])


def icon(size, book_share=0.56):
    scale = 4  # draw large, then shrink: smooth edges
    big = size * scale
    img = Image.new('RGB', (big, big), GREEN)
    draw = ImageDraw.Draw(img)
    unit = big * book_share / 18  # the book spans x 3..21 of the viewBox
    ox, oy = (big - 18 * unit) / 2 - 3 * unit, (big - 17 * unit) / 2 - 4.5 * unit
    pt = lambda p: (ox + p[0] * unit, oy + p[1] * unit)
    width = round(1.65 * unit)
    outline = [pt(p) for p in book_outline()]
    draw.line(outline, fill=WHITE, width=width)
    draw.line([pt((12, 6.5)), pt((12, 21.5))], fill=WHITE, width=width)
    for x, y in outline + [pt((12, 21.5))]:  # round every joint, like stroke-linejoin:round
        draw.ellipse([x - width / 2, y - width / 2, x + width / 2, y + width / 2], fill=WHITE)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    for name, size in [('icon-192.png', 192), ('icon-512.png', 512), ('apple-touch-icon.png', 180)]:
        icon(size).save(OUT / name, optimize=True)
        print('wrote', name)
