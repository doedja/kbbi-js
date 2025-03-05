const path = require('path');
const fs = require('fs');
const BrowserManager = require('./browser');
const { AuthenticationError } = require('./errors');
const Utils = require('./utils');

class Auth {
  constructor(options = {}) {
    this.options = {
      cookiesPath: path.join(__dirname, '..', 'data', 'kbbi-cookies.json'),
      legacyCookiePath: path.join(__dirname, '..', 'data', 'kbbi-cookie.json'),
      ...options
    };
    
    // Ensure the data directory exists
    Utils.ensureDirectory(path.dirname(this.options.cookiesPath));
    
    // Migrate legacy cookie if it exists
    this.migrateLegacyCookie();
  }

  /**
   * Migrate legacy cookie to the new format if it exists
   * @private
   */
  migrateLegacyCookie() {
    try {
      if (fs.existsSync(this.options.legacyCookiePath)) {
        const legacyCookieData = JSON.parse(fs.readFileSync(this.options.legacyCookiePath, 'utf8'));
        
        if (legacyCookieData && legacyCookieData['.AspNet.ApplicationCookie']) {
          // Migrate the cookie to the new format
          this.addCookie(legacyCookieData['.AspNet.ApplicationCookie']);
          
          // Delete the legacy cookie file
          fs.unlinkSync(this.options.legacyCookiePath);
          console.log('Migrated legacy cookie to new format');
        }
      }
    } catch (error) {
      console.error('Error migrating legacy cookie:', error.message);
    }
  }

  /**
   * Login to KBBI with email and password
   * @param {string} email - KBBI account email
   * @param {string} password - KBBI account password
   * @param {boolean} headless - Whether to run browser in headless mode
   * @returns {Promise<boolean>} - Whether login was successful
   */
  async login(email, password, headless = true) {
    if (!email || !password) {
      throw new AuthenticationError('Email and password are required');
    }

    let browser = null;

    try {
      browser = new BrowserManager({
        headless,
        stealth: true,
        timeout: 60000
      });

      await browser.initBrowser();
      await browser.navigateTo('https://kbbi.kemdikbud.go.id/Account/Login');
      
      // Wait for login form
      await browser.page.waitForSelector('#Email', { state: 'visible', timeout: 10000 });
      
      // Fill form
      await browser.page.fill('#Email', email);
      await browser.page.fill('#Password', password);
      
      // Submit form
      await Promise.all([
        browser.page.click('button[type="submit"]'),
        browser.page.waitForNavigation({ waitUntil: 'domcontentloaded' })
      ]);
      
      // Check if login was successful
      const content = await browser.page.content();
      const loginFailed = content.includes('Invalid login attempt') || 
                         content.includes('password yang Anda masukkan tidak valid');
      
      if (loginFailed) {
        throw new AuthenticationError('Invalid email or password');
      }
      
      // Get cookies from the browser
      const cookies = await browser.context.cookies();
      const aspNetCookie = cookies.find(c => c.name === '.AspNet.ApplicationCookie');
      
      if (!aspNetCookie) {
        throw new AuthenticationError('Failed to get authentication cookie');
      }
      
      // Save the cookie
      await this.addCookie(aspNetCookie.value);
      
      return true;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }
      throw new AuthenticationError(`Login failed: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Login to KBBI with browser UI
   * @returns {Promise<boolean>} - Whether login was successful
   */
  async browserLogin() {
    let browser = null;

    try {
      console.log('Opening browser for KBBI login...');
      console.log('Please login with your KBBI account in the browser window.');
      
      browser = new BrowserManager({
        headless: false,
        stealth: true,
        timeout: 120000
      });

      await browser.initBrowser();
      await browser.navigateTo('https://kbbi.kemdikbud.go.id/Account/Login');
      
      // Wait for login and navigation
      console.log('Waiting for you to complete the login process...');
      console.log('The browser will close automatically after successful login.');
      
      // Wait for the user to login and for the cookie to appear
      let aspNetCookie = null;
      let attempts = 0;
      const maxAttempts = 20; // 20 attempts * 3s = 60s max wait time
      
      while (!aspNetCookie && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds
        
        const cookies = await browser.context.cookies();
        aspNetCookie = cookies.find(c => c.name === '.AspNet.ApplicationCookie');
        
        attempts++;
      }
      
      if (!aspNetCookie) {
        throw new AuthenticationError('Login timeout or no authentication cookie found');
      }
      
      // Save the cookie
      await this.addCookie(aspNetCookie.value);
      
      console.log('Login successful! Cookie saved for future use.');
      return true;
    } catch (error) {
      throw new AuthenticationError(`Browser login failed: ${error.message}`);
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }

  /**
   * Unified cookie management method
   * @param {Object} options - Cookie management options
   * @param {string} options.action - Action to perform ('add', 'delete', 'list')
   * @param {string} options.value - Cookie value for add/delete actions
   * @returns {Promise<Object>} - Result of the operation
   */
  async manageCookies(options = {}) {
    const { action, value } = options;
    
    if (!action) {
      throw new Error('Cookie management action is required');
    }
    
    switch (action.toLowerCase()) {
      case 'add':
        if (!value) {
          throw new Error('Cookie value is required for add action');
        }
        await this.addCookie(value);
        const count = (await this.listCookies()).cookies.length;
        return { success: true, action: 'add', count };
      
      case 'delete':
        if (!value) {
          throw new Error('Cookie value is required for delete action');
        }
        const removed = await this.removeCookie(value);
        return { success: removed, action: 'delete' };
      
      case 'list':
        return await this.listCookies();
      
      default:
        throw new Error(`Unknown cookie management action: ${action}`);
    }
  }

  /**
   * Save a cookie string to the cookies file
   * @param {string} cookieString - Cookie string to save
   * @returns {Promise<boolean>} - Whether save was successful
   * @deprecated Use addCookie instead
   */
  async saveCookie(cookieString) {
    console.warn('saveCookie is deprecated, use addCookie instead');
    return this.addCookie(cookieString);
  }

  /**
   * Add a cookie to the cookies file
   * @param {string} cookieValue - Cookie value to add
   * @returns {Promise<boolean>} - Whether add was successful
   */
  async addCookie(cookieValue) {
    if (!cookieValue) {
      throw new Error('Cookie value is required');
    }

    try {
      // Safely extract just the value if a full cookie string was provided
      let value = cookieValue;
      if (cookieValue.includes('=')) {
        const matches = cookieValue.match(/(?:^|\s)\.AspNet\.ApplicationCookie=([^;]+)/);
        if (matches && matches[1]) {
          value = matches[1];
        }
      }
      
      let cookies = [];
      
      // Load existing cookies
      if (fs.existsSync(this.options.cookiesPath)) {
        try {
          cookies = JSON.parse(fs.readFileSync(this.options.cookiesPath, 'utf8'));
          if (!Array.isArray(cookies)) {
            cookies = [];
          }
        } catch (e) {
          cookies = [];
        }
      }
      
      // Check if this cookie already exists
      const exists = cookies.includes(value);
      if (!exists) {
        cookies.push(value);
      }
      
      // Save the updated cookies array
      fs.writeFileSync(this.options.cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
      
      return true;
    } catch (error) {
      console.error('Error adding cookie:', error.message);
      return false;
    }
  }

  /**
   * Remove a cookie from the cookies file
   * @param {string} cookieValue - Cookie value to remove
   * @returns {Promise<boolean>} - Whether removal was successful
   */
  async removeCookie(cookieValue) {
    if (!cookieValue) {
      throw new Error('Cookie value is required');
    }

    try {
      if (!fs.existsSync(this.options.cookiesPath)) {
        return false;
      }
      
      let cookies = [];
      
      try {
        cookies = JSON.parse(fs.readFileSync(this.options.cookiesPath, 'utf8'));
        if (!Array.isArray(cookies)) {
          cookies = [];
        }
      } catch (e) {
        cookies = [];
      }
      
      // Find and remove the cookie
      const initialLength = cookies.length;
      cookies = cookies.filter(c => c !== cookieValue);
      
      // If nothing was removed, try to match by prefix
      if (initialLength === cookies.length && cookieValue.length > 10) {
        const prefix = cookieValue.substring(0, 10);
        cookies = cookies.filter(c => !c.startsWith(prefix));
      }
      
      // Check if any cookies were removed
      const removed = initialLength > cookies.length;
      
      // Save the updated cookies array
      fs.writeFileSync(this.options.cookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
      
      return removed;
    } catch (error) {
      console.error('Error removing cookie:', error.message);
      return false;
    }
  }

  /**
   * List all saved cookies
   * @returns {Promise<Object>} - Object containing cookies
   */
  async listCookies() {
    try {
      if (!fs.existsSync(this.options.cookiesPath)) {
        return { cookies: [], maskedCookies: [], count: 0 };
      }
      
      let cookies = [];
      
      try {
        cookies = JSON.parse(fs.readFileSync(this.options.cookiesPath, 'utf8'));
        if (!Array.isArray(cookies)) {
          cookies = [];
        }
      } catch (e) {
        cookies = [];
      }
      
      // Mask cookies for display
      const maskedCookies = cookies.map(cookie => {
        if (!cookie || cookie.length <= 10) return cookie || '(invalid cookie)';
        return cookie.substring(0, 5) + '...' + cookie.substring(cookie.length - 5);
      });
      
      return { 
        cookies,
        maskedCookies,
        count: cookies.length 
      };
    } catch (error) {
      console.error('Error listing cookies:', error.message);
      return { cookies: [], maskedCookies: [], count: 0 };
    }
  }

  /**
   * Get a random cookie from the cookies file
   * @returns {Promise<string|null>} - Random cookie or null if no cookies
   */
  async getRandomCookie() {
    try {
      const { cookies } = await this.listCookies();
      
      if (!cookies || cookies.length === 0) {
        return null;
      }
      
      // Get a random cookie
      const randomIndex = Math.floor(Math.random() * cookies.length);
      return cookies[randomIndex];
    } catch (error) {
      console.error('Error getting random cookie:', error.message);
      return null;
    }
  }

  /**
   * Load cookies synchronously (internal use)
   * @returns {Array} - Array of cookies
   */
  loadCookiesSync() {
    try {
      if (!fs.existsSync(this.options.cookiesPath)) {
        return [];
      }
      
      const data = fs.readFileSync(this.options.cookiesPath, 'utf8');
      try {
        const cookies = JSON.parse(data);
        return Array.isArray(cookies) ? cookies : [];
      } catch (parseError) {
        console.error('Error parsing cookies file:', parseError.message);
        return [];
      }
    } catch (error) {
      console.error('Error loading cookies:', error.message);
      return [];
    }
  }

  /**
   * Load cookies asynchronously
   * @returns {Promise<Array>} - Array of cookies
   */
  async loadCookies() {
    return this.loadCookiesSync();
  }

  /**
   * Get a cookie string for use in HTTP requests
   * @returns {Promise<string|null>} - Cookie string or null if no cookies
   */
  async getCookieString() {
    const cookie = await this.getRandomCookie();
    if (!cookie) return null;
    
    return `.AspNet.ApplicationCookie=${cookie}`;
  }
}

module.exports = Auth; 