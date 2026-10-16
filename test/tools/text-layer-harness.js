/* text-layer-harness.js — 导出 PDF 文字层样本，判断文字层是否可用
 * 由 test/tools/check-text-layer.ps1 驱动。
 */
(function () {
  'use strict';
  const out = document.getElementById('result');
  const log = s => { out.textContent += s + '\n'; };

  function b64ToBytes(b64) {
    const bin = atob(b64), n = bin.length, o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = bin.charCodeAt(i);
    return o;
  }

  const CJK = /[\u4e00-\u9fff]/;
  const LATIN = /[A-Za-z]/;
  /* 启发式：正常英文文本里，空格占比约 12~20%；汉字文本则很少空格。
     乱码/编码错误的文字层常见特征是：单词被切碎、出现孤立标点、
     大量重复字符、或汉字句子里夹杂不可能的组合。 */
  function looksGarbled(items) {
    let joined = items.map(i => String(i.str)).join('');
    if (joined.length < 40) return { garbled: false, reason: '文字太少，无法判断' };
    const spaces = (joined.match(/\s/g) || []).length;
    const spaceRatio = spaces / joined.length;
    const punctOnly = items.filter(i => /^[^\w\u4e00-\u9fff]{1,3}$/.test(String(i.str).trim())).length;
    const punctRatio = punctOnly / items.length;
    const reasons = [];
    if (LATIN.test(joined) && spaceRatio < 0.06 && joined.length > 200) {
      reasons.push('英文文本里空格占比仅 ' + (spaceRatio * 100).toFixed(1) + '%（正常应 >10%，说明单词被切碎/错位）');
    }
    if (punctRatio > 0.4) {
      reasons.push('孤立标点占比 ' + (punctRatio * 100).toFixed(0) + '%（说明文字被切成碎片）');
    }
    return { garbled: reasons.length > 0, reason: reasons.join('；') };
  }

  (async function main() {
    try {
      log('== PDF 文字层检查 ==');
      log('文件: ' + (window.__PDF_NAME__ || '?'));
      if (typeof pdfjsLib === 'undefined') { log('FATAL: pdfjsLib 未加载'); done(); return; }

      const b64 = (window.__PDF_PARTS__ || []).join('');
      const bytes = b64ToBytes(b64);
      log('字节: ' + bytes.length);

      const doc = await pdfjsLib.getDocument({ data: bytes, disableWorker: true, isEvalSupported: false }).promise;
      log('页数: ' + doc.numPages);

      let totalItems = 0, cjkItems = 0, latinItems = 0, pagesWithText = 0, chars = 0;
      const pageReports = [];
      const maxP = Math.min(doc.numPages, window.__MAX_PAGES__ || 4);

      for (let p = 1; p <= maxP; p++) {
        const page = await doc.getPage(p);
        const vp = page.getViewport({ scale: 1 });
        const tc = await page.getTextContent();
        const items = tc.items.filter(it => it && it.str && String(it.str).length);
        totalItems += items.length;
        if (items.length) pagesWithText++;
        for (const it of items) {
          const s = String(it.str);
          chars += s.length;
          if (CJK.test(s)) cjkItems++;
          if (LATIN.test(s)) latinItems++;
        }
        const g = looksGarbled(items);
        pageReports.push({ page: p, items: items.length, w: Math.round(vp.width), h: Math.round(vp.height), garbled: g.garbled, reason: g.reason });

        log('');
        log('--- page ' + p + '  ' + Math.round(vp.width) + 'x' + Math.round(vp.height) + '  文字项=' + items.length + ' ---');
        const longest = items.slice().sort((a, b) => String(b.str).length - String(a.str).length)[0];
        if (longest) log('   最长片段(' + String(longest.str).length + '字符): ' + JSON.stringify(String(longest.str).slice(0, 90)));
        /* 打印前 12 个片段（带坐标），用来判断阅读顺序与碎片程度 */
        items.slice(0, 12).forEach(it => {
          const x = it.transform ? it.transform[4].toFixed(0) : '?';
          const y = it.transform ? it.transform[5].toFixed(0) : '?';
          log('   x=' + x + ' y=' + y + '  ' + JSON.stringify(String(it.str).slice(0, 56)));
        });
        if (g.garbled) log('   ⚠ ' + g.reason);
      }

      log('');
      log('== 汇总 ==');
      log('  文字项合计: ' + totalItems);
      log('  字符合计  : ' + chars);
      log('  含中文项  : ' + cjkItems + '   含拉丁项: ' + latinItems);
      log('  有文字的页: ' + pagesWithText + ' / ' + maxP);

      const badPages = pageReports.filter(r => r.garbled);
      log('');
      if (totalItems === 0) {
        log('结论: 这份 PDF 没有可用文字层（扫描件/图片型）→ 必须走 OCR');
      } else if (badPages.length >= Math.ceil(maxP / 2)) {
        log('结论: 文字层不可靠（' + badPages.length + '/' + maxP + ' 页异常）→ 翻译结果必然错乱，建议改走 OCR 或用原始 .docx');
      } else if (badPages.length) {
        log('结论: 部分页面文字层异常（' + badPages.length + '/' + maxP + '）→ 这些页面建议走 OCR');
      } else {
        log('结论: 文字层正常，排版问题应出在版式算法（可继续优化）');
      }
      log('DONE');
    } catch (e) {
      log('EXCEPTION: ' + (e && e.message ? e.message : e));
    }
    done();
  })();

  function done() { document.getElementById('result').setAttribute('data-done', '1'); }
})();
