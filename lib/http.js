const Utils = require('./utils');

const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const DEFAULT_HEADERS = Object.freeze({
  'User-Agent': DEFAULT_UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
});

const noop = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseSetCookieHeader(header) {
  if (!header) return [];
  // Node exposes Set-Cookie as a single comma-joined string via fetch(); split
  // carefully because attribute values like `expires=Wed, 27 May` also contain
  // commas. We split only on comma+space followed by a token+`=`.
  const parts = [];
  let buf = '';
  for (let i = 0; i < header.length; i++) {
    const c = header[i];
    if (c === ',' && /\s*[\w!#$%&'*+\-.^`|~]+=/.test(header.slice(i + 1))) {
      parts.push(buf.trim());
      buf = '';
    } else {
      buf += c;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  setFromHeader(header) {
    for (const raw of parseSetCookieHeader(header)) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      if (!value) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  setRaw(name, value) {
    if (value === undefined || value === null || value === '') {
      this.cookies.delete(name);
    } else {
      this.cookies.set(name, String(value));
    }
  }

  get(name) {
    return this.cookies.get(name);
  }

  header() {
    if (this.cookies.size === 0) return null;
    return Array.from(this.cookies.entries())
      .map(([n, v]) => `${n}=${v}`)
      .join('; ');
  }
}

class HttpClient {
  constructor(options = {}) {
    this.options = {
      origin: Utils.ORIGIN,
      timeout: 20000,
      retries: 2,
      retryDelayMs: 600,
      userAgent: DEFAULT_UA,
      logger: noop,
      ...options
    };
    this.jar = options.jar || new CookieJar();
  }

  resolve(target) {
    if (/^https?:\/\//i.test(target)) return target;
    return `${this.options.origin}${target.startsWith('/') ? '' : '/'}${target}`;
  }

  async request(target, init = {}) {
    const url = this.resolve(target);
    const headers = {
      ...DEFAULT_HEADERS,
      'User-Agent': this.options.userAgent,
      ...(init.headers || {})
    };

    const jarHeader = this.jar.header();
    if (jarHeader) {
      headers['Cookie'] = headers['Cookie']
        ? `${headers['Cookie']}; ${jarHeader}`
        : jarHeader;
    }

    const finalInit = {
      method: init.method || 'GET',
      headers,
      body: init.body,
      redirect: init.redirect || 'manual'
    };

    let lastErr = null;
    for (let attempt = 0; attempt <= this.options.retries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout);
      try {
        const response = await fetch(url, { ...finalInit, signal: controller.signal });
        clearTimeout(timeoutId);
        const setCookie = response.headers.get('set-cookie');
        if (setCookie) this.jar.setFromHeader(setCookie);
        return response;
      } catch (err) {
        clearTimeout(timeoutId);
        lastErr = err;
        const isLast = attempt === this.options.retries;
        if (isLast) break;
        this.options.logger(`fetch retry ${attempt + 1}/${this.options.retries} for ${url}: ${err.message}`);
        await sleep(this.options.retryDelayMs * (attempt + 1));
      }
    }
    throw new Error(`HTTP request failed for ${url}: ${lastErr ? lastErr.message : 'unknown error'}`);
  }

  async getText(target, init = {}) {
    const response = await this.request(target, init);
    // KBBI uses 302 only on auth-gated endpoints; treat them as soft-fail so
    // callers can decide whether to follow or skip without surprise redirects.
    if (response.status >= 300 && response.status < 400) {
      return {
        ok: false,
        status: response.status,
        location: response.headers.get('location') || null,
        text: ''
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        location: null,
        text: await response.text().catch(() => '')
      };
    }
    return {
      ok: true,
      status: response.status,
      location: null,
      text: await response.text()
    };
  }
}

module.exports = { HttpClient, CookieJar, parseSetCookieHeader };
