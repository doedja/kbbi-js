/**
 * KBBI-JS Playwright Implementation
 * 
 * This module uses the core functionality to provide a Playwright-based implementation
 * of the KBBI dictionary API. This allows for more reliable access by using a real browser
 * to bypass Cloudflare protection.
 * 
 * Requirements:
 * - npm install playwright
 */

const path = require('path');
const BrowserManager = require('./lib/browser');
const KBBIParser = require('./lib/parser');
const Utils = require('./lib/utils');
const Auth = require('./lib/auth');
const { CloudflareBlockError, NotFoundError } = require('./lib/errors');
const { KBBIScraper } = require('./scrape');

class KBBI {
  constructor(options = {}) {
    this.options = {
      headless: true,
      debug: false,
      cookiesPath: path.join(__dirname, 'data', 'kbbi-cookies.json'),
      ...options
    };
    
    this.browser = null;
    this.authenticated = false;
    this.auth = new Auth();
  }

  async lookup(word) {
    if (!word) throw new Error('No word provided');

    try {
      // Initialize browser
      this.browser = new BrowserManager({
        headless: this.options.headless,
        debug: this.options.debug
      });

      await this.browser.initBrowser();
      
      // Get authentication cookie (with rotation support)
      const cookieString = await this.auth.getCookieString();
      if (cookieString) {
        await this.browser.setCustomCookie(cookieString);
      }

      // Navigate to word page
      const url = Utils.buildUrl(word);
      const html = await this.browser.navigateTo(url);

      if (!html) {
        throw new Error('Failed to fetch page content');
      }

      // Check for Cloudflare
      const isCloudflare = await this.browser.checkCloudflare();
      if (isCloudflare) {
        if (!this.options.headless) {
          console.log('Please solve the Cloudflare challenge in the browser window...');
          await this.browser.page.waitForNavigation({ 
            waitUntil: 'domcontentloaded',
            timeout: 45000
          });
      } else {
          throw new CloudflareBlockError();
        }
      }

      // Parse the page
      const parser = new KBBIParser(html);
      this.authenticated = parser.checkAuthentication();
      const { entries, mirip } = parser.parseEntries();

      return {
            word,
        authenticated: this.authenticated,
        entries,
        mirip
      };
    } catch (error) {
      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  async scrape(word) {
    if (!word) throw new Error('No word provided');

    try {
      const scraper = new KBBIScraper({
        headless: this.options.headless,
        debug: this.options.debug,
        timeout: 45000,
        stealth: true,
        auth: this.auth // Pass auth object for cookie rotation
      });

      return await scraper.scrapeWord(word);
    } catch (error) {
      throw error;
    }
  }
}

module.exports = KBBI; 