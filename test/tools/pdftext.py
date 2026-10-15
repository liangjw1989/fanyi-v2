# -*- coding: utf-8 -*-
"""pdftext.py — 纯标准库 PDF 文字抽取（用于离线验证版式算法）

支持：FlateDecode 流、Tj/TJ/'/" 文本算子、Td/TD/Tm/T* 定位、Tf 字号、
      ToUnicode CMap（含 bfchar/bfrange），Identity-H 与 WinAnsi 单字节编码。

用法：
    python pdftext.py <file.pdf> [maxpages]            # 打印每行摘要
    python pdftext.py <file.pdf> [maxpages] --json out.json   # 输出 items
"""
import sys, os, re, zlib, json

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

WS = b"\x00\t\n\x0c\r "


# ------------------------------------------------------------------ 词法工具

def tokenize(data):
    """把内容流切成 token（操作符/数字/字符串/数组/名字）"""
    i, n = 0, len(data)
    while i < n:
        c = data[i:i + 1]
        if c in WS:
            i += 1
            continue
        if c == b"%":                      # 注释
            j = data.find(b"\n", i)
            i = n if j < 0 else j + 1
            continue
        if c == b")":                       # 孤立的右括号（正常不该出现）
            yield ("op", b")")
            i += 1
            continue
        if c == b"(":
            j = i + 1
            depth = 1
            out = bytearray()
            while j < n:
                ch = data[j:j + 1]
                if ch == b"\\":
                    nxt = data[j + 1:j + 2]
                    mp = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f",
                          b"(": b"(", b")": b")", b"\\": b"\\"}
                    if nxt in mp:
                        out += mp[nxt]; j += 2; continue
                    if nxt.isdigit():
                        m = re.match(rb"[0-7]{1,3}", data[j + 1:j + 4])
                        out.append(int(m.group(0), 8) & 0xFF); j += 1 + len(m.group(0)); continue
                    out += nxt; j += 2; continue
                if ch == b"(":
                    depth += 1
                    out += ch
                    j += 1
                    continue
                if ch == b")":
                    depth -= 1
                    j += 1
                    if depth == 0:
                        break
                    out += ch
                    continue
                out += ch
                j += 1
            yield ("str", bytes(out))
            i = j
            continue
        if c == b"<":
            if data[i + 1:i + 2] == b"<":
                yield ("op", b"<<"); i += 2; continue
            j = data.find(b">", i + 1)
            if j < 0:
                yield ("op", b"<"); i += 1; continue
            hexs = re.sub(rb"[^0-9A-Fa-f]", b"", data[i + 1:j])
            if len(hexs) % 2:
                hexs += b"0"
            yield ("str", bytes.fromhex(hexs.decode("ascii")))
            i = j + 1
            continue
        if c == b">":
            if data[i + 1:i + 2] == b">":
                yield ("op", b">>"); i += 2; continue
            i += 1; continue
        if c == b"[":
            yield ("op", b"["); i += 1; continue
        if c == b"]":
            yield ("op", b"]"); i += 1; continue
        if c == b"/":
            j = i + 1
            while j < n and data[j:j + 1] not in WS and data[j:j + 1] not in b"<>[]()/%":
                j += 1
            yield ("name", data[i + 1:j].decode("latin-1"))
            i = j
            continue
        j = i
        while j < n and data[j:j + 1] not in WS and data[j:j + 1] not in b"<>[]()/%":
            j += 1
        tok = data[i:j]
        if re.match(rb"^[+-]?[\d.]+$", tok):
            try:
                yield ("num", float(tok))
            except ValueError:
                yield ("op", tok)
        else:
            yield ("op", tok)
        i = j


# ------------------------------------------------------------- PDF 对象解析

class PDF(object):
    def __init__(self, path):
        self.data = open(path, "rb").read()
        self.objects = {}
        self.trailer = {}
        self._scan_objects()

    def _scan_objects(self):
        for m in re.finditer(rb"(\d+)\s+(\d+)\s+obj\b", self.data):
            num = int(m.group(1))
            start = m.end()
            end = self.data.find(b"endobj", start)
            if end < 0:
                end = len(self.data)
            self.objects[num] = self.data[start:end]

    def get(self, num):
        return self.objects.get(num)

    def stream_of(self, raw):
        """返回 (dict字符串, 解码后的流字节)"""
        i = raw.find(b"stream")
        if i < 0:
            return raw, b""
        dict_part = raw[:i]
        j = i + 6
        if raw[j:j + 2] == b"\r\n":
            j += 2
        elif raw[j:j + 1] in (b"\n", b"\r"):
            j += 1
        # 用 /Length 精确定位流长度（最可靠），否则找第一个 endstream
        data = None
        lm = re.search(rb"/Length\s+(\d+)(\s+\d+\s+R)?", dict_part)
        if lm:
            if lm.group(2):                       # /Length 是间接引用
                ref = int(lm.group(1))
                robj = self.get(ref) or b""
                m2 = re.search(rb"(\d+)", robj)
                ln = int(m2.group(1)) if m2 else -1
            else:
                ln = int(lm.group(1))
            if 0 <= ln <= len(raw) - j:
                data = raw[j:j + ln]
            elif ln > 0:
                data = raw[j:j + ln]              # 交叉引用流可能略有偏差
        if data is None:
            k = raw.find(b"endstream", j)
            if k < 0:
                k = len(raw)
            data = raw[j:k].rstrip(b"\r\n")
        if b"FlateDecode" in dict_part:
            try:
                data = zlib.decompress(data)
            except Exception:
                try:
                    data = zlib.decompressobj().decompress(data)
                except Exception:
                    data = b""
        return dict_part, data

    def resolve(self, tok):
        """把 '12 0 R' 解析成对象号"""
        m = re.match(rb"\s*(\d+)\s+\d+\s+R\b", tok)
        if m:
            return int(m.group(1))
        return None


# ------------------------------------------------------- ToUnicode CMap 解析

def parse_tounicode(cmap_bytes):
    """返回 {code:int -> unicode str}；code 为 1 或 2 字节"""
    mapping = {}
    if not cmap_bytes:
        return mapping
    # bfchar
    for m in re.finditer(rb"beginbfchar(.*?)endbfchar", cmap_bytes, re.S):
        for pair in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", m.group(1)):
            src = int(pair.group(1), 16)
            dst = pair.group(2).decode("ascii")
            mapping[src] = "".join(chr(int(dst[i:i + 4], 16)) for i in range(0, len(dst), 4))
    # bfrange
    for m in re.finditer(rb"beginbfrange(.*?)endbfrange", cmap_bytes, re.S):
        body = m.group(1)
        for r in re.finditer(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[(.*?)\])", body, re.S):
            lo = int(r.group(1), 16); hi = int(r.group(2), 16)
            if r.group(4):
                base = r.group(4).decode("ascii")
                base_cp = int(base[-4:], 16) if len(base) >= 4 else int(base, 16)
                prefix = "".join(chr(int(base[i:i + 4], 16)) for i in range(0, max(0, len(base) - 4), 4))
                for k in range(hi - lo + 1):
                    mapping[lo + k] = prefix + chr(base_cp + k)
            elif r.group(5) is not None:
                items = re.findall(rb"<([0-9A-Fa-f]+)>", r.group(5))
                for k, it in enumerate(items):
                    d = it.decode("ascii")
                    mapping[lo + k] = "".join(chr(int(d[i:i + 4], 16)) for i in range(0, len(d), 4))
    return mapping


# ------------------------------------------------------------------ 页面解析

def get_pages(pdf):
    """返回 [{'content': 对象号, 'resources': dict}] —— 顺序按 /Kids"""
    # 找 /Type /Pages 的根
    roots = []
    for num, raw in pdf.objects.items():
        if re.search(rb"/Type\s*/Pages", raw) and b"/Kids" in raw:
            roots.append(num)

    def kids_of(num, seen=None):
        seen = seen or set()
        if num in seen:
            return []
        seen.add(num)
        raw = pdf.objects.get(num, b"")
        m = re.search(rb"/Kids\s*\[(.*?)\]", raw, re.S)
        if not m:
            return [num] if re.search(rb"/Type\s*/Page\b", raw) else []
        out = []
        for km in re.finditer(rb"(\d+)\s+\d+\s+R", m.group(1)):
            out.extend(kids_of(int(km.group(1)), seen))
        return out

    pages = []
    for root in roots[:1]:
        for pnum in kids_of(root):
            raw = pdf.objects.get(pnum, b"")
            pages.append({"obj": pnum, "raw": raw})
    if not pages:
        for num, raw in sorted(pdf.objects.items()):
            if re.search(rb"/Type\s*/Page\b", raw):
                pages.append({"obj": num, "raw": raw})
    return pages


def dict_body(raw, key):
    """从对象原始字节里取出 /key << ... >> 的内部文本（正确处理嵌套）"""
    m = re.search(rb"/" + key + rb"\s*<<", raw)
    if not m:
        return None
    start = m.end()
    depth = 1
    i = start
    n = len(raw)
    while i < n and depth > 0:
        two = raw[i:i + 2]
        if two == b"<<":
            depth += 1; i += 2; continue
        if two == b">>":
            depth -= 1; i += 2; continue
        if raw[i:i + 1] in (b"(",):
            j = raw.find(b")", i)
            i = (j + 1) if j > 0 else i + 1
            continue
        i += 1
    return raw[start:i - 2] if depth == 0 else raw[start:]


def parse_fonts(pdf, font_dict_raw, cache):
    """解析字体字典文本 → {名称: 字体信息}"""
    fonts = {}
    if not font_dict_raw:
        return fonts
    for fm2 in re.finditer(rb"/([A-Za-z0-9#\.\-_]+)\s+(\d+)\s+\d+\s+R", font_dict_raw):
        name = fm2.group(1).decode("latin-1")
        fnum = int(fm2.group(2))
        if fnum in cache:
            fonts[name] = cache[fnum]
            continue
        fraw = pdf.get(fnum) or b""
        base = re.search(rb"/BaseFont\s*/([A-Za-z0-9+,\-\._]+)", fraw)
        enc = re.search(rb"/Encoding\s*/([A-Za-z0-9]+)", fraw)
        subtype = re.search(rb"/Subtype\s*/([A-Za-z0-9]+)", fraw)
        tounicode = None
        tu = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", fraw)
        if tu:
            traw = pdf.get(int(tu.group(1)))
            if traw:
                _, s = pdf.stream_of(traw)
                tounicode = parse_tounicode(s)
        encname = enc.group(1).decode("latin-1") if enc else ""
        two_byte = bool(subtype and subtype.group(1) in (b"Type0",)) or encname in ("Identity-H",) \
            or ("EUC" in encname) or ("GBK" in encname) or ("UCS" in encname) or ("UTF" in encname)
        widths = {}
        firstchar = None
        fc = re.search(rb"/FirstChar\s+(\d+)", fraw)
        if fc:
            firstchar = int(fc.group(1))
        wm = None
        wm2 = re.search(rb"/Widths\s*\[(.*?)\]", fraw, re.S)
        if wm2:
            vals = [float(x) for x in re.findall(rb"[-\d.]+", wm2.group(1))]
            if firstchar is not None:
                for i, v in enumerate(vals):
                    widths[firstchar + i] = v
        dfm = re.search(rb"/DescendantFonts\s*\[\s*(\d+)\s+\d+\s+R", fraw)
        if dfm:
            draw = pdf.get(int(dfm.group(1))) or b""
            if not tounicode:
                tu2 = re.search(rb"/ToUnicode\s+(\d+)\s+\d+\s+R", draw)
                if tu2:
                    traw2 = pdf.get(int(tu2.group(1)))
                    if traw2:
                        _, s2 = pdf.stream_of(traw2)
                        tounicode = parse_tounicode(s2)
            dwm = re.search(rb"/W\s*\[(.*?)\]", draw, re.S)
            if dwm:
                wm = dwm
        if wm is None:
            wm = re.search(rb"/W\s*\[(.*?)\]", fraw, re.S)
        if wm:
            body = wm.group(1)
            for mm in re.finditer(rb"(\d+)\s*\[([^\]]*)\]", body):
                c0 = int(mm.group(1))
                vals = [float(x) for x in re.findall(rb"[-\d.]+", mm.group(2))]
                for i, v in enumerate(vals):
                    widths[c0 + i] = v
            for mm in re.finditer(rb"(\d+)\s+(\d+)\s+([\d.]+)", body):
                c0, c1, w = int(mm.group(1)), int(mm.group(2)), float(mm.group(3))
                if c1 - c0 < 70000:
                    for c in range(c0, c1 + 1):
                        widths[c] = w
        info = {
            "basefont": base.group(1).decode("latin-1") if base else "",
            "two_byte": two_byte, "tounicode": tounicode or {},
            "widths": widths, "subtype": subtype.group(1).decode("latin-1") if subtype else "",
        }
        cache[fnum] = info
        fonts[name] = info
    return fonts


def parse_xobjects(pdf, xobj_dict_raw):
    out = {}
    if not xobj_dict_raw:
        return out
    for m in re.finditer(rb"/([A-Za-z0-9#\.\-_]+)\s+(\d+)\s+\d+\s+R", xobj_dict_raw):
        out[m.group(1).decode("latin-1")] = int(m.group(2))
    return out


# --------------------------------------------------------------- 内容流执行

def decode_string(s, font):
    """把字符串按字体编码转成 unicode"""
    if font is None:
        try:
            return s.decode("utf-8")
        except Exception:
            pass
        for enc in ("gb18030", "gbk"):
            try:
                return s.decode(enc)
            except Exception:
                continue
        return s.decode("latin-1")
    tu = font.get("tounicode") or {}
    out = []
    if font.get("two_byte"):
        if tu:
            for i in range(0, len(s) - 1, 2):
                code = (s[i] << 8) | s[i + 1]
                out.append(tu.get(code, ""))
            txt = "".join(out)
        else:
            txt = ""
        if not txt:
            # 没有 ToUnicode：按中文编码（GBK/GB18030）解码
            for enc in ("gb18030", "gbk"):
                try:
                    return s.decode(enc)
                except Exception:
                    continue
            return s.decode("latin-1")
        return txt
    for b in s:
        out.append(tu.get(b, chr(b)))
    txt = "".join(out)
    if not txt:
        try:
            txt = s.decode("latin-1")
        except Exception:
            txt = ""
    return txt


def text_width(s, font, size):
    if font is None:
        return len(s) * size * 0.5
    widths = font.get("widths") or {}
    total = 0.0
    if font.get("two_byte"):
        codes = [(s[i] << 8) | s[i + 1] for i in range(0, len(s) - 1, 2)]
    else:
        codes = list(s)
    for c in codes:
        w = widths.get(c, 500)
        total += w / 1000.0 * size
    return total


def page_content(pdf, raw):
    content = b""
    arr = re.search(rb"/Contents\s*\[(.*?)\]", raw, re.S)
    if arr:
        for cm in re.finditer(rb"(\d+)\s+\d+\s+R", arr.group(1)):
            _, c = pdf.stream_of(pdf.get(int(cm.group(1))) or b"")
            content += c + b"\n"
    else:
        _, content = pdf.stream_of(raw)
        if not content:
            cm = re.search(rb"/Contents\s+(\d+)\s+\d+\s+R", raw)
            if cm:
                _, content = pdf.stream_of(pdf.get(int(cm.group(1))) or b"")
    return content


def page_inherited(pdf, page_raw, key):
    """沿 /Parent 链找继承的属性（如 /Resources）"""
    m = re.search(rb"/" + key + rb"\s+(\d+)\s+\d+\s+R", page_raw)
    if m:
        return pdf.get(int(m.group(1))) or b""
    body = dict_body(page_raw, key)
    if body is not None:
        return body
    pm = re.search(rb"/Parent\s+(\d+)\s+\d+\s+R", page_raw)
    if pm:
        parent = pdf.get(int(pm.group(1))) or b""
        return page_inherited(pdf, parent, key)
    return b""


def page_resources(pdf, page_raw, cache=None):
    """返回 {字体名: 字体信息}，兼容内联字典、间接引用与 /Parent 继承"""
    cache = cache if cache is not None else {}
    font_dict_raw = dict_body(page_raw, b"Font")
    if font_dict_raw is None:
        robj = page_inherited(pdf, page_raw, b"Resources")
        if robj:
            font_dict_raw = dict_body(robj, b"Font")
            if font_dict_raw is None:
                fref = re.search(rb"/Font\s+(\d+)\s+\d+\s+R", robj)
                if fref:
                    font_dict_raw = pdf.get(int(fref.group(1))) or b""
    return parse_fonts(pdf, font_dict_raw, cache)


def page_xobjects(pdf, page_raw):
    xd = dict_body(page_raw, b"XObject")
    if xd is None:
        robj = page_inherited(pdf, page_raw, b"Resources")
        if robj:
            xd = dict_body(robj, b"XObject")
            if xd is None:
                xr = re.search(rb"/XObject\s+(\d+)\s+\d+\s+R", robj)
                if xr:
                    xd = pdf.get(int(xr.group(1))) or b""
    return parse_xobjects(pdf, xd)


def extract_page_items(pdf, page, page_no, font_cache=None):
    content = page_content(pdf, page["raw"])
    font_cache = font_cache if font_cache is not None else {}
    fonts = page_resources(pdf, page["raw"], font_cache)
    xobjects = page_xobjects(pdf, page["raw"])
    items = []
    run_content(pdf, content, fonts, xobjects, [1, 0, 0, 1, 0, 0], items, page_no, font_cache, 0)
    return items


def run_content(pdf, content, fonts, xobjects, ctm, items, page_no, font_cache, depth=0):
    """执行内容流；遇到 XObject 递归解析（用于 Form XObject 承载正文的情况）"""
    if not content or depth > 12:
        return
    stack = []
    tm = [1, 0, 0, 1, 0, 0]
    tlm = [1, 0, 0, 1, 0, 0]
    cur_font = None
    cur_size = 10.0

    def mul(m, n):
        return [
            m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
            m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
            m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
        ]

    def show(s):
        nonlocal tm
        txt = decode_string(s, cur_font)
        w = text_width(s, cur_font, cur_size)
        if txt and txt.strip():
            full = mul(tm, ctm)
            size = cur_size * (abs(full[0]) if abs(full[0]) > 1e-6 else abs(full[3]) or 1)
            items.append({
                "str": txt, "x": full[4], "y": full[5], "size": size,
                "w": w * (abs(full[0]) or 1),
                "font": (cur_font or {}).get("basefont", ""), "page": page_no,
            })
        tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + w, tm[5]]

    toks = list(tokenize(content))
    idx = 0
    while idx < len(toks):
        t, v = toks[idx]
        if t in ("num", "str", "name"):
            stack.append((t, v)); idx += 1; continue
        op = v
        try:
            if op == b"q":
                pass
            elif op == b"Q":
                pass
            elif op == b"cm":
                nums = [x[1] for x in stack if x[0] == "num"][-6:]
                if len(nums) == 6:
                    ctm = mul(list(nums), ctm)
            elif op == b"BT":
                tm = [1, 0, 0, 1, 0, 0]; tlm = list(tm)
            elif op == b"ET":
                pass
            elif op == b"Tf":
                for k in range(len(stack) - 1, -1, -1):
                    if stack[k][0] == "name":
                        cur_font = fonts.get(stack[k][1]); break
                nums = [x[1] for x in stack if x[0] == "num"]
                if nums:
                    cur_size = nums[-1]
            elif op == b"Td":
                nums = [x[1] for x in stack if x[0] == "num"][-2:]
                if len(nums) == 2:
                    tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + nums[0], tlm[5] + nums[1]]
                    tm = list(tlm)
            elif op == b"TD":
                nums = [x[1] for x in stack if x[0] == "num"][-2:]
                if len(nums) == 2:
                    tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + nums[0], tlm[5] + nums[1]]
                    tm = list(tlm)
            elif op == b"Tm":
                nums = [x[1] for x in stack if x[0] == "num"][-6:]
                if len(nums) == 6:
                    tlm = list(nums); tm = list(tlm)
            elif op == b"T*":
                tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - cur_size * 1.2]
                tm = list(tlm)
            elif op in (b"Tj", b"'", b'"'):
                strs = [x[1] for x in stack if x[0] == "str"]
                if op in (b"'", b'"'):
                    tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - cur_size * 1.2]
                    tm = list(tlm)
                if strs:
                    show(strs[-1])
            elif op == b"TJ":
                prev_num = 0.0
                for k in range(len(stack)):
                    if stack[k][0] == "str":
                        show(stack[k][1])
                    elif stack[k][0] == "num":
                        # 负数 = 字距增加
                        adj = -stack[k][1] / 1000.0 * cur_size
                        tm = [tm[0], tm[1], tm[2], tm[3], tm[4] + adj, tm[5]]
            elif op == b"Do":
                names = [x[1] for x in stack if x[0] == "name"]
                if names:
                    xnum = xobjects.get(names[-1])
                    if xnum:
                        raw = pdf.get(xnum) or b""
                        if b"/Form" in raw or b"/FormType" in raw:
                            _, xc = pdf.stream_of(raw)
                            fdict = dict_body(raw, b"Font")
                            xf = parse_fonts(pdf, fdict, font_cache)
                            xo = parse_xobjects(pdf, dict_body(raw, b"XObject"))
                            mm = re.search(rb"/Matrix\s*\[([^\]]*)\]", raw)
                            xctm = list(ctm)
                            if mm:
                                nums = [float(x) for x in re.findall(rb"[-\d.]+", mm.group(1))]
                                if len(nums) == 6:
                                    xctm = mul(nums, ctm)
                            run_content(pdf, xc, xf or fonts, xo, xctm, items, page_no, font_cache, depth + 1)
        finally:
            stack = []
            idx += 1


def extract(path, maxpages=3, box_scale=1.0):
    pdf = PDF(path)
    pages = get_pages(pdf)
    out = []
    for i, page in enumerate(pages[:maxpages]):
        items = extract_page_items(pdf, page, i + 1)
        mb = re.search(rb"/MediaBox\s*\[([^\]]*)\]", page["raw"])
        if mb:
            nums = [float(x) for x in re.findall(rb"[-\d.]+", mb.group(1))]
            w, h = (nums[2] - nums[0], nums[3] - nums[1]) if len(nums) == 4 else (595.0, 842.0)
        else:
            w, h = 595.0, 842.0
        # PDF 的 y 轴向上；这里翻成"向下"（与 pdf.js viewport、屏幕坐标一致）
        for it in items:
            it["y"] = h - it["y"]
        out.append({"page": i + 1, "width": w, "height": h, "items": items})
    return out


if __name__ == "__main__":
    p = sys.argv[1]
    mp = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2].isdigit() else 2
    res = extract(p, mp)
    if "--json" in sys.argv:
        out = sys.argv[sys.argv.index("--json") + 1]
        with open(out, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False)
        print("wrote", out)
    elif "--pdfjs" in sys.argv:
        # 转成 pdf.js getTextContent() 的等价结构，供 JS 抽取器直接消费
        out = sys.argv[sys.argv.index("--pdfjs") + 1]
        pages_js = []
        for pg in res:
            styles = {}
            items_js = []
            for it in pg["items"]:
                fname = it["font"] or "unknown"
                key = "f_" + str(abs(hash(fname)) % 10 ** 8)
                styles[key] = {"fontFamily": fname, "ascent": 0.8, "descent": -0.2}
                size = it["size"]
                items_js.append({
                    "str": it["str"],
                    "dir": "ltr",
                    "width": it["w"],
                    "height": size,
                    # 注意：extract() 已把 y 翻成"向下"，这里是屏幕坐标，pageHeight 用于还原
                    "transform": [size, 0, 0, size, it["x"], it["y"]],
                    "pageHeight": pg["height"],
                    "fontName": key,
                    "hasEOL": False,
                })
            pages_js.append({
                "page": pg["page"], "width": pg["width"], "height": pg["height"],
                "styles": styles, "items": items_js,
            })
        with open(out, "w", encoding="utf-8") as f:
            json.dump(pages_js, f, ensure_ascii=False)
        print("wrote", out, "pages:", len(pages_js), "items:", sum(len(p["items"]) for p in pages_js))
    else:
        for pg in res:
            print("== page %d  %.0fx%.0f  items=%d" % (pg["page"], pg["width"], pg["height"], len(pg["items"])))
            items = sorted(pg["items"], key=lambda it: (-it["y"], it["x"]))
            for it in items[:40]:
                print("   x=%7.1f y=%7.1f sz=%4.1f w=%6.1f %-22s | %s" %
                      (it["x"], it["y"], it["size"], it["w"], it["font"][:22], it["str"][:60]))
