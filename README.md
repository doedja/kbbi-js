# KBBI-JS

Unofficial JavaScript library for accessing KBBI (Kamus Besar Bahasa Indonesia) with anti-Cloudflare protection.

## Features

- Access the official KBBI dictionary with detailed entry information
- Anti-Cloudflare strategy using headless browser automation
- Concise command-line interface with JSON output option
- Cookie rotation to distribute requests and avoid rate limiting
- Support for all entry types, word classes, etymologies, and related words

## Installation

```bash
# Install globally
npm install -g @doedja/kbbi-js

# Or use without installing
npx @doedja/kbbi-js [command]
```

## Command Line Usage

### Basic Lookup

```bash
# If installed globally
kbbi cinta

# Using npx (recommended)
npx @doedja/kbbi-js cinta
```

### JSON Output

```bash
# If installed globally
kbbi cinta --json

# Using npx
npx @doedja/kbbi-js cinta --json
```

Output:
```json
{
  "kata": "cinta",
  "entri": [
    {
      "nama": "cinta",
      "jenis": "dasar",
      "makna": [
        {
          "definisi": "suka sekali; sayang benar",
          "kelaskata": [
            { "kode": "a", "nama": "Adjektiva" }
          ]
        }
      ]
    }
  ],
  "mirip": []
}
```

### Enhanced Scrape Mode

```bash
# If installed globally
kbbi cinta --scrape

# Using npx
npx @doedja/kbbi-js cinta --scrape
```

Combine with JSON:
```bash
# If installed globally
kbbi cinta --scrape --json

# Using npx
npx @doedja/kbbi-js cinta --scrape --json
```

### Authentication

Login interactively:
```bash
# If installed globally
kbbi --login

# Using npx
npx @doedja/kbbi-js --login
```

Cookie management:
```bash
# If installed globally
kbbi --cookie-manage add:YOUR_COOKIE_VALUE
kbbi --cookie-manage list
kbbi --cookie-manage delete:COOKIE_VALUE

# Using npx
npx @doedja/kbbi-js --cookie-manage add:YOUR_COOKIE_VALUE
npx @doedja/kbbi-js --cookie-manage list
npx @doedja/kbbi-js --cookie-manage delete:COOKIE_VALUE
```

### Debug Options

```bash
# If installed globally
kbbi cinta --debug
kbbi cinta --visible

# Using npx
npx @doedja/kbbi-js cinta --debug
npx @doedja/kbbi-js cinta --visible
```

### Help

```bash
# If installed globally
kbbi --help

# Using npx
npx @doedja/kbbi-js --help
```

## JavaScript API

```javascript
const kbbi = require('@doedja/kbbi-js');

async function lookupWord() {
  try {
    const result = await kbbi.create('cinta');
    console.log(result.toString());
    
    // Get JSON data
    const data = result.serialize();
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await kbbi.closeBrowser();
  }
}
```

## With Cookie Rotation

```javascript
const kbbi = require('@doedja/kbbi-js');

async function lookup() {
  try {
    // Use multiple cookies for rotation
    const cookieValues = [
      'COOKIE_VALUE_1',
      'COOKIE_VALUE_2'
    ];
    
    const result = await kbbi.create('cinta', cookieValues);
    console.log(result.toString());
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await kbbi.closeBrowser();
  }
}
```

## How It Works

KBBI-JS uses Playwright for browser automation to access the KBBI website, enabling reliable access despite Cloudflare protection. The browser runs in headless mode by default but can be made visible for debugging.

## License

MIT 