# -*- coding: utf-8 -*-
"""Diagnose a PDF's layout structure (columns, tables, fonts) using PyMuPDF.

Usage: python inspect_pdf.py <file.pdf> [maxpages]
"""
import sys, os, json, collections
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    import fitz  # PyMuPDF
except ImportError:
    print("PyMuPDF not installed"); sys.exit(2)


def rnd(v, n=1):
    return round(float(v), n)


def analyze(path, max_pages=3):
    doc = fitz.open(path)
    out = {"file": os.path.basename(path), "pages": doc.page_count, "analysis": []}
    for pno in range(min(max_pages, doc.page_count)):
        page = doc[pno]
        W, H = page.rect.width, page.rect.height
        d = page.get_text("dict")
        fonts = collections.Counter()
        spans = []
        for b in d["blocks"]:
            if b.get("type") != 0:
                continue
            for l in b["lines"]:
                for s in l["spans"]:
                    t = s["text"]
                    if not t.strip():
                        continue
                    fonts[(s["font"], rnd(s["size"]))] += len(t)
                    spans.append({
                        "t": t, "x0": s["bbox"][0], "y0": s["bbox"][1],
                        "x1": s["bbox"][2], "y1": s["bbox"][3],
                        "size": s["size"], "font": s["font"], "dir": l.get("dir"),
                    })
        # column histogram over x-centre of spans
        hist = [0] * 20
        for s in spans:
            if s["y0"] < H * 0.12 or s["y1"] > H * 0.9:
                continue
            c = (s["x0"] + s["x1"]) / 2 / W
            hist[min(19, max(0, int(c * 20)))] += 1
        # gutter detection: vertical strip with no span crossing
        def crosses(x):
            n = 0
            for s in spans:
                if s["x0"] < x < s["x1"] and H * 0.12 < s["y0"] < H * 0.9:
                    n += 1
            return n
        strip = [(rnd(x / W, 2), crosses(x)) for x in range(int(W * 0.3), int(W * 0.7), 8)]
        gutters = [x for x, n in strip if n == 0]
        out["analysis"].append({
            "page": pno + 1, "w": rnd(W), "h": rnd(H),
            "n_spans": len(spans), "n_blocks": len([b for b in d["blocks"] if b.get("type") == 0]),
            "fonts": [{"font": f, "size": s, "chars": c} for (f, s), c in fonts.most_common(12)],
            "x_histogram_20": hist,
            "clean_gutter_x_ratios": gutters[:8],
            "sample_spans": spans[:12],
        })
        # drawings / images / tables
        try:
            tabs = page.find_tables()
            out["analysis"][-1]["tables"] = len(tabs.tables)
        except Exception as e:
            out["analysis"][-1]["tables"] = "n/a"
        out["analysis"][-1]["images"] = len(page.get_images(full=True))
        out["analysis"][-1]["drawings"] = len(page.get_drawings())
    doc.close()
    return out


if __name__ == "__main__":
    p = sys.argv[1]
    mp = int(sys.argv[2]) if len(sys.argv) > 2 else 3
    print(json.dumps(analyze(p, mp), ensure_ascii=False, indent=1))
