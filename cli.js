#!/usr/bin/env node
/**
 * KBBI-JS CLI
 *
 * Anonymous lookups use plain HTTPS. Pass --browser to fall back to the
 * Playwright path (requires `npm install playwright`). Cookies remain
 * optional and only unlock etymology and editor metadata.
 */

const chalk = require('chalk');
const fs = require('fs');
const KBBI = require('./kbbi');
const Auth = require('./lib/auth');
const Utils = require('./lib/utils');

const HELP_TEXT = `
  ${chalk.bold('KBBI CLI')}

  ${chalk.bold('Usage:')}
    ${chalk.gray('kbbi [options] <word> [more-words...]')}

  ${chalk.gray('Cookies are optional. Anonymous lookups return meanings, classes, examples.')}
  ${chalk.gray('Login (--login --email --password) adds etymology and editor metadata.')}

  ${chalk.bold('Modes:')}
    ${chalk.gray('--scrape')}         Parse the entry list + (when authed) per-eid Details endpoint
    ${chalk.gray('--browser')}        Use the optional Playwright fallback (install playwright first)

  ${chalk.bold('Output:')}
    ${chalk.gray('--json')}           Emit JSON instead of formatted text
    ${chalk.gray('--concurrency N')}  Parallel word lookups when more than one word is given (default 3)

  ${chalk.bold('Authentication (optional):')}
    ${chalk.gray('--login --email <e> --password <p>')}   Programmatic login (no browser needed)
    ${chalk.gray('--cookie <value>')} Use a single .AspNet.ApplicationCookie value for this call
    ${chalk.gray('--cookie-manage <action>')}             add:VALUE, delete:VALUE, list

  ${chalk.bold('Diagnostics:')}
    ${chalk.gray('--visible')}        Run the optional browser fallback with --browser visible
    ${chalk.gray('--debug')}          Persist HTML snapshots under debug/

  ${chalk.bold('Examples:')}
    ${chalk.gray('kbbi cinta')}
    ${chalk.gray('kbbi cinta makan air --json')}
    ${chalk.gray('kbbi --cookie-manage list')}
`;

function parseArgs(argv) {
  const flags = {
    login: false,
    email: null,
    password: null,
    cookie: null,
    cookieManage: null,
    visible: false,
    debug: false,
    json: false,
    scrape: false,
    useBrowser: false,
    concurrency: 3,
    help: false,
    words: []
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        flags.help = true; break;
      case '--login':
        flags.login = true; break;
      case '--email':
        flags.email = argv[++i] || null; break;
      case '--password':
        flags.password = argv[++i] || null; break;
      case '--cookie':
        flags.cookie = argv[++i] || null; break;
      case '--cookie-manage':
        flags.cookieManage = argv[++i] || null; break;
      case '--visible':
        flags.visible = true; flags.useBrowser = true; break;
      case '--debug':
        flags.debug = true; break;
      case '--json':
      case '--json-debug':
        flags.json = true; break;
      case '--scrape':
        flags.scrape = true; break;
      case '--browser':
        flags.useBrowser = true; break;
      case '--concurrency': {
        const n = parseInt(argv[++i], 10);
        if (Number.isFinite(n) && n > 0) flags.concurrency = n;
        break;
      }
      default:
        if (a.startsWith('--')) {
          console.error(chalk.yellow(`Warning: ignoring unknown flag ${a}`));
        } else {
          flags.words.push(a);
        }
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    console.log(HELP_TEXT);
    return;
  }

  const auth = new Auth();

  if (flags.login) {
    if (!flags.email || !flags.password) {
      console.error(chalk.red('Error: --login requires --email and --password.'));
      console.error(chalk.yellow('Login is optional. Anonymous lookups already return meanings and examples.'));
      process.exitCode = 1;
      return;
    }
    await handleLogin(auth, flags.email, flags.password);
    return;
  }

  if (flags.cookieManage) {
    await handleCookieManagement(auth, flags.cookieManage);
    return;
  }

  if (flags.words.length === 0) {
    console.error(chalk.red('Error: provide at least one word to look up.'));
    console.log(HELP_TEXT);
    process.exitCode = 1;
    return;
  }

  if (flags.cookie) {
    // One-shot cookie: stash on the auth instance via a transient list so the
    // rotation pool keeps the persistent file untouched.
    auth.loadCookiesSync = () => [flags.cookie.replace(/^.AspNet\.ApplicationCookie=/, '')];
  }

  const kbbi = new KBBI({
    headless: !flags.visible,
    debug: flags.debug,
    useBrowser: flags.useBrowser,
    // Silence scrape's phase-banner logs whenever the user asked for JSON so
    // stdout stays parseable. Always silence in batch mode for the same reason.
    silent: flags.json || flags.words.length > 1,
    auth
  });

  const results = await batchLookup(kbbi, flags);
  emit(results, flags);
}

async function batchLookup(kbbi, flags) {
  const words = flags.words;
  const out = new Array(words.length);
  let cursor = 0;

  const worker = async () => {
    while (cursor < words.length) {
      const idx = cursor++;
      const word = words[idx];
      try {
        const result = flags.scrape ? await kbbi.scrape(word) : await kbbi.lookup(word);
        out[idx] = { ok: true, word, result };
      } catch (err) {
        out[idx] = { ok: false, word, error: err.message, name: err.name };
      }
    }
  };

  const concurrency = Math.max(1, Math.min(flags.concurrency, words.length));
  await Promise.all(Array.from({ length: concurrency }, worker));
  return out;
}

function emit(results, flags) {
  if (flags.json) {
    const payload = results.map(toJsonRecord);
    console.log(JSON.stringify(payload.length === 1 ? payload[0] : payload, null, 2));
    return;
  }
  results.forEach((res, i) => {
    if (i > 0) console.log();
    printRecord(res);
  });
  const failures = results.filter((r) => !r.ok);
  if (failures.length) process.exitCode = 1;
}

function toJsonRecord({ ok, word, result, error, name }) {
  if (!ok) {
    return { kata: word, entri: [], error, errorType: name || 'Error' };
  }
  return {
    kata: result.word,
    host: Utils.HOST,
    authenticated: result.authenticated,
    entri: (result.entries || []).map((entry) => ({
      nama: entry.nama,
      nomor: entry.nomor || '',
      id: entry.id || null,
      akarkata: entry.rootWord || '',
      jenis: entry.jenis || '',
      makna: (entry.makna || []).map((m) => ({
        definisi: m.definisi || '',
        kelaskata: m.kelasKata || [],
        contoh: m.contoh || []
      })),
      etimologi: entry.etimologi || null,
      turunan: entry.terkait?.kataTurunan || entry.turunan || [],
      gabungan: entry.terkait?.gabunganKata || entry.gabungan || [],
      peribahasa: entry.terkait?.peribahasa || entry.peribahasa || [],
      idiom: entry.terkait?.idiom || entry.idiom || []
    })),
    mirip: result.mirip || []
  };
}

function printRecord({ ok, word, result, error }) {
  if (!ok) {
    console.error(chalk.red(`[${word}] ${error}`));
    return;
  }
  if (!result.entries || result.entries.length === 0) {
    console.log(chalk.red(`[${word}] No entries found`));
    if (result.mirip?.length) {
      console.log(chalk.yellow('Mirip:'));
      result.mirip.forEach((m) => console.log(chalk.cyan(`  • ${m}`)));
    }
    return;
  }
  result.entries.forEach((entry) => {
    console.log(Utils.formatOutput(entry));
  });
}

async function handleLogin(auth, email, password) {
  try {
    console.log(`Logging in as ${email}...`);
    await auth.login(email, password);
    console.log(chalk.green('Login successful! Cookie saved for future use.'));
  } catch (error) {
    console.error(chalk.red(`Login failed: ${error.message}`));
    process.exitCode = 1;
  }
}

async function handleCookieManagement(auth, command) {
  const [actionRaw, ...rest] = command.split(':');
  const action = (actionRaw || '').toLowerCase();
  const value = rest.length ? rest.join(':') : null;
  try {
    switch (action) {
      case 'add': {
        if (!value) return failCookie('add');
        await auth.addCookie(value);
        const { count } = await auth.listCookies();
        console.log(chalk.green('Cookie added.'));
        console.log(`You now have ${count} ${count === 1 ? 'cookie' : 'cookies'} configured.`);
        break;
      }
      case 'delete':
      case 'remove': {
        if (!value) return failCookie('delete');
        const removed = await auth.removeCookie(value);
        console.log(removed ? chalk.green('Cookie removed.') : chalk.red('No matching cookie.'));
        break;
      }
      case 'list': {
        const { cookies, maskedCookies, count } = await auth.listCookies();
        console.log(chalk.bold('===== KBBI Saved Cookies ====='));
        if (count === 0) {
          console.log('No cookies stored.');
        } else {
          maskedCookies.forEach((c, i) => console.log(`${i + 1}. ${c}`));
        }
        break;
      }
      default:
        console.error(chalk.red(`Unknown cookie-manage action: ${action}`));
        console.log('Use add:VALUE, delete:VALUE, or list.');
        process.exitCode = 1;
    }
  } catch (error) {
    console.error(chalk.red(`Cookie management error: ${error.message}`));
    process.exitCode = 1;
  }
}

function failCookie(action) {
  console.error(chalk.red(`Error: cookie value is required for ${action}.`));
  process.exitCode = 1;
}

if (require.main === module) {
  main().catch((err) => {
    console.error(chalk.red(`Unexpected error: ${err.message}`));
    process.exit(1);
  });
}

module.exports = { main, parseArgs };
