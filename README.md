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
npm install -g kbbi-js
```

## Command Line Usage

### Basic Lookup

```bash
kbbi cinta
```

### JSON Output

```bash
kbbi cinta --json
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
  "saran": []
}
```

### Enhanced Scrape Mode

```bash
kbbi cinta --scrape
```

Combine with JSON:
```bash
kbbi cinta --scrape --json
```

### Authentication

Login interactively:
```bash
kbbi --login
```

Cookie management:
```bash
# Add a cookie
kbbi --cookie-manage add:YOUR_COOKIE_VALUE

# List all cookies
kbbi --cookie-manage list

# Delete a cookie
kbbi --cookie-manage delete:COOKIE_VALUE
```

### Debug Options

```bash
# Save HTML files for debugging
kbbi cinta --debug

# Show browser UI
kbbi cinta --visible
```

### Help

```bash
kbbi --help
```

## JavaScript API

```javascript
const kbbi = require('kbbi-js');

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
const kbbi = require('kbbi-js');

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