'use strict';
/**
 * 灵译 · 翻译云函数（腾讯云 SCF / Node.js 18+）
 * ---------------------------------------------------------------------------
 * 引擎路由（由请求体 engine 决定）：
 *   tencent  → 腾讯云机器翻译（便宜、快、通用质量）
 *   baidu    → 百度翻译开放平台（新增；100 万字符终身免费，学术质量通常好于通用 MT）
 *   deepseek → DeepSeek 大模型翻译（质量最好，按 token 计费）
 *   reformat → 仅排版（不翻译）
 *
 * 环境变量（全部在「函数配置 → 环境变量」里设置，绝不写进代码）：
 *   TMT_SECRET_ID / TMT_SECRET_KEY    腾讯云 API 密钥
 *   BAIDU_APP_ID / BAIDU_APP_KEY      百度翻译开放平台 APPID / 密钥
 *   DEEPSEEK_API_KEY                  DeepSeek API Key
 *   DEFAULT_ENGINE                    可选，默认引擎（默认 tencent）
 *   BAIDU_QPS_MS                      可选，百度免费版限 QPS=1，默认 1100 毫秒间隔
 *
 * 请求：POST { text, target, engine, system?, mode? }
 * 响应：200 { code: 0, result }        失败：{code:-1, result: '错误信息'}
 *
 * 重要：本函数只做「翻译」，不做重排。文本里的 ⟦n⟧（分段标记）、
 *       ⟦P0⟧（符号占位符）、⟦T1⟧（术语占位符）必须原样保留，
 *       翻译前会校验、翻译后会复核，异常直接报错让前端兜底，
 *       避免出现「符号丢失但看起来成功」的静默错误。
 */
const axios = require('axios');
const crypto = require('crypto');

/* ==================== 腾讯云机器翻译 ==================== */
const HOST = 'tmt.tencentcloudapi.com';
const SERVICE = 'tmt';
const ACTION = 'TextTranslate';
const VERSION = '2018-03-21';
const REGION = 'ap-guangzhou';

function getSignature(secretId, secretKey, payload, timestamp) {
    const headers = {
        'Content-Type': 'application/json',
        'Host': HOST,
        'X-TC-Action': ACTION,
        'X-TC-Version': VERSION,
        'X-TC-Timestamp': timestamp,
        'X-TC-Region': REGION,
    };
    const method = 'POST';
    const canonicalHeaders = 'content-type:application/json\nhost:' + HOST + '\n';
    const signedHeaders = 'content-type;host';
    const hashedRequestPayload = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const canonicalRequest = method + '\n' + '/' + '\n' + '' + '\n' + canonicalHeaders + '\n' + signedHeaders + '\n' + hashedRequestPayload;
    const dateStr = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const credentialScope = dateStr + '/' + SERVICE + '/tc3_request';
    const stringToSign = 'TC3-HMAC-SHA256\n' + timestamp + '\n' + credentialScope + '\n' + crypto.createHash('sha256').update(canonicalRequest).digest('hex');
    const kDate = crypto.createHmac('sha256', 'TC3' + secretKey).update(dateStr).digest();
    const kService = crypto.createHmac('sha256', kDate).update(SERVICE).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('tc3_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    headers['Authorization'] = 'TC3-HMAC-SHA256 Credential=' + secretId + '/' + credentialScope +
        ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;
    return headers;
}

async function callTencent(text, target) {
    const secretId = process.env.TMT_SECRET_ID;
    const secretKey = process.env.TMT_SECRET_KEY;
    if (!secretId || !secretKey) throw new Error('腾讯云密钥未配置（TMT_SECRET_ID / TMT_SECRET_KEY）');

    const timestamp = Math.floor(Date.now() / 1000);
    const payload = { SourceText: text.substring(0, 6000), Source: 'auto', Target: target, ProjectId: 0 };
    const headers = getSignature(secretId, secretKey, payload, timestamp);
    const response = await axios.post('https://' + HOST, payload, { headers });

    if (response.data && response.data.Response && response.data.Response.Error) {
        throw new Error(response.data.Response.Error.Message);
    }
    let targetText = (response.data && response.data.Response && response.data.Response.TargetText) || '';
    try {
        const json = JSON.parse(targetText);
        if (json.文本) targetText = json.文本;
        else if (json.text) targetText = json.text;
    } catch (e) { }
    return targetText;
}

/* ==================== 百度翻译开放平台 ====================
 * 申请：https://fanyi-api.baidu.com/  → 管理控制台 → 开发者信息
 * 免费额度：通用文本翻译 100 万字符/终身（标准版）
 * 限制：免费版 QPS = 1（每秒 1 次），所以下面做了串行节流
 * 文档：https://fanyi-api.baidu.com/doc/21
 */
const BAIDU_LANG = {
    'zh': 'zh', 'zh-CN': 'zh', 'zh-TW': 'cht', 'zh-HK': 'cht',
    'en': 'en', 'ja': 'jp', 'jp': 'jp', 'ko': 'kor', 'kor': 'kor',
    'fr': 'fra', 'de': 'de', 'es': 'spa', 'ru': 'ru', 'pt': 'pt',
    'it': 'it', 'ar': 'ara', 'th': 'th', 'vi': 'vie', 'nl': 'nl',
    'pl': 'pl', 'ro': 'rom', 'el': 'el', 'hu': 'hu', 'cs': 'cs',
    'sv': 'swe', 'da': 'dan', 'fi': 'fin', 'bg': 'bul', 'et': 'est',
    'he': 'heb', 'hi': 'hi', 'id': 'id', 'ms': 'may', 'sk': 'sk',
    'sl': 'slo', 'tr': 'tr', 'uk': 'ukr', 'fa': 'per'
};

/** 百度免费版限 QPS=1，用时间戳把请求串起来，保证两次调用间隔 >= BAIDU_QPS_MS */
let baiduLastCall = 0;
async function baiduThrottle() {
    const gap = parseInt(process.env.BAIDU_QPS_MS || '1100', 10);
    const wait = baiduLastCall + gap - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    baiduLastCall = Date.now();
}

async function callBaidu(text, target) {
    const appid = process.env.BAIDU_APP_ID;
    const key = process.env.BAIDU_APP_KEY;
    if (!appid || !key) throw new Error('百度翻译密钥未配置（BAIDU_APP_ID / BAIDU_APP_KEY）');

    const to = BAIDU_LANG[String(target).toLowerCase()] || BAIDU_LANG[target] || 'en';
    const q = text.substring(0, 1900);          // 百度单次上限约 2000 字节
    const salt = String(Date.now()) + Math.floor(Math.random() * 1000);
    const sign = crypto.createHash('md5').update(appid + q + salt + key).digest('hex');

    await baiduThrottle();                      // 遵守免费版 QPS 限制

    const res = await axios.get('https://fanyi-api.baidu.com/api/trans/vip/translate', {
        params: { q, from: 'auto', to, appid, salt, sign },
        timeout: 20000
    });

    const d = res.data || {};
    if (d.error_code) {
        const hint = d.error_code === '54003' ? '（调用频率超限：把环境变量 BAIDU_QPS_MS 调大，如 2000）'
            : d.error_code === '54001' ? '（签名错误：检查 BAIDU_APP_ID / BAIDU_APP_KEY）'
                : d.error_code === '54004' ? '（账户余额不足）'
                    : '';
        throw new Error('百度翻译错误 ' + d.error_code + ': ' + (d.error_msg || '') + hint);
    }
    if (!Array.isArray(d.trans_result)) throw new Error('百度翻译返回格式异常');
    return d.trans_result.map(r => r.dst).join('\n');
}

/* ==================== DeepSeek 大模型翻译 ==================== */
const LANG_NAME = {
    'zh-CN': 'Chinese', 'zh': 'Chinese', 'en': 'English', 'ja': 'Japanese',
    'ko': 'Korean', 'fr': 'French', 'de': 'German', 'es': 'Spanish',
    'ru': 'Russian', 'pt': 'Portuguese', 'it': 'Italian', 'ar': 'Arabic',
    'th': 'Thai', 'vi': 'Vietnamese'
};

/** 所有引擎共用：必须原样保留的标记 */
const MARKER_RE = /\u27e6\s*\d+\s*\u27e7|\u27e6[PT]\d+\u27e7/g;

function countMarkers(s) {
    const m = String(s || '').match(MARKER_RE);
    return m ? m.length : 0;
}

/**
 * 校验译文里的标记是否与原文一致。
 * 这是防止「AI 擅自改写占位符导致排版/符号错乱」的关键一关。
 */
function markerReport(src, out) {
    const srcMarks = String(src || '').match(MARKER_RE) || [];
    const outMarks = String(out || '').match(MARKER_RE) || [];
    const missing = [];
    const used = new Array(outMarks.length).fill(false);
    for (const sm of srcMarks) {
        let found = -1;
        for (let i = 0; i < outMarks.length; i++) {
            if (!used[i] && outMarks[i] === sm) { found = i; break; }
        }
        if (found >= 0) used[found] = true;
        else missing.push(sm);
    }
    return { srcCount: srcMarks.length, outCount: outMarks.length, missing };
}

const SYSTEM_PROMPT_BASE = (langName) => `You are a professional academic translator. Translate the text into ${langName}.

CRITICAL RULES - the system WILL BREAK if you violate them:
1. The text contains segment markers like \u27e6\u200a12\u200b\u27e7...\u27e6\u200a12\u200b\u27e7. Every marker MUST appear in your output, with the SAME numbers, in the SAME order, and the SAME count. Never merge, split, renumber, translate or delete them.
2. The text also contains placeholders like \u27e6P0\u27e7, \u27e6P1\u27e7 (numbers, units, statistics, superscripts, citations) and \u27e6T0\u27e7 (glossary terms). Copy them EXACTLY, character for character, at the same position. Never translate or rewrite them.
3. The input has ONE paragraph per segment. Do not merge segments, do not add markdown headings, do not add bullet points, do not rewrite the structure. Output plain text only.
4. Keep academic register, terminology consistency and standard abbreviations (DNA, BMI, CI, OR, DFI...).
5. Output ONLY the translated text. No explanations, no notes, no markdown fences.`;

async function callDeepSeek(text, target, systemOverride) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DeepSeek API Key 未配置（DEEPSEEK_API_KEY）');

    const langName = LANG_NAME[target] || target;
    const systemPrompt = systemOverride && String(systemOverride).trim()
        ? String(systemOverride)
        : SYSTEM_PROMPT_BASE(langName);

    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text }
            ],
            temperature: 0.1,
            max_tokens: 8000
        })
    });

    const data = await res.json();
    if (data.error) throw new Error('DeepSeek: ' + (data.error.message || JSON.stringify(data.error)));
    const out = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!out) throw new Error('DeepSeek 返回格式异常');
    return out;
}

/** 仅排版（保留给未来使用；当前前端已改为程序保版式，不再依赖它） */
async function callDeepSeekReformat(text, target) {
    return callDeepSeek(text, target,
        `You are a professional academic formatter. The text is already translated into ${LANG_NAME[target] || target}. Do NOT translate again, only clean up the structure minimally. ` +
        `Keep every \u27e6n\u27e7, \u27e6Pn\u27e7 and \u27e6Tn\u27e7 marker exactly as-is, same numbers and order. Output plain text only.`);
}

/* ==================== 引擎调度 ==================== */
async function route(engine, text, target, system) {
    switch (engine) {
        case 'deepseek': return await callDeepSeek(text, target, system);
        case 'reformat': return await callDeepSeekReformat(text, target);
        case 'baidu': return await callBaidu(text, target);
        case 'tencent':
        default: return await callTencent(text, target);
    }
}

/** 引擎失败时自动降级：baidu/deepseek 挂了就用腾讯云兜底，尽量不让用户白等 */
function fallbackChain(engine) {
    const chain = [engine];
    if (engine !== 'tencent') chain.push('tencent');
    return chain;
}

/* ==================== 云函数主入口 ==================== */
exports.main_handler = async (event, context) => {
    // 统一响应：带上 CORS 头，方便网页端（file:// 或 GitHub Pages）直接调用
    const CORS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8'
    };
    const reply = (statusCode, obj) => ({ statusCode, headers: CORS, body: JSON.stringify(obj) });

    // 预检请求
    const method = (event.httpMethod || (event.requestContext && event.requestContext.httpMethod) || 'POST').toUpperCase();
    if (method === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };

    let body = event.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {
            return reply(400, { code: -1, result: '请求体不是有效的JSON' });
        }
    }
    body = body || {};

    // 健康检查 / 前端的"测试连接"按钮（没有 text 时返回服务状态）
    const text = body.text || '';
    if (!text) {
        const has = {
            tencent: !!(process.env.TMT_SECRET_ID && process.env.TMT_SECRET_KEY),
            baidu: !!(process.env.BAIDU_APP_ID && process.env.BAIDU_APP_KEY),
            deepseek: !!process.env.DEEPSEEK_API_KEY
        };
        const ready = Object.keys(has).filter(k => has[k]);
        return reply(200, {
            code: 0,
            result: '服务正常。已配置引擎：' + (ready.length ? ready.join(', ') : '无'),
            engines: has
        });
    }

    const target = body.target || 'zh';
    const requested = body.engine || process.env.DEFAULT_ENGINE || 'tencent';
    const system = body.system;

    const srcMarkers = countMarkers(text);
    const errors = [];

    for (const engine of fallbackChain(requested)) {
        try {
            let out = await route(engine, text, target, system);

            // 标记复核：占位符/分段标记不许丢（这是排版与符号的生命线）
            const rep = markerReport(text, out);
            if (rep.missing.length) {
                errors.push(`${engine} 丢失标记 ${rep.missing.length} 个（如 ${rep.missing.slice(0, 3).join(' ')}）`);
                continue;   // 换下一个引擎重试
            }
            if (srcMarkers > 0 && rep.srcCount !== rep.outCount) {
                errors.push(`${engine} 标记数量不一致（原 ${rep.srcCount} → 译 ${rep.outCount}）`);
                continue;
            }

            return reply(200, {
                code: 0,
                result: out,
                engine,
                markers: { src: rep.srcCount, out: rep.outCount }
            });
        } catch (err) {
            errors.push(`${engine}: ${err.message}`);
            console.error(`[${engine}] 失败:`, err.message);
        }
    }

    return reply(500, { code: -1, result: '所有引擎均失败 → ' + errors.join(' | ') });
};
