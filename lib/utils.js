const path = require('path');
const fs = require('fs');
const chalk = require('chalk');

class Utils {
  static wrapText(text, width = 80) {
    if (!text) return '';
    if (text.length <= width) return text;

    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 > width) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.join('\n');
  }

  static ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return dirPath;
  }

  /**
   * Ensures the debug directory exists and cleans up old files
   * @param {string} baseDir - Base directory (usually __dirname)
   * @param {Object} options - Options for debug directory management
   * @param {number} options.maxFiles - Maximum number of files to keep (default: 10)
   * @param {number} options.maxAgeDays - Maximum age of files in days (default: 7)
   * @returns {string} - Path to the debug directory
   */
  static ensureDebugDirectory(baseDir, options = {}) {
    const { maxFiles = 10, maxAgeDays = 7 } = options;
    const debugDir = path.join(baseDir, 'debug');
    
    // Create directory if it doesn't exist
    this.ensureDirectory(debugDir);
    
    // Clean up old files
    this.cleanupDebugFiles(debugDir, { maxFiles, maxAgeDays });
    
    return debugDir;
  }

  /**
   * Cleans up old debug files
   * @param {string} debugDir - Path to the debug directory
   * @param {Object} options - Options for cleanup
   * @param {number} options.maxFiles - Maximum number of files to keep
   * @param {number} options.maxAgeDays - Maximum age of files in days
   */
  static cleanupDebugFiles(debugDir, options = {}) {
    const { maxFiles = 10, maxAgeDays = 7 } = options;
    
    try {
      // Get all files in the debug directory
      const files = fs.readdirSync(debugDir)
        .filter(file => fs.statSync(path.join(debugDir, file)).isFile())
        .map(file => {
          const filePath = path.join(debugDir, file);
          const stats = fs.statSync(filePath);
          return {
            name: file,
            path: filePath,
            mtime: stats.mtime
          };
        })
        .sort((a, b) => b.mtime - a.mtime); // Sort by modified time (newest first)
      
      // Delete files that exceed the maximum age
      const now = new Date();
      const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
      
      const filesToDelete = [];
      
      // First identify files that are too old
      for (const file of files) {
        const ageMs = now - file.mtime;
        if (ageMs > maxAgeMs) {
          filesToDelete.push(file);
        }
      }
      
      // Then identify excess files beyond the maximum count
      const remainingFiles = files.filter(file => !filesToDelete.includes(file));
      if (remainingFiles.length > maxFiles) {
        const excessFiles = remainingFiles.slice(maxFiles);
        filesToDelete.push(...excessFiles);
      }
      
      // Delete the identified files
      for (const file of filesToDelete) {
        fs.unlinkSync(file.path);
      }
      
      if (filesToDelete.length > 0) {
        console.log(chalk.gray(`Cleaned up ${filesToDelete.length} old debug files`));
      }
    } catch (error) {
      console.error(chalk.red(`Error cleaning up debug files: ${error.message}`));
    }
  }

  /**
   * Saves HTML content to a debug file
   * @param {string} baseDir - Base directory (usually __dirname)
   * @param {string} filename - Name of the file to save
   * @param {string} content - HTML content to save
   * @returns {boolean} - Whether the file was saved successfully
   */
  static saveDebugFile(baseDir, filename, content) {
    try {
      const debugDir = this.ensureDebugDirectory(baseDir);
      const filePath = path.join(debugDir, filename);
      fs.writeFileSync(filePath, content);
      console.log(chalk.gray(`Debug: Saved ${filename}`));
      return true;
    } catch (error) {
      console.error(chalk.red(`Error saving debug file: ${error.message}`));
      return false;
    }
  }

  static buildUrl(word) {
    return `https://kbbi.kemdikbud.go.id/entri/${encodeURIComponent(word)}`;
  }

  static formatOutput(entry, showExamples = true) {
    if (!entry) return 'No entry data available';

    const result = [];

    // Format entry name with homonym number if present
    let header = entry.nama || '';
    if (entry.nomor) {
      header += this.toSuperscript(entry.nomor);
    }
    result.push(chalk.bold(header));
    
    // Add entry type if available (peribahasa, idiom, etc.)
    if (entry.jenis) {
      result.push(chalk.hex('#8B4513')(` ⟨${entry.jenis}⟩`)); // Saddlebrown color with special formatting
    }
    
    // Add root word if available
    if (entry.rootWord) {
      result.push(chalk.gray(`   Kata Dasar: `) + chalk.white(entry.rootWord));
    }

    // Add etymology if available
    if (entry.etimologi && entry.etimologi.text) {
      result.push(chalk.gray(`   Etimologi: `) + chalk.yellow(entry.etimologi.text));
    }

    // Format meanings
    if (entry.makna && entry.makna.length > 0) {
      result.push(''); // Add empty line before meanings

      entry.makna.forEach((meaning) => {
        const meaningNumber = meaning.nomor || '';
        result.push(chalk.bold(`Makna #${meaningNumber}`));

        // Add word classes if available
        if (meaning.kelasKata && meaning.kelasKata.length > 0) {
          const classes = meaning.kelasKata.map(wc => 
            `${wc.kode}${wc.nama ? ` (${wc.nama})` : ''}`).join(',');
          result.push(chalk.gray(`   Kelas Kata: `) + chalk.white(classes));
        }

        // Add definition
        if (meaning.definisi) {
          result.push(chalk.gray(`   Definisi: `) + chalk.white(meaning.definisi));
        }

        // Add examples if available and requested
        if (showExamples && meaning.contoh && meaning.contoh.length > 0) {
          result.push('');
          meaning.contoh.forEach((example) => {
            const exampleNumber = example.nomor || '';
            result.push(chalk.bold.italic(`   Contoh #${meaningNumber}-${exampleNumber}`));
            result.push(chalk.gray('      ') + chalk.italic.cyan(example.teks));
            result.push('');
          });
        } else {
          result.push('');
        }
      });
    }

    // Format related words if available
    if (entry.terkait) {
      // Add derivatives (kata turunan) if available
      if (entry.terkait.kataTurunan && entry.terkait.kataTurunan.length > 0) {
        result.push(chalk.bold.magenta('Kata Turunan:'));
        result.push(this.wrapText(entry.terkait.kataTurunan.map(w => chalk.cyan(w)).join('; ')));
      }

      // Add compound words (gabungan kata) if available
      if (entry.terkait.gabunganKata && entry.terkait.gabunganKata.length > 0) {
        result.push('');
        result.push(chalk.bold.magenta('Gabungan Kata:'));
        result.push(this.wrapText(entry.terkait.gabunganKata.map(w => chalk.cyan(w)).join('; ')));
      }

      // Add proverbs (peribahasa) if available
      if (entry.terkait.peribahasa && entry.terkait.peribahasa.length > 0) {
        result.push('');
        result.push(chalk.bold.magenta(`Peribahasa (mengandung [${entry.nama}]):`));
        result.push(this.wrapText(entry.terkait.peribahasa.map(p => chalk.yellow(p)).join('; ')));
      }

      // Add idioms if available
      if (entry.terkait.idiom && entry.terkait.idiom.length > 0) {
        result.push('');
        result.push(chalk.bold.magenta(`Idiom (mengandung [${entry.nama}]):`));
        result.push(this.wrapText(entry.terkait.idiom.map(i => chalk.yellow(i)).join('; ')));
      }
    }

    return result.join('\n');
  }

  static toSuperscript(number) {
    if (!number) return '';
    const superscripts = {
      '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
      '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
    };
    return number.toString().split('').map(char => superscripts[char] || char).join('');
  }

  static formatJson(data) {
    try {
      return JSON.stringify(data, null, 2);
    } catch (error) {
      return `Error formatting JSON: ${error.message}`;
    }
  }
}

module.exports = Utils; 