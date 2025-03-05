const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

class BrowserManager {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.config = {
      headless: true,
      debug: false,
      timeout: 30000,
      stealth: true,
      ...options
    };
  }

  async initBrowser() {
    if (this.browser) return true;

    try {
      this.browser = await chromium.launch({
        headless: this.config.headless,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions'
        ]
      });

      this.context = await this.browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
        hasTouch: false,
        ignoreHTTPSErrors: true,
        locale: 'id-ID',
        timezoneId: 'Asia/Jakarta'
      });

      if (this.config.stealth) {
        await this._applyStealth();
      }

      this.page = await this.context.newPage();
      await this._setHeaders();

      return true;
    } catch (error) {
      console.error('Failed to initialize browser:', error);
      return false;
    }
  }

  async _applyStealth() {
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
      Object.defineProperty(navigator, 'languages', { get: () => ['id-ID', 'id', 'en-US', 'en'] });
    });
  }

  async _setHeaders() {
    await this.page.setExtraHTTPHeaders({
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Not(A:Brand";v="99", "Chromium";v="124"',
      'sec-ch-ua-mobile': '?0'
    });
  }

  async loadCookies(cookiePath) {
    if (!this.context) return false;

    try {
      if (fs.existsSync(cookiePath)) {
        const rawCookieContent = fs.readFileSync(cookiePath, 'utf8');
        const cookieData = JSON.parse(rawCookieContent);
        
        const cookies = this._parseCookieData(cookieData);
        if (cookies.length > 0) {
          await this.context.addCookies(cookies);
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error('Error loading cookies:', error);
      return false;
    }
  }

  /**
   * Sets a custom cookie string for authentication
   * This is used with the cookie rotation feature
   * 
   * @param {string} cookieString - The cookie string to set
   * @returns {Promise<boolean>} - Whether the operation was successful
   */
  async setCustomCookie(cookieString) {
    if (!this.context || !cookieString) return false;
    
    try {
      const cookies = this._parseCookieString(cookieString);
      if (cookies.length > 0) {
        await this.context.addCookies(cookies);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error setting custom cookie:', error);
      return false;
    }
  }

  _parseCookieData(cookieData) {
    const cookies = [];
    
    if (typeof cookieData === 'string') {
      return this._parseCookieString(cookieData);
    }
    
    if (cookieData && typeof cookieData === 'object') {
      for (const [name, value] of Object.entries(cookieData)) {
        cookies.push({
          name,
          value,
          domain: 'kbbi.kemdikbud.go.id',
          path: '/'
        });
      }
    }
    
    return cookies;
  }

  _parseCookieString(cookieString) {
    const cookies = [];
    const pairs = cookieString.split(';');
    
    for (const pair of pairs) {
      if (pair.includes('=')) {
        const [name, value] = pair.split('=', 2);
        cookies.push({
          name: name.trim(),
          value: value.trim(),
          domain: 'kbbi.kemdikbud.go.id',
          path: '/'
        });
      }
    }
    
    return cookies;
  }

  async saveCookies(cookiePath) {
    if (!this.context) return false;

    try {
      const cookies = await this.context.cookies();
      const cookieObj = {};
      
      cookies.forEach(c => {
        cookieObj[c.name] = c.value;
      });

      const cookieDir = path.dirname(cookiePath);
      if (!fs.existsSync(cookieDir)) {
        fs.mkdirSync(cookieDir, { recursive: true });
      }

      fs.writeFileSync(cookiePath, JSON.stringify(cookieObj, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error saving cookies:', error);
      return false;
    }
  }

  async navigateTo(url, options = {}) {
    if (!this.page) return null;

    try {
      await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.config.timeout,
        ...options
      });

      if (this.config.stealth) {
        await this.page.waitForTimeout(200);
      }

      return await this.page.content();
    } catch (error) {
      console.error('Navigation error:', error);
      return null;
    }
  }

  async checkCloudflare() {
    if (!this.page) return false;

    try {
      return await this.page.evaluate(() => {
        const title = document.title;
        const body = document.body ? document.body.innerText : '';
        
        return (
          title.includes('Cloudflare') ||
          title.includes('Attention Required') ||
          body.includes('Checking your browser') ||
          body.includes('DDoS protection') ||
          document.querySelector('#cf-error-details') !== null
        );
      });
    } catch (error) {
      return false;
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
    }
  }
}

module.exports = BrowserManager; 