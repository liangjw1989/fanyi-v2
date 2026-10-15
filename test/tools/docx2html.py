# -*- coding: utf-8 -*-
"""docx2html.py — 把 .docx 转成 mammoth 风格的语义化 HTML（仅用于本地验证抽取器）。

用法: python docx2html.py <in.docx> <out.html>
"""
import sys, os, base64, re
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

TWIP = 20.0  # 1pt = 20 twip


def esc(t):
    return (t.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def emu_to_pt(v):
    try:
        return round(int(v) / 12700.0, 1)
    except Exception:
        return None


def style_of_run(r):
    st = []
    if r.bold:
        st.append("font-weight:bold")
    if r.italic:
        st.append("font-style:italic")
    if r.underline:
        st.append("text-decoration:underline")
    f = r.font
    if f is not None and f.size is not None:
        st.append("font-size:%gpt" % (f.size.pt,))
    if f is not None and f.color is not None and f.color.rgb is not None:
        try:
            st.append("color:#%s" % (str(f.color.rgb),))
        except Exception:
            pass
    if f is not None and f.name:
        st.append("font-family:%s" % f.name)
    return ";".join(st)


def para_align(p):
    a = p.alignment
    if a is None:
        return None
    return {0: "left", 1: "center", 2: "right", 3: "justify"}.get(int(a))


def para_indent(p):
    pf = p.paragraph_format
    if pf.first_line_indent is None:
        return None
    return pf.first_line_indent.pt


def img_html(inline, rels):
    """把 <w:drawing>/<a:blip> 转成 <img>"""
    blips = inline.findall(".//" + qn("a:blip"))
    if not blips:
        return ""
    rid = blips[0].get(qn("r:embed"))
    part = rels.get(rid)
    if part is None:
        return ""
    data = part.blob
    ct = part.content_type or "image/png"
    b64 = base64.b64encode(data).decode("ascii")
    # 尺寸
    w = h = None
    exts = inline.findall(".//" + qn("wp:extent"))
    if exts:
        w = emu_to_pt(exts[0].get("cx"))
        h = emu_to_pt(exts[0].get("cy"))
    style = "width:%gpx" % (w * 96 / 72) if w else ""
    return '<img src="data:%s;base64,%s" style="%s" alt=""/>' % (ct, b64, style)


def runs_to_html(p, rels):
    out = []
    for child in p._p.iterchildren():
        tag = child.tag
        if tag == qn("w:r"):
            # 图片？
            html = img_html(child, rels)
            if html:
                out.append(html)
                continue
            r = docx.text.run.Run(child, p)
            t = r.text
            if t is None or t == "":
                continue
            st = style_of_run(r)
            # 上下标
            va = child.find(qn("w:rPr") + "/" + qn("w:vertAlign")) if child.find(qn("w:rPr")) is not None else None
            text = esc(t)
            if va is not None and va.get(qn("w:val")) == "superscript":
                text = "<sup>%s</sup>" % text
            elif va is not None and va.get(qn("w:val")) == "subscript":
                text = "<sub>%s</sub>" % text
            out.append('<span style="%s">%s</span>' % (st, text) if st else text)
        elif tag == qn("w:hyperlink"):
            for r in child.findall(qn("w:r")):
                rr = docx.text.run.Run(r, p)
                if rr.text:
                    out.append(esc(rr.text))
        elif tag == qn("w:ins"):
            for r in child.findall(qn("w:r")):
                rr = docx.text.run.Run(r, p)
                if rr.text:
                    out.append(esc(rr.text))
    return "".join(out)


def paragraph_html(p, rels):
    inner = runs_to_html(p, rels)
    if not inner.strip():
        return ""
    st = []
    a = para_align(p)
    if a:
        st.append("text-align:%s" % a)
    ind = para_indent(p)
    if ind and ind > 0:
        st.append("text-indent:%gpt" % ind)
    ls = p.paragraph_format.line_spacing
    if isinstance(ls, float) and ls > 1:
        st.append("line-height:%g" % ls)
    return "<p style=\"%s\">%s</p>" % (";".join(st), inner)


def table_html(tbl, rels):
    rows = []
    for row in tbl.rows:
        cells = []
        for c in row.cells:
            tag = "th" if c._tc.find(qn("w:tcPr") + "/" + qn("w:shd")) is not None else "td"
            inner = "".join(paragraph_html(p, rels) for p in c.paragraphs)
            if not inner.strip():
                inner = ""
            cells.append("<%s>%s</%s>" % (tag, inner, tag))
        rows.append("<tr>%s</tr>" % "".join(cells))
    return "<table>%s</table>" % "".join(rows)


def convert(path, out):
    d = docx.Document(path)
    rels = {}
    for rid, part in d.part.rels.items():
        if "image" in part.reltype:
            rels[rid] = part.target_part
    body = d.element.body
    html = []
    for child in body.iterchildren():
        if child.tag == qn("w:p"):
            p = Paragraph(child, d)
            h = paragraph_html(p, rels)
            if h:
                html.append(h)
        elif child.tag == qn("w:tbl"):
            html.append(table_html(Table(child, d), rels))
    doc = "<!DOCTYPE html><html><body>\n%s\n</body></html>" % "\n".join(html)
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)
    print("wrote %s  (%d blocks, %d images)" % (out, len(html), len(rels)))


if __name__ == "__main__":
    convert(sys.argv[1], sys.argv[2])
