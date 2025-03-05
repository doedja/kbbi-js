/**
 * KBBI-JS Scraper Module
 * 
 * A module for scraping KBBI website to extract entry IDs and details.
 * Uses Playwright exclusively for browser automation.
 * To be used with the --scrape flag in cli.js
 */

const path = require('path');
const BrowserManager = require('./lib/browser');
const KBBIParser = require('./lib/parser');
const Utils = require('./lib/utils');
const Auth = require('./lib/auth');
const chalk = require('chalk');
const fs = require('fs');

class KBBIScraper {
  /**
   * Constructor for KBBIScraper
   * @param {Object} options - Configuration options
   */
  constructor(options = {}) {
    this.options = {
      headless: true,
      debug: false,
      timeout: 30000,
      stealth: true,
      useCache: true,
      ...options
    };
    
    this.browser = null;
    this.authenticated = false;
    this.auth = this.options.auth || new Auth();
  }

  /**
   * Scrape word and extract entry IDs
   * @param {string} word - Word to scrape
   * @returns {Object} - Object containing scraped data
   */
  async scrapeWord(word) {
    if (!word) throw new Error('No word provided');

    try {
      // Phase 1: Get entry IDs from main page
      console.log(chalk.bold.blue('\n=== PHASE 1: Finding Entries ==='));
      const url = Utils.buildUrl(word);
      console.log(`Searching for word: "${word}" at ${url}\n`);
      
      // Initialize first browser for entry search
      this.browser = new BrowserManager({
        headless: this.options.headless,
        debug: this.options.debug,
        timeout: this.options.timeout,
        stealth: this.options.stealth
      });

      await this.browser.initBrowser();
      
      // Get authentication cookie with rotation support
      const cookieString = await this.auth.getCookieString();
      if (cookieString) {
        await this.browser.setCustomCookie(cookieString);
      }
      
      const html = await this.browser.navigateTo(url);
      if (!html) {
        throw new Error('Failed to fetch page content');
      }

      if (this.options.debug) {
        // Use the new Utils method for saving debug files
        Utils.saveDebugFile(__dirname, 'entry-page.html', html);
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
          throw new Error('Cloudflare challenge detected in headless mode');
        }
      }

      // Parse the page for entries
      const parser = new KBBIParser(html);
      this.authenticated = parser.checkAuthentication();
      
      // For scraping, we want to extract just the basic entry information (IDs)
      const entryHeadings = parser.$('h2[style*="margin-bottom:3px"]');
      const entries = [];
      
      entryHeadings.each((index, h2) => {
        const entry = parser.parseEntry(parser.$(h2));
        if (entry) {
          entries.push(entry);
        }
      });
      
      const mirip = parser.parseMirip();

      // Close first browser instance
      await this.browser.close();
      this.browser = null;

      if (entries.length === 0) {
        console.log(chalk.yellow('No entries found.'));
        if (mirip && mirip.length > 0) {
          console.log(chalk.yellow('Mirip:'));
          mirip.forEach(s => console.log(chalk.cyan(`  • ${s}`)));
        }
        return { word, authenticated: this.authenticated, entries: [], mirip: mirip || [] };
      }

      // Phase 2: Get details for each entry
      console.log(chalk.bold.blue('\n=== PHASE 2: Fetching Details ==='));
      console.log(`Found ${entries.length} entries, fetching details...\n`);

      const detailedEntries = [];
      for (const entry of entries) {
        if (!entry || !entry.id) {
          console.log(chalk.yellow(`⚠ Skipping invalid entry`));
          continue;
        }

        const detailsUrl = `https://kbbi.kemdikbud.go.id/DataDasarEntri/Details?eid=${entry.id}`;
        console.log(`Fetching details for "${entry.nama}${entry.nomor ? ' ' + entry.nomor : ''}" (ID: ${entry.id})`);
        console.log(chalk.gray(`URL: ${detailsUrl}`));

        // Create new browser instance for each details page
        this.browser = new BrowserManager({
          headless: this.options.headless,
          debug: this.options.debug,
          timeout: this.options.timeout,
          stealth: this.options.stealth
        });

        await this.browser.initBrowser();
        
        // Get fresh authentication cookie for each request with rotation
        const cookieString = await this.auth.getCookieString();
        if (cookieString) {
          await this.browser.setCustomCookie(cookieString);
        }

        const detailsHtml = await this.browser.navigateTo(detailsUrl);
        if (detailsHtml) {
          if (this.options.debug) {
            // Use the new Utils method for saving debug files
            Utils.saveDebugFile(__dirname, `details-${entry.id}.html`, detailsHtml);
          }

          const detailsParser = new KBBIParser(detailsHtml, this.authenticated);
          const details = detailsParser.parseDetailsPage();

          if (this.options.debug) {
            console.log(chalk.gray('Debug: Parsed details:'));
            console.log(chalk.gray(JSON.stringify(details, null, 2)));
          }
          
          // Merge entry info with details
          const mergedEntry = {
            ...entry,
            ...details
          };
          
          detailedEntries.push(mergedEntry);
          console.log(chalk.green('✓ Details fetched successfully\n'));
        } else {
          console.log(chalk.red('✗ Failed to fetch details\n'));
          detailedEntries.push(entry);
        }

        // Close browser instance after each details fetch
        await this.browser.close();
        this.browser = null;

        // Add a small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      // Phase 3: Summary
      console.log(chalk.bold.blue('\n=== PHASE 3: Summary ==='));
      console.log(`Total entries found: ${entries.length}`);
      console.log(`Details fetched: ${detailedEntries.filter(e => e.makna && e.makna.length > 0).length}`);
      console.log(`Authentication status: ${this.authenticated ? chalk.green('Yes') : chalk.yellow('No')}`);
      console.log(`✓ Found ${detailedEntries.length} definitions for "${word}"`);

      return {
        word,
        authenticated: this.authenticated,
        entries: detailedEntries,
        mirip: mirip || []
      };
    } catch (error) {
      throw error;
    } finally {
      if (this.browser) {
        await this.browser.close();
      }
    }
  }

  /**
   * Fetch details for multiple entries sequentially with new browser for each
   * @param {string[]} entryIds - Array of entry IDs to fetch details for
   * @param {object} options - Options for fetching
   * @returns {Promise<Object[]>} - Array of entry details
   */
  async fetchMultipleDetails(entryIds, options = {}) {
    const results = [];
    
    for (const entryId of entryIds) {
      try {
        // Initialize browser for each entry to avoid session issues
        this.browser = new BrowserManager({
          ...this.options,
          ...options
        });

        await this.browser.initBrowser();
        
        // Get fresh authentication cookie for each request with rotation
        const cookieString = await this.auth.getCookieString();
        if (cookieString) {
          await this.browser.setCustomCookie(cookieString);
        }

        // Navigate to details page
        const detailsUrl = `https://kbbi.kemdikbud.go.id/DataDasarEntri/Details?eid=${entryId}`;
        const html = await this.browser.navigateTo(detailsUrl);

        if (html) {
          if (this.options.debug) {
            // Use the new Utils method for saving debug files
            Utils.saveDebugFile(__dirname, `details-multi-${entryId}.html`, html);
          }
          
          const parser = new KBBIParser(html, this.authenticated);
          const details = parser.parseDetailsPage();
          results.push({ entryId, details });
        } else {
          results.push({ 
            entryId, 
            details: { error: 'Failed to fetch details' }
          });
        }
      } catch (error) {
        results.push({ 
          entryId, 
          details: { error: error.message }
        });
      } finally {
        if (this.browser) {
          await this.browser.close();
        }
      }

      // Add a small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }
}

module.exports = { KBBIScraper }; 