/* pdf-font.js — TrueType 字体解析 + PDF 字体对象生成（无外部依赖）
 *
 * 为什么自己写：要让译文"可选中、可搜索"，PDF 里必须是真正的文字，
 * 而这必须嵌入一份中文字体（PDF 内置的 14 个基础字体没有任何中文字形）。
 * 常规做法依赖 pdf-lib + fontkit（~1.3MB），但本机网络不通，所以这里
 * 自己解析 TTF 并生成 PDF 所需的字体对象。
 *
 * 支持：TrueType（glyf）单一字体；TTC 需调用方指定 face 索引。
 * 不支持：CFF（OTTO）轮廓 —— 会在 parse 时明确报错，不静默出错。
 */
(function (root) {
  'use strict';

  function tagAt(bytes, off) {
    return String.fromCharCode(bytes[off], bytes[off + 1], bytes[off + 2], bytes[off + 3]);
  }

  /**
   * 解析 TrueType 字体，取出生成 PDF 嵌入字体所需的全部信息。
   * @param {Uint8Array} bytes
   * @param {number} [faceIndex=0] TTC 里的字体序号
   */
  function parseTtf(bytes, faceIndex) {
    const b = bytes;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const u16 = o => dv.getUint16(o);
    const i16 = o => dv.getInt16(o);
    const u32 = o => dv.getUint32(o);

    let base = 0;
    const sig = tagAt(b, 0);
    if (sig === 'ttcf') {
      /* 字体集合：按 faceIndex 找到对应字体的表目录偏移 */
      const numFonts = u32(8);
      const idx = Math.min(faceIndex || 0, numFonts - 1);
      base = u32(12 + idx * 4);
      if (tagAt(b, base) === 'OTTO') {
        throw new Error('字体是 CFF 轮廓（OTTO），本模块只支持 TrueType（glyf）轮廓。请换用 simhei.ttf / simfang.ttf 这类 .ttf 字体');
      }
    } else if (sig === 'OTTO') {
      throw new Error('字体是 CFF 轮廓（OTTO），本模块只支持 TrueType（glyf）轮廓。请换用 simhei.ttf / simfang.ttf 这类 .ttf 字体');
    } else if (u32(base) !== 0x00010000 && sig !== 'true') {
      throw new Error('不是可识别的 TrueType 字体（首 4 字节 = ' + sig + '）');
    }

    const numTables = u16(base + 4);
    const tables = {};
    for (let i = 0; i < numTables; i++) {
      const o = base + 12 + i * 16;
      const tag = tagAt(b, o);
      tables[tag] = { offset: u32(o + 8), length: u32(o + 12) };
    }
    if (!tables.head || !tables.glyf || !tables.loca || !tables.cmap || !tables.hmtx) {
      throw new Error('字体缺少必需的表（head/glyf/loca/cmap/hmtx）');
    }

    /* ---- head ---- */
    const head = tables.head.offset;
    const unitsPerEm = u16(head + 18);
    const xMin = i16(head + 36), yMin = i16(head + 38);
    const xMax = i16(head + 40), yMax = i16(head + 42);
    const indexToLoc = i16(head + 50);

    /* ---- hhea / maxp ---- */
    const hhea = tables.hhea.offset;
    const ascender = i16(hhea + 4), descender = i16(hhea + 6);
    const numHMetrics = u16(hhea + 34);
    const numGlyphs = tables.maxp ? u16(tables.maxp.offset + 4) : 0;

    /* ---- post（斜体角）---- */
    let italicAngle = 0;
    if (tables.post && tables.post.length >= 8) {
      italicAngle = dv.getInt32(tables.post.offset + 4) / 65536;
    }

    /* ---- hmtx：advanceWidth[gid] ---- */
    const hm = tables.hmtx.offset;
    const advWidth = new Array(numGlyphs);
    const lsb = new Array(numGlyphs);
    let lastAdv = 0;
    for (let g = 0; g < numGlyphs; g++) {
      if (g < numHMetrics) {
        lastAdv = u16(hm + g * 4);
        advWidth[g] = lastAdv;
        lsb[g] = i16(hm + g * 4 + 2);
      } else {
        advWidth[g] = lastAdv;
        lsb[g] = i16(hm + numHMetrics * 4 + (g - numHMetrics) * 2);   // 可能越界，忽略
      }
    }

    /* ---- cmap：unicode → gid ---- */
    const cm = parseCmap(b, dv, tables.cmap);

    /* ---- loca（字形偏移），供将来做子集化 ---- */
    const loca = [];
    const locOff = tables.loca.offset;
    if (indexToLoc === 0) {
      for (let g = 0; g <= numGlyphs; g++) loca.push(u16(locOff + g * 2) * 2);
    } else {
      for (let g = 0; g <= numGlyphs; g++) loca.push(u32(locOff + g * 4));
    }

    return {
      bytes: b,
      unitsPerEm: unitsPerEm || 1000,
      numGlyphs: numGlyphs,
      bbox: { xMin: xMin, yMin: yMin, xMax: xMax, yMax: yMax },
      ascender: ascender,
      descender: descender,
      italicAngle: italicAngle,
      advWidth: advWidth,
      lsb: lsb,
      /* 返回 gid；找不到返回 0（.notdef） */
      gidFor: function (cp) {
        const g = cm.map.get(cp);
        return (g == null || g >= numGlyphs) ? 0 : g;
      },
      /* 某 gid 的 advance（字体单位） */
      widthOf: function (gid) {
        return advWidth[gid] || 0;
      },
      loca: loca,
      tables: tables
    };
  }

  /** 解析 cmap，返回 Map<codepoint, gid>（优先 format 12，其次 format 4） */
  function parseCmap(b, dv, tbl) {
    const u16 = o => dv.getUint16(o);
    const u32 = o => dv.getUint32(o);
    const base = tbl.offset;
    const n = u16(base + 2);
    let best4 = null, best12 = null;
    const subs = [];
    for (let i = 0; i < n; i++) {
      const o = base + 4 + i * 8;
      const pid = u16(o), eid = u16(o + 2), off = u32(o + 4);
      subs.push({ pid: pid, eid: eid, off: base + off });
    }
    for (const s of subs) {
      const fmt = u16(s.off);
      if (fmt === 12) { if (!best12) best12 = s.off; }
      else if (fmt === 4) { if (!best4) best4 = s.off; }
    }
    const map = new Map();
    if (best12 != null) {
      const nGroups = u32(best12 + 12);
      for (let g = 0; g < nGroups; g++) {
        const o = best12 + 16 + g * 12;
        const start = u32(o), end = u32(o + 4), startGid = u32(o + 8);
        for (let cp = start; cp <= end && cp - start < 0x10000; cp++) {
          map.set(cp, startGid + (cp - start));
        }
      }
      if (map.size) return { map: map, format: 12 };
    }
    if (best4 != null) {
      const segX2 = u16(best4 + 6);
      const segCount = segX2 / 2;
      const endO = best4 + 14;
      const startO = endO + segX2 + 2;
      const deltaO = startO + segX2;
      const rangeO = deltaO + segX2;
      for (let s = 0; s < segCount; s++) {
        const end = u16(endO + s * 2);
        const start = u16(startO + s * 2);
        const delta = dv.getInt16(deltaO + s * 2);
        const ro = u16(rangeO + s * 2);
        if (start === 0xffff) continue;
        for (let cp = start; cp <= end && cp !== 0xffff; cp++) {
          let gid;
          if (ro === 0) {
            gid = (cp + delta) & 0xffff;
          } else {
            const gi = rangeO + s * 2 + ro + (cp - start) * 2;
            if (gi + 1 > b.length) continue;
            gid = u16(gi);
            if (gid !== 0) gid = (gid + delta) & 0xffff;
          }
          if (gid) map.set(cp, gid);
        }
      }
      return { map: map, format: 4 };
    }
    throw new Error('字体没有可用的 cmap 子表（format 4 / 12）');
  }

  /* ------------------------------------------------------ PDF 字体对象 */

  /**
   * 生成 PDF 里嵌入 TrueType 所需的对象内容（不含对象头与 xref）。
   *
   * 结构（Identity-H 编码，CIDFontType2）：
   *   /Type0 字体  →  /DescendantFonts  →  CIDFont
   *   CIDFont 里 /FontDescriptor 引用 /FontFile2（整个字体文件）
   *   /Encoding /Identity-H  → 文本用 2 字节 glyph id 表示
   *   /ToUnicode 提供 gid → unicode 映射（复制、搜索要靠它）
   *
   * @param {Object} font parseTtf 的返回值
   * @param {Map<number,number>} used Map<gid, codepoint>，只列实际用到的字
   * @returns {{ resources:string, objects:Array<{dict:string, stream?:Uint8Array}>, scale:number }}
   */
  function buildFontObjects(font, used) {
    const upm = font.unitsPerEm || 1000;
    const scale = 1000 / upm;                    // 字体单位 → PDF 千分之一 em
    const n = v => Math.round(v * scale * 1000) / 1000;

    /* /W 数组：每个用到的 gid 给一个真实 advance，避免等宽导致排版错乱 */
    const gids = [...used.keys()].sort((a, b) => a - b);
    let wArr = '';
    for (const gid of gids) {
      const w = n(font.widthOf(gid)) || 1000;
      wArr += gid + ' [' + w + '] ';
    }
    if (!wArr) wArr = '0 [1000] ';

    const bbox = [n(font.bbox.xMin), n(font.bbox.yMin), n(font.bbox.xMax), n(font.bbox.yMax)].join(' ');
    const ascent = n(font.ascender) || 880;
    const descent = n(font.descender) || -120;
    /* Flags: bit3(4)=Symbolic 置 0，用 32(Nonsymbolic)+1(FixedPitch? 不置)
       这里取 4（Symbolic），对 CJK 字体最稳：不依赖 /Encoding 的 Standard 表 */
    const flags = 4;

    const fontFile2 = font.bytes;

    const cidFont =
      '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LingyiCJK' +
      ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>' +
      ' /FontDescriptor ' + 'FDFONT' + ' 0 R' +
      ' /DW 1000 /W [' + wArr.trim() + ']' +
      ' /CIDToGIDMap /Identity >>';

    const type0 =
      '<< /Type /Font /Subtype /Type0 /BaseFont /LingyiCJK' +
      ' /Encoding /Identity-H /DescendantFonts [' + 'CIDFONT' + ' 0 R]' +
      ' /ToUnicode ' + 'TOUNI' + ' 0 R >>';

    const descriptor =
      '<< /Type /FontDescriptor /FontName /LingyiCJK /Flags ' + flags +
      ' /FontBBox [' + bbox + '] /ItalicAngle ' + (font.italicAngle || 0) +
      ' /Ascent ' + ascent + ' /Descent ' + descent +
      ' /CapHeight ' + ascent + ' /StemV 80' +
      ' /FontFile2 ' + 'FFILE' + ' 0 R >>';

    const toUni = buildToUnicode(used);

    return {
      type0: type0, cidFont: cidFont, descriptor: descriptor,
      toUnicode: toUni, fontFile2: fontFile2, scale: scale
    };
  }

  /** 生成 ToUnicode CMap：让译文可以被复制、搜索 */
  function buildToUnicode(used) {
    const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
    let body = '';
    /* 每行最多 100 条，保持文件可读且不超长 */
    for (let i = 0; i < entries.length; i += 100) {
      const slice = entries.slice(i, i + 100);
      body += slice.length + ' beginbfchar\n';
      for (const [gid, cp] of slice) {
        const src = hex4(gid);
        let dst;
        if (cp > 0xffff) {
          /* 需要代理对 */
          const v = cp - 0x10000;
          const hi = 0xd800 + (v >> 10);
          const lo = 0xdc00 + (v & 0x3ff);
          dst = hex4(hi) + hex4(lo);
        } else {
          dst = hex4(cp);
        }
        body += '<' + src + '> <' + dst + '>\n';
      }
      body += 'endbfchar\n';
    }
    const head = '/CIDInit /ProcSet findresource begin\n' +
      '12 dict begin\nbegincmap\n' +
      '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
      '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
      '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
    const tail = 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
    const text = head + body + tail;
    /* 编码为字节（Latin1 即可，全是 ASCII） */
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    return bytes;
  }

  function hex4(n) {
    return (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  }

  /** 把一段字符串转成 Identity-H 的十六进制串（每个字 2 字节 gid） */
  function encodeText(font, text, used) {
    let out = '';
    for (const ch of String(text || '')) {
      const cp = ch.codePointAt(0);
      let gid = font.gidFor(cp);
      if (!gid) gid = font.gidFor(0x3000);        // 缺字兜底：全角空格
      if (!gid) gid = 0;
      if (gid) used.set(gid, cp);
      out += hex4(gid);
    }
    return out;
  }

  /** 用字体真实 advance 计算文本宽度（PDF 用户单位，即 pt） */
  function textWidth(font, text, size, used) {
    let w = 0;
    for (const ch of String(text || '')) {
      const cp = ch.codePointAt(0);
      let gid = font.gidFor(cp);
      if (!gid) gid = font.gidFor(0x3000) || 0;
      if (gid && used) used.set(gid, cp);
      w += font.widthOf(gid) || font.unitsPerEm * 0.5;
    }
    return w / font.unitsPerEm * size;
  }

  root.LingyiPdfFont = {
    parseTtf: parseTtf,
    buildFontObjects: buildFontObjects,
    buildToUnicode: buildToUnicode,
    encodeText: encodeText,
    textWidth: textWidth,
    hex4: hex4
  };
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
