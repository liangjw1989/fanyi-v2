# -*- coding: utf-8 -*-
"""stitch.py — 把两组渲染图并排拼成一张"原文 vs 译文"对比图

用法:
    python stitch.py <原图目录> <译图目录> <输出png> [最多页数] [左标题] [右标题]
目录里放的是 page-0001.png / page-0002.png 之类的文件（LibreOffice Kit 渲染产物）。
"""
import sys, os, glob

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from PIL import Image, ImageDraw, ImageFont


def pages_of(d, limit):
    files = sorted(glob.glob(os.path.join(d, "page-*.png")))
    return [Image.open(f).convert("RGB") for f in files[:limit]]


def font(size):
    for name in ("msyh.ttc", "simhei.ttf", "simsun.ttc"):
        p = os.path.join("C:\\Windows\\Fonts", name)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def label(img, text, height=52):
    w, h = img.size
    canvas = Image.new("RGB", (w, h + height), "white")
    canvas.paste(img, (0, height))
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, w, height], fill="#1e293b")
    d.text((16, 11), text, fill="white", font=font(28))
    return canvas


def main():
    left_dir, right_dir, out_png = sys.argv[1], sys.argv[2], sys.argv[3]
    limit = int(sys.argv[4]) if len(sys.argv) > 4 else 2
    lt = sys.argv[5] if len(sys.argv) > 5 else "原文"
    rt = sys.argv[6] if len(sys.argv) > 6 else "译文（保版式）"

    L = [label(i, lt) for i in pages_of(left_dir, limit)]
    R = [label(i, rt) for i in pages_of(right_dir, limit)]
    if not L or not R:
        print("缺少渲染图"); return 1

    gap = 30
    lw = sum(i.width for i in L) + 18 * (len(L) - 1)
    rw = sum(i.width for i in R) + 18 * (len(R) - 1)
    h = max(max(i.height for i in L), max(i.height for i in R))
    canvas = Image.new("RGB", (lw + rw + gap, h), "#eef1f6")

    x = 0
    for img in L:
        canvas.paste(img, (x, 0)); x += img.width + 18
    x += gap
    for img in R:
        canvas.paste(img, (x, 0)); x += img.width + 18

    canvas.save(out_png)
    print("wrote", out_png, canvas.size)
    return 0


if __name__ == "__main__":
    sys.exit(main())
