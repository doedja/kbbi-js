const path = require('path');
const fs = require('fs');
const { AuthenticationError } = require('./errors');
const Utils = require('./utils');
const { HttpClient } = require('./http');

class Auth {
  constructor(options = {}) {
    this.options = {
      cookiesPath: path.join(__dirname, '..', 'data', 'kbbi-cookies.json'),
      legacyCookiePath: path.join(__dirname, '..', 'data', 'kbbi-cookie.json'),
      ...options
    };

    Utils.ensureDirectory(path.dirname(this.options.cookiesPath));
    this.migrateLegacyCookie();
  }

  migrateLegacyCookie() {
    try {
      if (!fs.existsSync(this.options.legacyCookiePath)) return;
      const legacy = JSON.parse(fs.readFileSync(this.options.legacyCookiePath, 'utf8'));
      if (legacy && legacy['.AspNet.ApplicationCookie']) {
        this.addCookie(legacy['.AspNet.ApplicationCookie']);
        fs.unlinkSync(this.options.legacyCookiePath);
        console.log('Migrated legacy cookie to new format');
      }
    } catch (error) {
      console.error('Error migrating legacy cookie:', error.message);
    }
  }

  /**
   * Login to KBBI with email and password.
   * Uses a plain HTTPS POST: KBBI's login form is standard ASP.NET MVC with
   * an anti-forgery cookie+token pair, no captcha or JS challenge.
   */
  async login(email, password) {
    if (!email || !password) {
      throw new AuthenticationError('Email and password are required');
    }

    const http = new HttpClient({ timeout: 30000 });

    // Step 1: GET the login page so the server hands us its anti-forgery
    // cookie. The matching hidden form token is parsed out of the response.
    const formPage = await http.getText(Utils.LOGIN_URL);
    if (!formPage.ok) {
      throw new AuthenticationError(`Login page HTTP ${formPage.status}`);
    }
    const tokenMatch = formPage.text.match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/i)
      || formPage.text.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
    if (!tokenMatch) {
      throw new AuthenticationError('Could not locate anti-forgery token on login page');
    }
    const formToken = tokenMatch[1];

    // Step 2: POST credentials. KBBI expects URL-encoded form fields with
    // the Posel/KataSandi names plus the anti-forgery token.
    const body = new URLSearchParams({
      __RequestVerificationToken: formToken,
      Posel: email,
      KataSandi: password,
      IngatSaya: 'true'
    });
    body.append('IngatSaya', 'false');

    const response = await http.request(Utils.LOGIN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': Utils.LOGIN_URL,
        'Origin': Utils.ORIGIN
      },
      body: body.toString()
    });

    const aspNetCookie = http.jar.get('.AspNet.ApplicationCookie');
    if (!aspNetCookie) {
      const bodyText = await response.text().catch(() => '');
      if (/Posel atau kata sandi tidak benar|password yang Anda masukkan tidak valid|Invalid login attempt/i.test(bodyText)) {
        throw new AuthenticationError('Invalid email or password');
      }
      throw new AuthenticationError(`Login failed (HTTP ${response.status})`);
    }

    await this.addCookie(aspNetCookie);
    return true;
  }

  async manageCookies(options = {}) {
    const { action, value } = options;
    if (!action) throw new Error('Cookie management action is required');

    switch (action.toLowerCase()) {
      case 'add': {
        if (!value) throw new Error('Cookie value is required for add action');
        await this.addCookie(value);
        const count = (await this.listCookies()).cookies.length;
        return { success: true, action: 'add', count };
      }
      case 'delete': {
        if (!value) throw new Error('Cookie value is required for delete action');
        const removed = await this.removeCookie(value);
        return { success: removed, action: 'delete' };
      }
      case 'list':
        return this.listCookies();
      default:
        throw new Error(`Unknown cookie management action: ${action}`);
    }
  }

  async addCookie(cookieValue) {
    if (!cookieValue) throw new Error('Cookie value is required');

    let value = cookieValue;
    if (cookieValue.includes('=')) {
      const matches = cookieValue.match(/(?:^|\s)\.AspNet\.ApplicationCookie=([^;]+)/);
      if (matches && matches[1]) value = matches[1];
    }

    let cookies = this.loadCookiesSync();
    if (!cookies.includes(value)) cookies.push(value);
    fs.writeFileSync(this.options.cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
    return true;
  }

  async removeCookie(cookieValue) {
    if (!cookieValue) throw new Error('Cookie value is required');
    if (!fs.existsSync(this.options.cookiesPath)) return false;

    let cookies = this.loadCookiesSync();
    const initialLength = cookies.length;
    cookies = cookies.filter((c) => c !== cookieValue);

    if (initialLength === cookies.length && cookieValue.length > 10) {
      const prefix = cookieValue.substring(0, 10);
      cookies = cookies.filter((c) => !c.startsWith(prefix));
    }

    const removed = initialLength > cookies.length;
    fs.writeFileSync(this.options.cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
    return removed;
  }

  async listCookies() {
    const cookies = this.loadCookiesSync();
    const maskedCookies = cookies.map((cookie) => {
      if (!cookie || cookie.length <= 10) return cookie || '(invalid cookie)';
      return cookie.substring(0, 5) + '...' + cookie.substring(cookie.length - 5);
    });
    return { cookies, maskedCookies, count: cookies.length };
  }

  async getRandomCookie() {
    const { cookies } = await this.listCookies();
    if (!cookies || cookies.length === 0) return null;
    const randomIndex = Math.floor(Math.random() * cookies.length);
    return cookies[randomIndex];
  }

  loadCookiesSync() {
    try {
      if (!fs.existsSync(this.options.cookiesPath)) return [];
      const data = fs.readFileSync(this.options.cookiesPath, 'utf8');
      const cookies = JSON.parse(data);
      return Array.isArray(cookies) ? cookies : [];
    } catch (error) {
      console.error('Error loading cookies:', error.message);
      return [];
    }
  }

  async loadCookies() {
    return this.loadCookiesSync();
  }

  async getCookieString() {
    const cookie = await this.getRandomCookie();
    if (!cookie) return null;
    return `.AspNet.ApplicationCookie=${cookie}`;
  }
}

module.exports = Auth;
