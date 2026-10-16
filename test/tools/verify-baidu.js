/* verify-baidu.js — 本地直接验证百度翻译密钥是否正确（不经过云函数）
 * 用法:
 *   node test/tools/verify-baidu.js <APPID> <密钥>
 *
 * 百度翻译开放平台通用文本翻译：
 *   接口 https://fanyi-api.baidu.com/api/trans/vip/translate
 *   签名 md5(appid + q + salt + key)
 *
 * 常见错误码：
 *   52003 UNAUTHORIZED USER    → APPID 不存在 或 与密钥不匹配（多半是拿错了平台）
 *   54001 Invalid Sign         → 密钥错误
 *   54003 频率限制             → 免费版 QPS=1，稍后重试
 *   54004 余额不足             → 免费额度用完
 *   58000 IP 不在白名单        → 控制台开了 IP 白名单
 */
'use strict';
const crypto = require('crypto');

const APPID = process.argv[2];
const KEY = process.argv[3];

if (!APPID || !KEY) {
  console.log('用法: node test/tools/verify-baidu.js <APPID> <密钥>');
  process.exit(1);
}

console.log('APPID : ' + APPID);
console.log('密钥  : ' + (KEY.length > 8 ? KEY.slice(0, 4) + '****' + KEY.slice(-4) : '****') + '  (长度 ' + KEY.length + ')');
console.log('');

/* 形态检查：百度翻译开放平台的 APPID 是纯数字 */
const looksNumeric = /^\d+$/.test(APPID);
console.log('形态检查：');
console.log('  APPID 是否纯数字           : ' + (looksNumeric ? '是 ✓' : '否 ✗  ← 百度翻译开放平台的 APPID 是纯数字'));
console.log('  密钥长度是否为 32           : ' + (KEY.length === 32 ? '是 ✓' : '否（实际 ' + KEY.length + '）'));
console.log('');

const q = '共纳入 4441 例患者，P<0.001。';
const salt = String(Date.now());
const sign = crypto.createHash('md5').update(APPID + q + salt + KEY).digest('hex');
const url = 'https://fanyi-api.baidu.com/api/trans/vip/translate'
  + '?q=' + encodeURIComponent(q)
  + '&from=auto&to=en'
  + '&appid=' + encodeURIComponent(APPID)
  + '&salt=' + salt
  + '&sign=' + sign;

(async () => {
  console.log('正在请求百度翻译接口 …');
  try {
    const res = await fetch(url);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { }
    console.log('  HTTP ' + res.status);
    console.log('  原文: ' + q);
    console.log('  返回: ' + text.slice(0, 400));
    console.log('');
    if (data && !data.error_code) {
      console.log('  ✓✓ 密钥有效！译文: ' + JSON.stringify(data.trans_result && data.trans_result[0] && data.trans_result[0].dst));
    } else if (data && data.error_code) {
      const hints = {
        '52003': 'APPID 不存在或与密钥不匹配。最可能的原因：你用的是「百度智能云 / 千帆」的 API Key，' +
          '而不是「百度翻译开放平台 fanyi-api.baidu.com」的 APPID+密钥。这两个平台不通用。',
        '54001': '签名错误 → 密钥（BAIDU_APP_KEY）填错了。',
        '54003': '访问频率受限 → 免费版 QPS=1，等一秒重试即可。',
        '54004': '账户余额不足 → 免费额度用完，或未开通「通用文本翻译」。',
        '58000': '客户端 IP 不在白名单 → 到百度翻译控制台关闭 IP 白名单，或把云函数出口 IP 加入。',
        '58001': '译文语言方向不支持。',
        '58002': '服务已关闭 → 到控制台确认「通用文本翻译」处于开启状态。'
      };
      console.log('  ✗ 失败：' + data.error_code + ' ' + (data.error_msg || ''));
      if (hints[String(data.error_code)]) console.log('  → ' + hints[String(data.error_code)]);
    }
  } catch (e) {
    console.log('  请求失败: ' + e.message);
  }
})();
