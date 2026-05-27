/**
 * KBBI-JS
 *
 * Anonymous lookups use the built-in HTTPS stack (`fetch`). The optional
 * Playwright fallback is only loaded when the caller explicitly requests it,
 * so the package stays useful without a 130 MB Chromium download.
 */

const KBBIParser = require('./lib/parser');
const Utils = require('./lib/utils');
const Auth = require('./lib/auth');
const { HttpClient } = require('./lib/http');
const { KBBIScraper } = require('./scrape');

class KBBI {
  constructor(options = {}) {
    this.options = {
      headless: true,
      debug: false,
      timeout: 20000,
      useBrowser: false,
      ...options
    };

    this.auth = options.auth || new Auth();
  }

  async lookup(word) {
    if (!word) throw new Error('No word provided');

    if (this.options.useBrowser) {
      return this._lookupWithBrowser(word);
    }

    const http = new HttpClient({ timeout: this.options.timeout });
    const cookieValue = await this.auth.getRandomCookie();
    if (cookieValue) {
      http.jar.setRaw('.AspNet.ApplicationCookie', cookieValue);
    }

    const { ok, status, text } = await http.getText(Utils.buildUrl(word));
    if (!ok) {
      throw new Error(`KBBI returned HTTP ${status} for "${word}"`);
    }

    const parser = new KBBIParser(text);
    const authenticated = parser.checkAuthentication();
    const { entries, mirip } = parser.parseEntries();

    return {
      word,
      authenticated,
      entries,
      mirip: mirip || []
    };
  }

  async scrape(word) {
    if (!word) throw new Error('No word provided');

    const scraper = new KBBIScraper({
      headless: this.options.headless,
      debug: this.options.debug,
      timeout: this.options.timeout,
      useBrowser: this.options.useBrowser,
      silent: this.options.silent,
      auth: this.auth
    });
    return scraper.scrapeWord(word);
  }

  async _lookupWithBrowser(word) {
    const BrowserManager = require('./lib/browser');
    const { CloudflareBlockError } = require('./lib/errors');

    const browser = new BrowserManager({
      headless: this.options.headless,
      debug: this.options.debug
    });

    try {
      await browser.initBrowser();
      const cookieString = await this.auth.getCookieString();
      if (cookieString) {
        await browser.setCustomCookie(cookieString);
      }

      const html = await browser.navigateTo(Utils.buildUrl(word));
      if (!html) throw new Error('Failed to fetch page content');

      const isCloudflare = await browser.checkCloudflare();
      if (isCloudflare) {
        if (!this.options.headless) {
          await browser.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
        } else {
          throw new CloudflareBlockError();
        }
      }

      const parser = new KBBIParser(html);
      const authenticated = parser.checkAuthentication();
      const { entries, mirip } = parser.parseEntries();
      return { word, authenticated, entries, mirip: mirip || [] };
    } finally {
      await browser.close();
    }
  }
}

module.exports = KBBI;
