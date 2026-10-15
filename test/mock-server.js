/* mock-server.js — 本地模拟翻译后端，用于离线测试整条链路
 * 运行：node test/mock-server.js            （默认端口 8787）
 * 然后把界面「翻译服务设置」里的地址填成：http://localhost:8787
 *
 * 它会：
 *   · 实现与真实云函数完全相同的请求/响应协议
 *   · 校验 ⟦n⟧ 分段标记与 ⟦P0⟧/⟦T1⟧ 占位符是否被完整保留
 *   · 用一个内置小词典做"假翻译"（保证可复现、不花钱、不联网）
 *   · 在控制台打印每次请求的统计，方便你判断前端行为是否正确
 */
'use strict';
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 8787;

/* 内置小词典：够看清"翻译确实发生了"，又不会掩盖结构问题 */
const DICT = [
  ['摘要', 'Abstract'], ['关键词', 'Keywords'], ['参考文献', 'References'],
  ['引言', 'Introduction'], ['结果', 'Results'], ['讨论', 'Discussion'], ['结论', 'Conclusion'],
  ['对象与方法', 'Subjects and methods'], ['研究对象', 'Study subjects'], ['统计学方法', 'Statistical methods'],
  ['不育男性', 'infertile men'], ['精子', 'sperm'], ['精液', 'semen'],
  ['年龄', 'age'], ['例', ' cases'], ['组', ' group'], ['表', 'Table '], ['图', 'Figure '],
  ['变量', 'Variable'], ['中位数', 'median'], ['标准差', 'SD'],
  ['本文', 'This study'], ['研究', 'study'], ['分析', 'analysis'], ['显著', 'significant']
];

function fakeTranslate(text) {
  let t = text;
  for (const [zh, en] of DICT) t = t.split(zh).join(en);
  return t;
}

/** 与真实云函数一致：保留 ⟦n⟧ 与 ⟦P/Tn⟧，只翻译其余文字 */
function translatePayload(payload) {
  const segRe = /\u27e6\s*(\d+)\s*\u27e7([\s\S]*?)\u27e6\s*\d+\s*\u27e7/g;
  const stat = { segs: 0, placeholders: 0, missing: [] };
  const out = payload.replace(segRe, (m, n, inner) => {
    stat.segs++;
    // 占位符原样保留（真实引擎也应如此）
    const phs = [];
    const kept = inner.replace(/\u27e6([PT])(\d+)\u27e7/g, (mm) => { phs.push(mm); stat.placeholders++; return '\u0001' + (phs.length - 1) + '\u0001'; });
    let translated = fakeTranslate(kept);
    translated = translated.replace(/\u0001(\d+)\u0001/g, (mm, i) => phs[+i]);
    // 自检：原文里的占位符必须都还在
    for (const ph of phs) if (translated.indexOf(ph) < 0) stat.missing.push(ph);
    return '\u27e6' + n + '\u27e7' + translated + '\u27e6' + n + '\u27e7';
  });
  return { out: out, stat: stat };
}

const server = http.createServer((req, res) => {
  const u = url.parse(req.url);
  // 允许浏览器跨域调用（本地测试用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { }

    // 健康检查 / 界面上的"测试连接"按钮
    if (!body.text) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ code: 0, result: '(mock) 服务正常' }));
      return;
    }

    const engine = body.engine || 'tencent';
    if (engine === 'deepseek') {
      // 模拟"AI 模式"：延迟更久、并检查 system 提示词是否传进来了
      console.log(`[AI模式] 收到 ${body.text.length} 字符，system 提示词: ${body.system ? body.system.length + ' 字符 ✓' : '未传 ✗'}`);
    }
    const { out, stat } = translatePayload(body.text);
    const result = { code: 0, result: out };
    // 可选：把占位符丢失情况回传（真实后端如果实现了，前端会告警）
    if (stat.missing.length) result.missingMarkers = stat.missing;

    console.log(`[${engine}] 片段 ${stat.segs} 个 / 占位符 ${stat.placeholders} 个 / 丢失 ${stat.missing.length} 个 / 返回 ${out.length} 字符`);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  });
});

server.listen(PORT, () => {
  console.log('====================================================');
  console.log('  灵译 · 本地模拟后端已启动');
  console.log('====================================================');
  console.log('  地址: http://localhost:' + PORT);
  console.log('');
  console.log('  用法：打开 index.html → ⚙️ 翻译服务设置 → 填入上面的地址');
  console.log('  然后上传一个文件，点「翻译」。');
  console.log('');
  console.log('  控制台会打印每次请求的片段数/占位符数，用来判断：');
  console.log('    · 分段标记 ⟦n⟧ 是否完整');
  console.log('    · 符号占位符 ⟦P0⟧ / 术语占位符 ⟦T1⟧ 是否被引擎保留');
  console.log('    · AI 模式的 system 提示词是否传到了后端');
  console.log('');
  console.log('  停止：Ctrl + C');
});
