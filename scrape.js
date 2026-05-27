/**
 * KBBI-JS Scraper
 *
 * Fetches an entry page and (when authenticated) follows the per-eid Details
 * endpoint to fold in edit metadata. Uses native HTTPS by default. The
 * Playwright fallback is loaded lazily only when `useBrowser` is requested.
 */

const chalk = require('chalk');
const KBBIParser = require('./lib/parser');
const Utils = require('./lib/utils');
const Auth = require('./lib/auth');
const { HttpClient } = require('./lib/http');

const DETAIL_CONCURRENCY = 3;
const DETAIL_DELAY_MS = 250;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class KBBIScraper {
  constructor(options = {}) {
    this.options = {
      headless: true,
      debug: false,
      timeout: 20000,
      useBrowser: false,
      silent: false,
      ...options
    };

    this.auth = this.options.auth || new Auth();
  }

  log(...args) {
    if (!this.options.silent) console.log(...args);
  }

  async scrapeWord(word) {
    if (!word) throw new Error('No word provided');

    if (this.options.useBrowser) {
      return this._scrapeWithBrowser(word);
    }

    const http = new HttpClient({ timeout: this.options.timeout });
    const cookieValue = await this.auth.getRandomCookie();
    if (cookieValue) {
      http.jar.setRaw('.AspNet.ApplicationCookie', cookieValue);
    }

    this.log(chalk.bold.blue('\n=== PHASE 1: Finding Entries ==='));
    const url = Utils.buildUrl(word);
    this.log(`Searching for word: "${word}" at ${url}\n`);

    const { ok, status, text } = await http.getText(url);
    if (!ok) throw new Error(`KBBI returned HTTP ${status} for "${word}"`);

    const parser = new KBBIParser(text);
    const authenticated = parser.checkAuthentication();
    const { entries, mirip } = parser.parseEntries();

    if (entries.length === 0) {
      this.log(chalk.yellow('No entries found.'));
      if (mirip && mirip.length > 0) {
        this.log(chalk.yellow('Mirip:'));
        mirip.forEach((s) => this.log(chalk.cyan(`  • ${s}`)));
      }
      return { word, authenticated, entries: [], mirip: mirip || [] };
    }

    if (!authenticated) {
      this.log(chalk.gray('Skipping detail fetch: not authenticated (login adds etymology and edit metadata).'));
      return { word, authenticated: false, entries, mirip: mirip || [] };
    }

    this.log(chalk.bold.blue('\n=== PHASE 2: Fetching Details ==='));
    this.log(`Found ${entries.length} entries, fetching details...\n`);

    const merged = await this._fetchDetails(http, entries, authenticated);

    this.log(chalk.bold.blue('\n=== PHASE 3: Summary ==='));
    this.log(`Total entries found: ${entries.length}`);
    this.log(`Details fetched: ${merged.filter((e) => e.makna && e.makna.length > 0).length}`);
    this.log(`Authentication status: ${chalk.green('Yes')}`);

    return { word, authenticated: true, entries: merged, mirip: mirip || [] };
  }

  async _fetchDetails(http, entries, authenticated) {
    const out = new Array(entries.length);
    let cursor = 0;

    const worker = async () => {
      while (cursor < entries.length) {
        const idx = cursor++;
        const entry = entries[idx];
        if (!entry || !entry.id) {
          out[idx] = entry;
          continue;
        }
        const detailsUrl = Utils.buildDetailsUrl(entry.id);
        this.log(`Fetching details for "${entry.nama}${entry.nomor ? ' ' + entry.nomor : ''}" (ID: ${entry.id})`);
        const { ok, status, text } = await http.getText(detailsUrl);
        if (!ok) {
          this.log(chalk.red(`Details HTTP ${status} for ${entry.id}`));
          out[idx] = entry;
          continue;
        }
        const detailsParser = new KBBIParser(text, authenticated);
        const details = detailsParser.parseDetailsPage();
        out[idx] = { ...entry, ...details };
        await sleep(DETAIL_DELAY_MS);
      }
    };

    const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, entries.length) }, worker);
    await Promise.all(workers);
    return out;
  }

  async _scrapeWithBrowser(word) {
    const BrowserManager = require('./lib/browser');
    const url = Utils.buildUrl(word);

    this.log(chalk.bold.blue('\n=== PHASE 1: Finding Entries (browser) ==='));
    const browser = new BrowserManager({
      headless: this.options.headless,
      debug: this.options.debug,
      timeout: this.options.timeout
    });

    let entries = [];
    let mirip = [];
    let authenticated = false;
    try {
      await browser.initBrowser();
      const cookieString = await this.auth.getCookieString();
      if (cookieString) await browser.setCustomCookie(cookieString);

      const html = await browser.navigateTo(url);
      if (!html) throw new Error('Failed to fetch page content');

      const isCloudflare = await browser.checkCloudflare();
      if (isCloudflare && !this.options.headless) {
        await browser.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
      } else if (isCloudflare) {
        throw new Error('Cloudflare challenge detected in headless mode');
      }

      const parser = new KBBIParser(html);
      authenticated = parser.checkAuthentication();
      const parsed = parser.parseEntries();
      entries = parsed.entries;
      mirip = parsed.mirip || [];
    } finally {
      await browser.close();
    }

    if (entries.length === 0 || !authenticated) {
      return { word, authenticated, entries, mirip };
    }

    // Authenticated browser callers may want details. Reuse the fetch path
    // with their cookie pool instead of spinning a second Chromium per eid.
    const http = new HttpClient({ timeout: this.options.timeout });
    const cookieValue = await this.auth.getRandomCookie();
    if (cookieValue) http.jar.setRaw('.AspNet.ApplicationCookie', cookieValue);
    const merged = await this._fetchDetails(http, entries, authenticated);
    return { word, authenticated, entries: merged, mirip };
  }
}

module.exports = { KBBIScraper };
