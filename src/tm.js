/* ============================================================================
 * 灵译 · 翻译记忆 (tm.js)   © 2026 灵译 LingYi
 * ----------------------------------------------------------------------------
 * 作用：把"翻译过的段落"缓存下来，同样（或近似）的内容第二次直接复用。
 *   · 改稿再译：只翻译改动过的段落，省下大量调用
 *   · 同批文献：同一术语/句式反复出现，命中后零成本
 *   · 与术语库叠加：命中记忆的先还原术语，保证前后完全一致
 *
 * 存储：localStorage（可导出/导入 JSON 备份），带容量上限与 LRU 淘汰。
 * ==========================================================================*/
(function (root, factory) {
  const core = (typeof module === 'object' && module.exports) ? require('./core.js') : root.LingyiCore;
  const mod = factory(core);
  if (typeof module === 'object' && module.exports) module.exports = mod;
  root.LingyiTM = mod;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (core) {
  'use strict';

  const STORAGE_KEY = 'lingyi_tm_v1';
  const DEFAULT_MAX = 20000;

  /**
   * 归一化：用于"近似相同"的判定。
   *  · 压缩空白、统一全半角空格
   *  · 去掉中文字符之间多余的空格（改稿时换行/加空格不应导致缓存失效）
   */
  function normalize(s) {
    return String(s == null ? '' : s)
      .replace(/\u00a0|\u3000/g, ' ')
      .replace(/[ \t\r\n]+/g, ' ')
      .replace(/\s+([\u3000-\u303f\uff00-\uffef])/g, '$1')     // 中文标点前不留空格
      .replace(/([\u3000-\u303f\uff00-\uffef])\s+/g, '$1')     // 中文标点后不留空格
      .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2') // 汉字之间不留空格
      .trim()
      .toLowerCase();
  }

  /** 段落指纹：长度 + 归一化文本的简单哈希（避免把整段原文当 key） */
  function fingerprint(normText) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < normText.length; i++) {
      const c = normText.charCodeAt(i);
      h1 = (h1 ^ c) * 16777619 >>> 0;
      h2 = (h2 + c * (i + 1)) >>> 0;
    }
    return normText.length.toString(36) + '-' + h1.toString(36) + '-' + h2.toString(36);
  }

  const TM = {
    max: DEFAULT_MAX,
    /** 内存索引：key -> {t:译文, n:命中次数, u:最后使用序号, s:原文片段(供导出)} */
    map: null,
    _seq: 0,
    _dirty: false,

    /* -------------------------------------------------------------- 存储 */

    _load() {
      if (this.map) return this.map;
      this.map = new Map();
      try {
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(STORAGE_KEY) : null;
        if (raw) {
          const obj = JSON.parse(raw);
          const entries = obj && obj.entries ? obj.entries : {};
          for (const k of Object.keys(entries)) {
            const e = entries[k];
            this.map.set(k, { t: e.t, n: e.n || 0, u: e.u || 0, s: e.s || '', norm: e.norm || normalize(e.s || '') });
            if ((e.u || 0) > this._seq) this._seq = e.u;
          }
        }
      } catch (e) { this.map = new Map(); }
      return this.map;
    },

    /** 落盘（节流由调用方控制） */
    save(force) {
      if (!this.map) return;
      if (!this._dirty && !force) return;
      try {
        if (typeof localStorage === 'undefined') return;
        const entries = {};
        for (const [k, v] of this.map) {
          entries[k] = { t: v.t, n: v.n, u: v.u, s: (v.s || '').slice(0, 160), norm: v.norm };
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, savedAt: Date.now(), entries: entries }));
        this._dirty = false;
      } catch (e) { /* 配额满等：忽略，不影响翻译 */ }
    },

    /* -------------------------------------------------------------- 读写 */

    /** 记忆键 = 目标语言 + 文本指纹（不含引擎，便于跨引擎复用与导入导出） */
    _key(text, target) {
      return (target || '') + '|' + fingerprint(normalize(text));
    },

    /** 命中：先精确（归一化一致），再按"只差空白/标点"的宽松匹配 */
    get(text, target, engine) {
      const map = this._load();
      const norm = normalize(text);
      if (!norm) return null;

      let key = this._key(text, target);
      let hit = map.get(key);
      // 关键：指纹不同也可能只是空格差异（哈希对空白敏感），这里再做一轮宽松查找
      if (!hit) {
        for (const [k, v] of map) {
          if ((v.lang || '') !== (target || '')) continue;
          if ((v.norm || normalize(v.s || '')) === norm) { hit = v; key = k; break; }
        }
      }
      if (!hit) return null;

      const stored = hit.norm || normalize(hit.s || '');
      if (stored && stored !== norm) return null;
      hit.n++; hit.u = ++this._seq; this._dirty = true;
      return hit.t;
    },

    /** 写入一条记忆 */
    set(text, target, engine, translation) {
      const norm = normalize(text);
      if (!norm || translation == null || translation === '') return false;
      const map = this._load();
      const key = this._key(text, target);
      const old = map.get(key);
      if (old && normalize(old.t) === normalize(translation)) { old.u = ++this._seq; return false; }
      map.set(key, {
        t: String(translation), n: (old ? old.n : 0) + 1, u: ++this._seq,
        s: String(text).slice(0, 160), norm: norm, lang: target || ''
      });
      this._dirty = true;
      this._evictIfNeeded();
      return true;
    },

    _evictIfNeeded() {
      const map = this._load();
      if (map.size <= this.max) return;
      // 淘汰：使用次数少 + 最久未用的
      const arr = [...map.entries()].sort((a, b) => (a[1].n - b[1].n) || (a[1].u - b[1].u));
      const drop = map.size - this.max;
      for (let i = 0; i < drop; i++) map.delete(arr[i][0]);
    },

    /* -------------------------------------------------------------- 统计 */

    stats() {
      const map = this._load();
      let hits = 0, reuse = 0;
      for (const v of map.values()) { hits += v.n; if (v.n > 1) reuse++; }
      return { entries: map.size, hits: hits, repeated: reuse, max: this.max };
    },

    /** 清空 */
    clear() {
      this.map = new Map();
      this._seq = 0;
      this._dirty = true;
      this.save(true);
    },

    /** 导出（JSON 文本，便于备份/迁移） */
    exportJSON() {
      const map = this._load();
      const entries = [];
      for (const [, v] of map) entries.push({ s: v.s, t: v.t, n: v.n, u: v.u, norm: v.norm, lang: v.lang || '' });
      return JSON.stringify({ v: 1, exportedAt: new Date().toISOString(), entries: entries }, null, 1);
    },

    /**
     * 导入：merge=true 合并（同 key 取更新），false 覆盖
     * @returns {{added, skipped, error?}}
     */
    importJSON(json, merge) {
      let data = null;
      try { data = JSON.parse(json); } catch (e) { return { added: 0, skipped: 0, error: '不是合法的 JSON' }; }
      const list = Array.isArray(data) ? data : (data && data.entries) || [];
      if (!merge) this.clear();
      const map = this._load();
      let added = 0, skipped = 0;
      for (const e of list) {
        const src = e.s || e.src || e.source;
        const dst = e.t || e.dst || e.target;
        if (!src || !dst) { skipped++; continue; }
        const lang = e.lang || e.targetLang || '';
        const key = this._key(src, lang);
        if (map.has(key) && merge) { skipped++; continue; }
        map.set(key, {
          t: String(dst), n: e.n || 0, u: ++this._seq,
          s: String(src).slice(0, 160), norm: e.norm || normalize(String(src)), lang: lang
        });
        added++;
      }
      this._dirty = true;
      this._evictIfNeeded();
      this.save(true);
      return { added: added, skipped: skipped };
    }
  };

  return { TM, normalize, fingerprint, STORAGE_KEY };
});
