# KBBI-JS

Unofficial JavaScript library and CLI for the official Kamus Besar Bahasa Indonesia at `kbbi.kemendikdasmen.go.id`. Anonymous lookups out of the box, optional login for etymology data.

## Highlights

- **No account required.** Anonymous lookups return the full meanings, word classes, and examples.
- **No browser required.** Native `fetch` (Node 18+) by default. The Playwright path is optional and only loads when you ask for it.
- **Lean install.** ~9 MB of dependencies, zero Chromium download in the default flow.
- **Fast.** Single lookup in under 1 second; a 13-word batch finishes in around 3 seconds at `--concurrency 4`.
- **Programmatic login.** Login is a plain HTTPS POST against the ASP.NET MVC form. No headless browser needed.
- **Batch CLI.** Pass multiple words on one command; results are emitted as a JSON array or formatted text.

## Why version 2

The KBBI portal moved from `kbbi.kemdikbud.go.id` to `kbbi.kemendikdasmen.go.id` after the Indonesian ministry was reorganised, and the old hostname is no longer in DNS. Version 2 retargets the new host, removes the hard Playwright dependency, and exposes the cookie path as opt-in (it was treated as required in 1.x).

## Installation

```bash
# Default install. No Chromium download.
npm install -g @doedja/kbbi-js

# One-off, no install:
npx @doedja/kbbi-js cinta
```

Need the optional browser fallback?

```bash
npm install playwright
npx playwright install chromium
```

## CLI

```bash
kbbi cinta
kbbi cinta makan air                     # batch, parallel
kbbi cinta --json
kbbi cinta --scrape --json               # adds eid + etymology when logged in
kbbi --login --email you@example.com --password '...'
kbbi --cookie-manage list
kbbi --cookie-manage add:AspNetCookieValue
kbbi --cookie-manage delete:AspNetCookieValue
kbbi cinta --browser                     # optional Playwright path
kbbi --help
```

Anonymous JSON output:

```json
{
  "kata": "cinta",
  "host": "kbbi.kemendikdasmen.go.id",
  "authenticated": false,
  "entri": [
    {
      "nama": "cin.ta",
      "nomor": "",
      "id": null,
      "akarkata": "",
      "jenis": "",
      "makna": [
        {
          "definisi": "suka sekali; sayang benar",
          "kelaskata": [{ "kode": "a", "nama": "Adjektiva" }],
          "contoh": [
            { "nomor": 1, "teks": "orang tuaku -- kepada kami semua" },
            { "nomor": 2, "teks": "-- kepada sesama makhluk" }
          ]
        }
      ],
      "etimologi": null,
      "turunan": [],
      "gabungan": [],
      "peribahasa": [],
      "idiom": []
    }
  ],
  "mirip": []
}
```

When more than one word is given, the command emits a JSON array (one record per word). Failed lookups are reported as `{ "kata": "...", "error": "..." }` entries and set a non-zero exit code.

### What anonymous vs authenticated unlocks

| Field                 | Anonymous | Logged in |
| --------------------- | --------- | --------- |
| `nama`, `nomor`       | Yes       | Yes       |
| `makna` definitions   | Yes       | Yes       |
| `kelaskata`           | Yes       | Yes       |
| `contoh` examples     | Yes       | Yes       |
| `etimologi`           | No (gated by KBBI server) | Yes |
| `turunan`, `gabungan`, `peribahasa`, `idiom` | No (KBBI hides them) | Yes |
| `id` (eid)            | No (hidden in edit links) | Yes |
| `--scrape` Phase 2 (`/DataDasarEntri/Details`) | Skipped (server redirects to login) | Followed |

## JavaScript API

```js
const KBBI = require('@doedja/kbbi-js');

(async () => {
  const kbbi = new KBBI(); // no options needed
  const result = await kbbi.lookup('cinta');
  console.log(result.authenticated, result.entries.length, 'meanings');
})();
```

Optional configuration:

```js
const kbbi = new KBBI({
  useBrowser: false,   // set true to force the Playwright fallback
  headless: true,
  debug: false,
  timeout: 20000
});
```

### With stored cookies (optional)

```js
const Auth = require('@doedja/kbbi-js/lib/auth');
const auth = new Auth();
await auth.addCookie('AspNetCookieValue');
const kbbi = new KBBI({ auth });
```

### Programmatic login (no browser)

```js
const auth = new Auth();
await auth.login('you@example.com', 'secret');
// Cookie is now persisted under data/kbbi-cookies.json and reused on next lookups.
```

## How it works

1. CLI parses positional args as words and any `--flag value` pairs.
2. Each lookup hits `https://kbbi.kemendikdasmen.go.id/entri/<word>` via `fetch`.
3. `lib/parser.js` (Cheerio) walks the `h2[style*="margin-bottom:3px"]` headings and their following `<ol>` / `<ul>` lists into `{ nama, nomor, makna[], etimologi, terkait }`.
4. `--scrape` adds a per-eid call to `/DataDasarEntri/Details` for callers that supplied a session cookie. The endpoint redirects anonymous callers to `/Account/Login`, so it is skipped silently in that case.
5. `--browser` swaps step 2 for a headless Chromium via Playwright. Use it only if KBBI ever fronts the site with Cloudflare or another JS challenge.

## Notes

- KBBI gates some data (etymology, derivations, idioms, edit-page IDs) to logged-in accounts on the server side. There is no way to retrieve those fields without a session cookie.
- Login uses a normal ASP.NET MVC POST with the `__RequestVerificationToken` cookie + form-token pair. No captcha as of this writing; if KBBI adds one, the `--browser --login` combination (after installing Playwright) is the fallback.
- The legacy `--save-cookie`, `--add-cookie`, and `--list-cookies` flags from 1.x were dropped in favour of `--cookie-manage`. Calling `--login` now expects `--email` and `--password`.

## License

MIT
