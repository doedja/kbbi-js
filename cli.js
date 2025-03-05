#!/usr/bin/env node
/**
 * KBBI-JS CLI Tool
 * 
 * A unified command-line interface for the KBBI-JS library
 * 
 * Usage:
 *   node cli.js [word] [options]
 * 
 * Options:
 *   --login         Open login UI or login with provided credentials
 *   --email         Email for KBBI login (requires --login)
 *   --password      Password for KBBI login (requires --login)
 *   --cookie        Specify a cookie string to use (instead of from cookie file)
 *   --cookie-manage Manage cookies (add, remove, list)
 *   --save-cookie   Save a cookie string to cookie file for future use (deprecated)
 *   --add-cookie    Add an additional cookie for rotation (deprecated)
 *   --list-cookies  List all saved cookies (deprecated)
 *   --visible       Show browser during operations (default: headless)
 *   --debug         Save debug files (HTML, screenshots)
 *   --json-debug    Show debug information as JSON in the console
 *   --json          Output results in JSON format
 *   --scrape        Scrape entry IDs and output in JSON format
 *   --help          Show this help
 */

const path = require('path');
const chalk = require('chalk');
const KBBI = require('./kbbi');
const Auth = require('./lib/auth');
const Utils = require('./lib/utils');
const fs = require('fs');

// Process command line arguments
const args = process.argv.slice(2);

// Handle help request
if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

// Main function
async function main() {
  const auth = new Auth();
  
  // Extract arguments and flags
  const flags = {
    login: args.includes('--login'),
    email: args.includes('--email') ? args[args.indexOf('--email') + 1] : null,
    password: args.includes('--password') ? args[args.indexOf('--password') + 1] : null,
    cookie: args.includes('--cookie') ? args[args.indexOf('--cookie') + 1] : null,
    cookieManage: args.includes('--cookie-manage') ? args[args.indexOf('--cookie-manage') + 1] : null,
    saveCookie: args.includes('--save-cookie') ? args[args.indexOf('--save-cookie') + 1] || true : false,
    addCookie: args.includes('--add-cookie') ? args[args.indexOf('--add-cookie') + 1] || true : false,
    listCookies: args.includes('--list-cookies'),
    visible: args.includes('--visible'),
    debug: args.includes('--debug'),
    jsonDebug: args.includes('--json-debug'),
    json: args.includes('--json'),
    scrape: args.includes('--scrape'),
    help: args.includes('--help')
  };
  
  // Get the word to lookup (first non-flag argument)
  let word = null;
  for (const arg of args) {
    if (!arg.startsWith('--') && 
        arg !== flags.email && 
        arg !== flags.password && 
        arg !== flags.cookie &&
        arg !== flags.cookieManage &&
        arg !== flags.saveCookie &&
        arg !== flags.addCookie) {
      word = arg;
      break;
    }
  }
  
  // Show help if requested
  if (flags.help) {
    showHelp();
    return;
  }
  
  try {
    // Handle different login modes
    if (flags.login) {
      if (flags.email && flags.password) {
        // Login with email and password
        await handleLogin(auth, flags.email, flags.password, flags.visible);
      } else {
        // Browser login
        await handleBrowserLogin(auth);
      }
      return;
    }
    
    // Cookie management operations
    if (flags.cookieManage) {
      await handleCookieManagement(auth, flags.cookieManage, args);
      return;
    }
    
    // Legacy cookie operations (deprecated but still supported)
    if (flags.saveCookie !== false) {
      console.warn(chalk.yellow('Warning: --save-cookie is deprecated. Use --cookie-manage add instead.'));
      if (typeof flags.saveCookie === 'string') {
        await handleSaveCookie(auth, flags.saveCookie);
      } else if (flags.cookie) {
        await handleSaveCookie(auth, flags.cookie);
    } else {
        console.error(chalk.red('Error: No cookie value provided for --save-cookie'));
      }
    return;
  }
  
    if (flags.addCookie !== false) {
      console.warn(chalk.yellow('Warning: --add-cookie is deprecated. Use --cookie-manage add instead.'));
      if (typeof flags.addCookie === 'string') {
        await handleAddCookie(auth, flags.addCookie);
      } else {
        console.error(chalk.red('Error: No cookie value provided for --add-cookie'));
      }
      return;
    }
    
    if (flags.listCookies) {
      console.warn(chalk.yellow('Warning: --list-cookies is deprecated. Use --cookie-manage list instead.'));
      await handleListCookies(auth);
      return;
    }
    
    // Require a word for lookup or scrape operations
  if (!word) {
      if (!flags.login && !flags.saveCookie && !flags.addCookie && !flags.listCookies && !flags.cookieManage) {
        console.error(chalk.red('Error: No word provided for lookup'));
    showHelp();
      }
    return;
  }
  
    // Create options object for KBBI class
    const options = {
      headless: !flags.visible,
      debug: flags.debug || flags.jsonDebug
    };
    
    // Add cookie if provided
    if (flags.cookie) {
      options.cookie = flags.cookie;
    }
    
    // Look up word or scrape entries
    const kbbi = new KBBI(options);
    
    if (flags.scrape) {
      // Use scrape mode with silent output
      // Temporarily redirect console.log to suppress verbose output from scrape.js
      const originalLog = console.log;
      console.log = function() {}; // Silent log function

      try {
        const result = await kbbi.scrape(word);
        
        // Restore console.log for our output
        console.log = originalLog;
        
        if (!result || !result.entries || result.entries.length === 0) {
          if (flags.json) {
            console.log(JSON.stringify({
              kata: word,
              entri: [],
              error: "No entries found",
              mirip: result?.mirip || []
            }, null, 2));
          } else {
            console.log(chalk.red('No entries found'));
            
            if (result?.mirip && result.mirip.length > 0) {
              console.log(chalk.yellow('\nMirip:'));
              result.mirip.forEach(suggestion => {
                console.log(chalk.cyan(`  • ${suggestion}`));
              });
            }
          }
          return;
        }
        
        // Handle JSON output format if requested
        if (flags.json) {
          // Transform keys for JSON output
          const transformedResult = {
            kata: result.word,
            entri: result.entries.map(entry => ({
              nama: entry.nama,
              nomor: entry.nomor || "",
              id: entry.id,
              akarkata: entry.rootWord || "",
              jenis: entry.jenis || "",
              makna: entry.makna?.map(meaning => ({
                definisi: meaning.definisi || "",
                kelaskata: meaning.kelasKata || [],
                contoh: meaning.contoh || []
              })) || [],
              turunan: entry.turunan || [],
              gabungan: entry.gabungan || [],
              peribahasa: entry.peribahasa || [],
              idiom: entry.idiom || []
            })),
            mirip: result.mirip || []
          };
          
          console.log(JSON.stringify(transformedResult, null, 2));
          return;
        }
        
        // Format and display each entry with full details
        result.entries.forEach(entry => {
          console.log(chalk.bold(`${entry.nama}${entry.nomor ? entry.nomor : ''}`));
          
          // Show entry type if available
          if (entry.jenis) {
            console.log(chalk.hex('#8B4513')(` ⟨${entry.jenis}⟩`));
          }
          
          // Show root word if available
          if (entry.rootWord) {
            console.log(chalk.gray(`   Kata Dasar: `) + chalk.white(entry.rootWord));
          }
          
          // Show etymology if available
          if (entry.etimologi && entry.etimologi.text) {
            console.log(chalk.gray(`   Etimologi: `) + chalk.yellow(entry.etimologi.text));
          }
          
          if (entry.makna && entry.makna.length > 0) {
            console.log(''); // Add empty line before meanings
            
            entry.makna.forEach((meaning, i) => {
              const meaningNumber = meaning.nomor || (i + 1);
              console.log(chalk.bold(`Makna #${meaningNumber}`));
              
              // Show word classes if available
              if (meaning.kelasKata && meaning.kelasKata.length > 0) {
                const classes = meaning.kelasKata.map(wc => 
                  `${wc.kode}${wc.nama ? ` (${wc.nama})` : ''}`).join(', ');
                console.log(chalk.gray(`   Kelas Kata: `) + chalk.white(classes));
              }
              
              // Show definition
              if (meaning.definisi) {
                console.log(chalk.gray(`   Definisi: `) + chalk.white(meaning.definisi));
              }
              
              // Show examples if available
              if (meaning.contoh && meaning.contoh.length > 0) {
                console.log('');
                meaning.contoh.forEach((example, j) => {
                  const exampleNumber = example.nomor || (j + 1);
                  console.log(chalk.bold.italic(`   Contoh #${meaningNumber}-${exampleNumber}`));
                  console.log(chalk.gray('      ') + chalk.italic.cyan(example.teks));
                  console.log('');
                });
              } else {
                console.log('');
              }
            });
          }
          
          // Show related words if available
          if (entry.turunan && entry.turunan.length > 0) {
            console.log(chalk.bold('Kata Turunan:'));
            console.log(chalk.cyan(entry.turunan.join('; ')));
            console.log('');
          }
          
          if (entry.gabungan && entry.gabungan.length > 0) {
            console.log(chalk.bold('Gabungan Kata:'));
            console.log(chalk.cyan(entry.gabungan.join('; ')));
            console.log('');
          }
          
          if (entry.peribahasa && entry.peribahasa.length > 0) {
            console.log(chalk.bold(`Peribahasa (mengandung [${entry.nama}]):`));
            console.log(chalk.cyan(entry.peribahasa.join('; ')));
            console.log('');
          }
          
          if (entry.idiom && entry.idiom.length > 0) {
            console.log(chalk.bold(`Idiom (mengandung [${entry.nama}]):`));
            console.log(chalk.cyan(entry.idiom.join('; ')));
            console.log('');
          }
          
          // Add a blank line between entries if there are multiple
          if (result.entries.length > 1) {
            console.log('');
          }
        });
      } catch (error) {
        // Restore console.log in case of error
        console.log = originalLog;
        
        if (error.message && (error.message.includes('not found') || error.message.includes('No entries'))) {
          if (flags.json) {
            console.log(JSON.stringify({
              kata: word,
              entri: [],
              error: "No entries found",
              mirip: []
            }, null, 2));
          } else {
            console.log(chalk.red('No entries found'));
          }
        } else {
          if (flags.json) {
            console.log(JSON.stringify({
              kata: word,
              error: error.message,
              entri: []
            }, null, 2));
          } else {
            console.error(chalk.red(`Error: ${error.message}`));
          }
        }
      }
    } else {
      // Use normal lookup mode
      const result = await kbbi.lookup(word);
      
      if (flags.json || flags.jsonDebug) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printResult(result);
      }
    }
  } catch (error) {
    handleError(error);
  }
}

/**
 * Handle login with email and password
 */
async function handleLogin(auth, email, password, visibleBrowser) {
  try {
    console.log(`Logging in as ${email}...`);
    await auth.login(email, password, !visibleBrowser);
    console.log(chalk.green('Login successful! Cookie saved for future use.'));
      } catch (error) {
    console.error(chalk.red(`Login failed: ${error.message}`));
  }
}

/**
 * Handle browser login
 */
async function handleBrowserLogin(auth) {
  try {
    await auth.browserLogin();
  } catch (error) {
    console.error(chalk.red(`Browser login failed: ${error.message}`));
  }
}

/**
 * Unified cookie management function
 */
async function handleCookieManagement(auth, command, args) {
  const parts = command.split(':');
  const action = parts[0].toLowerCase();
  let value = parts.length > 1 ? parts[1] : null;
  
  // If value wasn't provided in command format, check if it's the next argument
  if (!value && (action === 'add' || action === 'delete')) {
    const commandIndex = args.indexOf('--cookie-manage');
    if (commandIndex >= 0 && commandIndex + 2 < args.length && !args[commandIndex + 2].startsWith('--')) {
      value = args[commandIndex + 2];
    }
  }
  
  try {
    switch (action) {
      case 'add':
        if (!value) {
          console.error(chalk.red('Error: Cookie value is required for add action'));
          return;
        }
        await auth.addCookie(value);
        const cookies = await auth.loadCookies();
        console.log(chalk.green(`Cookie added successfully.`));
        console.log(`You now have ${cookies.length} ${cookies.length === 1 ? 'cookie' : 'cookies'} configured for rotation.`);
        break;
        
      case 'delete':
      case 'remove':
        if (!value) {
          console.error(chalk.red('Error: Cookie value is required for delete action'));
          return;
        }
        const removed = await auth.removeCookie(value);
        if (removed) {
          console.log(chalk.green(`Cookie removed successfully.`));
      } else {
          console.error(chalk.red('Failed to remove cookie or cookie not found.'));
        }
        break;
        
      case 'list':
        console.log(chalk.bold('===== KBBI Saved Cookies ====='));
        
        // Simple, direct cookie listing using raw code for reliable output
        const cookiesPath = auth.options.cookiesPath;
        let cookieCount = 0;
        let cookiesArray = [];
        
        try {
          if (fs.existsSync(cookiesPath)) {
            const data = fs.readFileSync(cookiesPath, 'utf8');
            cookiesArray = JSON.parse(data);
            
            if (Array.isArray(cookiesArray)) {
              cookieCount = cookiesArray.length;
          } else {
              cookieCount = 0;
              cookiesArray = [];
            }
          }
        } catch (err) {
          cookieCount = 0;
          cookiesArray = [];
        }
        
        if (cookieCount === 0) {
          console.log('No cookies found.');
    } else {
          console.log(`Found ${cookieCount} saved ${cookieCount === 1 ? 'cookie' : 'cookies'}:`);
          
          // Use simple loop to avoid issues with PowerShell output
          for (let i = 0; i < cookieCount; i++) {
            let displayValue = cookiesArray[i] || '';
            
            // Basic masking for long cookies
            if (displayValue.length > 10) {
              displayValue = displayValue.substring(0, 5) + '...' + 
                             displayValue.substring(displayValue.length - 5);
            }
            
            console.log(`${i + 1}. ${displayValue}`);
          }
          
          console.log('Note: Cookies are masked for security. Use --cookie-manage add to add more cookies.');
        }
        break;
        
      default:
        console.error(chalk.red(`Unknown cookie management command: ${action}`));
        console.log('Available commands:');
        console.log('  --cookie-manage add:VALUE     Add a new cookie');
        console.log('  --cookie-manage delete:VALUE  Delete a cookie');
        console.log('  --cookie-manage list          List all cookies');
    }
  } catch (error) {
    console.error(chalk.red(`Cookie management error: ${error.message}`));
    if (error.stack) {
      console.error(chalk.gray(error.stack));
    }
  }
}

/**
 * Handle save cookie (legacy)
 */
async function handleSaveCookie(auth, cookieValue) {
  try {
    await auth.addCookie(cookieValue);
    console.log(chalk.green('Cookie saved successfully!'));
  } catch (error) {
    console.error(chalk.red(`Error saving cookie: ${error.message}`));
  }
}

/**
 * Handle add cookie (legacy)
 */
async function handleAddCookie(auth, cookieValue) {
  try {
    await auth.addCookie(cookieValue);
    const result = await auth.listCookies();
    console.log(`You now have ${result.count} ${result.count === 1 ? 'cookie' : 'cookies'} configured for rotation.`);
  } catch (error) {
    console.error(chalk.red(`Error adding cookie: ${error.message}`));
  }
}

/**
 * Handle list cookies (legacy)
 */
async function handleListCookies(auth) {
  try {
    const result = await auth.listCookies();
    
    console.log(chalk.bold('===== KBBI Saved Cookies ====='));
    if (result.cookies.length === 0) {
      console.log('No cookies found.');
                          } else {
      console.log(`Found ${result.count} saved ${result.count === 1 ? 'cookie' : 'cookies'}:`);
      result.maskedCookies.forEach((cookie, index) => {
        console.log(`${index + 1}. ${cookie}`);
      });
      console.log('Note: Cookies are masked for security. Use --add-cookie to add more cookies.');
    }
  } catch (error) {
    console.error(chalk.red(`Error listing cookies: ${error.message}`));
  }
}

/**
 * Print the result to the console
 */
function printResult(result) {
  if (!result) {
    console.error(chalk.red('No result returned'));
    return;
  }
  
  if (!result.entries || result.entries.length === 0) {
    console.log(chalk.red('No entries found'));
    
    if (result.mirip && result.mirip.length > 0) {
      console.log(chalk.yellow('\nMirip:'));
      result.mirip.forEach(suggestion => {
        console.log(chalk.cyan(`  • ${suggestion}`));
      });
    }
    return;
  }
  
  // Direct output of entries without headers or separators
  result.entries.forEach(entry => {
    console.log(Utils.formatOutput(entry));
    
    // Add a single blank line between entries if there are multiple
    if (result.entries.length > 1) {
      console.log('');
    }
  });
}

/**
 * Handle errors
 */
function handleError(error) {
  if (error.name === 'CloudflareBlockError') {
    console.error(chalk.red('Error: Cloudflare protection detected'));
    console.error(chalk.yellow('Try again with --visible to solve the challenge manually,'));
    console.error(chalk.yellow('or login to obtain a valid cookie using --login'));
  } else if (error.name === 'AuthenticationError') {
    console.error(chalk.red(`Authentication error: ${error.message}`));
    console.error(chalk.yellow('Try logging in again with --login'));
  } else if (error.name === 'NotFoundError') {
    console.error(chalk.red(`Not found: ${error.message}`));
  } else {
    console.error(chalk.red(`Error: ${error.message}`));
    if (error.stack && process.env.DEBUG) {
      console.error(chalk.gray(error.stack));
    }
  }
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
  ${chalk.bold('KBBI CLI Tool')}
  
  ${chalk.bold('Usage:')}
    ${chalk.gray('node cli.js [word] [options]')}
  
  ${chalk.bold('Options:')}
    ${chalk.gray('--login')}           Open login UI or login with credentials
    ${chalk.gray('--email [email]')}   Email for KBBI login (with --login)
    ${chalk.gray('--password [pwd]')}  Password for KBBI login (with --login)
    ${chalk.gray('--cookie [string]')} Specify cookie string to use
    ${chalk.gray('--cookie-manage [command]')} Manage cookies (add:VALUE, delete:VALUE, list)
    ${chalk.gray('--save-cookie [string]')} Save cookie string for future use (deprecated)
    ${chalk.gray('--add-cookie [string]')} Add an additional cookie for rotation (deprecated)
    ${chalk.gray('--list-cookies')}    List all saved cookies (deprecated)
    ${chalk.gray('--visible')}         Show browser during operations
    ${chalk.gray('--debug')}           Save debug files (HTML, screenshots)
    ${chalk.gray('--json-debug')}      Show debug data as JSON in console output
    ${chalk.gray('--json')}            Output results in JSON format
    ${chalk.gray('--scrape')}          Scrape entry IDs and output in JSON format
    ${chalk.gray('--help')}            Show this help message
  `);
}

// Execute the main function
if (require.main === module) {
main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
}); 
}

// Export the main functionality for programmatic use
module.exports = {
  main,
  handleLogin,
  handleBrowserLogin,
  handleSaveCookie,
  handleAddCookie,
  handleListCookies
}; 