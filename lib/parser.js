const cheerio = require('cheerio');
const { NotFoundError } = require('./errors');

/**
 * Parser for KBBI website
 * Supports both direct extraction and detailed scraping
 */
class KBBIParser {
  constructor(html, isAuthenticated = false) {
    this.$ = cheerio.load(html);
    this.isAuthenticated = isAuthenticated;
  }

  /**
   * Parse entries from search result page
   * @returns {Object} Object containing entries and mirip
   */
  parseEntries() {
    const entries = [];
    const entryHeadings = this.$('h2[style*="margin-bottom:3px"]');

    if (entryHeadings.length === 0) {
      const notFoundMsg = this.$('div:contains("Entri tidak ditemukan")');
      if (notFoundMsg.length > 0) {
        return { entries: [], mirip: this.parseMirip() };
      }
    }

    // Handle details page detection
    const isDetailsPage = this.$('.page-header h2:contains("Detail Data")').length > 0;
    if (isDetailsPage) {
      const entry = this.parseDetailsPage();
      if (entry) {
        entries.push(entry);
      }
      return { entries };
    }

    // Process entries from search results page
    entryHeadings.each((index, h2) => {
      const entry = this.parseEntryDirectly(this.$(h2));
      if (entry) {
        entries.push(entry);
      }
    });

    return { entries };
  }

  /**
   * Parse entry directly from search results page
   * @param {Object} $h2 - jQuery object of h2 element
   * @returns {Object|null} Entry object or null if invalid
   */
  parseEntryDirectly($h2) {
    if (!$h2 || !$h2.length) return null;
    
    // Extract basic entry information
    const entryName = this.extractText($h2).trim();
    if (!entryName) return null;
    
    // Extract entry ID
    const entryId = this.extractId($h2);
    
    // Extract homonym number (superscript)
    const homonymNumber = this.extractNumber($h2);
    
    // Create entry object
    const entry = {
      id: entryId,
      nama: entryName.replace(/\s*\u00B9|\u00B2|\u00B3|\u2074|\u2075|\u2076|\u2077|\u2078|\u2079|\u2070/g, ''), // Remove superscripts from name
      nomor: homonymNumber,
      makna: []
    };
    
    // Extract entry type if available (peribahasa, idiom, etc.)
    const entryType = this.extractEntryType($h2);
    if (entryType) {
      entry.jenis = entryType;
    }
    
    // Extract root word if available
    const rootWord = this.extractRootWord($h2);
    if (rootWord) {
      entry.rootWord = rootWord;
    }
    
    // Find the list of meanings for this entry
    const $meaningsList = $h2.nextUntil('h2, h4', 'ol, ul').first();
    
    if ($meaningsList.length) {
      // Process each list item as a meaning
      $meaningsList.children('li').each((i, li) => {
        const $li = this.$(li);
        
        // Skip "Usulkan makna baru" items
        if ($li.text().includes('Usulkan makna baru')) return;
        
        // Extract meaning number (if available)
        const meaningNumber = i + 1;
        
        // Extract word classes
        const wordClasses = this.extractWordClasses($li);
        
        // Extract definition
        const definition = this.extractDefinition($li);
        
        // Extract examples
        const examples = this.extractExamples($li);
        
        // Add meaning to entry
        if (definition) {
          entry.makna.push({
            nomor: meaningNumber.toString(),
            kelasKata: wordClasses,
            definisi: definition,
            contoh: examples
          });
        }
      });
    } else {
      // Try alternative extraction for compound words or special entries
      const meanings = this.extractMeaningsDirectly($h2);
      if (meanings && meanings.length) {
        entry.makna = meanings;
      }
    }
    
    // Extract etymology if available
    const etymology = this.extractEtymology($h2);
    if (etymology) {
      entry.etimologi = etymology;
    }
    
    // Extract related words
    const related = this.extractRelated($h2);
    if (related) {
      entry.terkait = related;
    }
    
    return entry;
  }

  /**
   * Parse entry for scraping (basic information only)
   * @param {Object} $h2 - jQuery object of the h2 element
   * @returns {Object} Entry object with basic identification info
   */
  parseEntry($h2) {
    // For scraping, we only need the basic ID information
    const nama = this.extractText($h2);
    const nomor = this.extractNumber($h2);
    const id = this.extractId($h2);
    const rootWord = this.extractRootWord($h2);
    
    if (!id) {
      return null;
    }
    
    return { nama, nomor, id, rootWord };
  }

  /**
   * Parse a details page
   * @returns {Object} Entry object with detailed information
   */
  parseDetailsPage() {
    const result = {};
    
    // Extract basic information from rows
    this.$('.row').each((i, row) => {
      const $row = this.$(row);
      const label = $row.find('.col-md-2 b').text().trim();
      const value = $row.find('.col-md-10').text().trim();
      
      // Skip empty or "Tidak tersedia" values
      if (!value || value === '(Tidak tersedia)') return;
      
      // Map common fields
      switch (label) {
        case 'Eid': result.id = value; break;
        case 'Entri': result.nama = value; break;
        case 'Id Homonim': result.nomor = value; break;
        case 'Jenis Entri': result.jenis = value; break;
        case 'Induk Kata': 
          // Process parent word/root word if available
          if (value) {
            const match = value.match(/(.+?)\s*\(Eid:\s*(\d+)\)/);
            if (match) {
              result.rootWord = match[1].trim();
            } else {
              result.rootWord = value;
            }
          }
          break;
        case 'Makna': 
          if (!result.makna) result.makna = [];
          result.makna.push({
            definisi: value,
            kelasKata: [],
            contoh: []
          });
          break;
        case 'Kelas Kata':
          if (result.makna && result.makna.length > 0) {
            const lastMakna = result.makna[result.makna.length - 1];
            const match = value.match(/^(\w+)\s+\((.*?)\)$/);
            if (match) {
              lastMakna.kelasKata = [{
                kode: match[1],
                nama: match[2]
              }];
            } else {
              // Handle multiple word classes
              const classes = value.split(',').map(cls => {
                const parts = cls.trim().match(/^(\w+)\s+\((.*?)\)$/);
                if (parts) {
                  return { kode: parts[1], nama: parts[2] };
                }
                return { kode: cls.trim(), nama: '' };
              });
              lastMakna.kelasKata = classes;
            }
          }
          break;
        case 'Contoh': 
          // Sometimes the details page directly contains examples in rows
          if (result.makna && result.makna.length > 0) {
            const lastMakna = result.makna[result.makna.length - 1];
            if (!lastMakna.contoh) lastMakna.contoh = [];
            
            lastMakna.contoh.push({
              nomor: lastMakna.contoh.length + 1,
              teks: value
            });
          }
          break;
      }
    });

    // Find all example headers and extract the actual examples
    this.$('h4').filter((_, h4) => {
      return this.$(h4).text().trim().startsWith('Contoh #');
    }).each((_, h4) => {
      const match = this.$(h4).text().match(/Contoh #(\d+)-(\d+)/);
      if (!match) return;
      
      const meaningNum = parseInt(match[1]);
      const exampleNum = parseInt(match[2]);
      
      if (!result.makna || meaningNum > result.makna.length) return;
      
      const meaning = result.makna[meaningNum - 1];
      if (!meaning.contoh) meaning.contoh = [];
      
      // Find the row containing the example text
      const $rows = this.$(h4).nextUntil('h4', '.row');
      let exampleText = '';
      
      $rows.each((_, row) => {
        const $row = this.$(row);
        const label = $row.find('.col-md-2 b').text().trim();
        
        if (label === 'Contoh') {
          exampleText = $row.find('.col-md-10').text().trim();
          // Stop the loop after finding the example
          return false;
        }
      });
      
      // Only add if we found actual text
      if (exampleText && exampleText !== '(Tidak tersedia)') {
        // Replace example with same number if it exists, otherwise add new
        const existingIndex = meaning.contoh.findIndex(ex => ex.nomor === exampleNum);
        
        const cleanedText = exampleText.replace(/\[(.*?)\]/g, '$1').trim();
        
        if (existingIndex >= 0) {
          meaning.contoh[existingIndex].teks = cleanedText;
        } else {
          meaning.contoh.push({
            nomor: exampleNum,
            teks: cleanedText
          });
        }
      }
    });
    
    // Try to find root word in title if not already found
    if (!result.rootWord) {
      const $title = this.$('.page-header h2');
      if ($title.length) {
        const $rootWord = $title.find('.rootword a');
        if ($rootWord.length) {
          let rootText = $rootWord.text().trim();
          const $sup = $rootWord.find('sup');
          if ($sup.length) {
            rootText += this.toSuperscript($sup.text().trim());
          }
          result.rootWord = rootText;
        }
      }
    }
    
    // Handle compound words specially - check if the name has a space in it
    if (result.nama && result.nama.includes(' ')) {
      // If we don't have any meanings yet, or they're incomplete, try specialized handling
      if (!result.makna || result.makna.length === 0 || 
          (result.makna.length > 0 && result.makna.every(m => !m.definisi || m.definisi === '→'))) {
        
        // Try to extract meanings using compound word specific logic
        const compoundMeanings = this.extractCompoundWordMeanings(this.$('h2').first());
        if (compoundMeanings && compoundMeanings.length > 0) {
          result.makna = compoundMeanings;
        }
      }
    }
    
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Extract text directly from an element
   * @param {Object} $element - jQuery element
   * @returns {string} Extracted text
   */
  extractText($element) {
    // If element has an italic tag, use that for the name
    const $italic = $element.find('i');
    if ($italic.length) {
      return $italic.text().trim();
    }
    
    // Otherwise get the text directly, removing any child elements
    return $element.clone().children().remove().end().text().trim();
  }

  /**
   * Extract homonym number
   * @param {Object} $h2 - jQuery object
   * @returns {string} Number as string
   */
  extractNumber($h2) {
    const $sup = $h2.find('sup');
    return $sup.length ? $sup.text().trim() : '';
  }

  /**
   * Extract entry ID
   * @param {Object} $h2 - jQuery object
   * @returns {string} Entry ID
   */
  extractId($h2) {
    // First try finding in edit links
    const $editLinks = $h2.find('a[href*="Edit"]');
    if ($editLinks.length) {
      const href = $editLinks.attr('href');
      const match = href.match(/eid=(\d+)/);
      if (match) return match[1];
    }
    
    // Then try in view links
    const $viewLinks = $h2.find('a[href*="View"]');
    if ($viewLinks.length) {
      const href = $viewLinks.attr('href');
      const match = href.match(/\/(\d+)/);
      if (match) return match[1];
    }
    
    // Try parent container links
    const $parentLinks = $h2.parent().find('a[href*="entri"]');
    if ($parentLinks.length) {
      const href = $parentLinks.attr('href');
      const match = href.match(/\/(\d+)/);
      if (match) return match[1];
    }
    
    return null;
  }

  /**
   * Extract meanings directly from the search results page
   * @param {Object} $h2 - jQuery object of h2 element
   * @returns {Array} Array of meaning objects
   */
  extractMeaningsDirectly($h2) {
    const meanings = [];
    
    // Find the list elements that contain meanings
    // First try ordered list (ol) which is the standard format
    let $list = $h2.nextUntil('h2, h4', 'ol').first();
    
    // If no ordered list, try unordered list (ul) which is used for some entries
    if (!$list.length) {
      $list = $h2.nextUntil('h2, h4', 'ul').first();
    }
    
    // If we found a list, process each list item
    if ($list.length) {
      $list.children('li').each((i, li) => {
        const $li = this.$(li);
        
        // Skip "Usulkan makna baru" items
        if ($li.text().includes('Usulkan makna baru')) return;
        
        // Extract meaning number (if available)
        const meaningNumber = i + 1;
        
        // Extract word classes
        const wordClasses = this.extractWordClasses($li);
        
        // Extract definition
        const definition = this.extractDefinition($li);
        
        // Extract examples
        const examples = this.extractExamples($li);
        
        // Add meaning to array
        if (definition) {
          meanings.push({
            nomor: meaningNumber.toString(),
            kelasKata: wordClasses,
            definisi: definition,
            contoh: examples
          });
        }
      });
    } else {
      // For entries that don't use a list format, try to extract from the text
      // This is common for some special entries like abbreviations
      
      // Look for text after the heading but before the next heading
      const $content = $h2.nextUntil('h2, h4');
      
      if ($content.length) {
        // Extract text content
        let text = '';
        $content.each((i, el) => {
          // Skip certain elements
          if (this.$(el).is('h4') || this.$(el).is('br')) return;
          
          // Add text content
          text += this.$(el).text().trim() + ' ';
        });
        
        // Clean up text
        text = text.trim();
        
        if (text && !text.includes('Usulkan makna baru')) {
          // Extract word classes from the text
          const wordClasses = [];
          
          // Look for common word class patterns
          const classMatch = text.match(/\b(n|v|a|adv|num|p|pron)\b/);
          if (classMatch) {
            const code = classMatch[1];
            let name = '';
            
            // Map common codes to names
            switch (code) {
              case 'n': name = 'Nomina'; break;
              case 'v': name = 'Verba'; break;
              case 'a': name = 'Adjektiva'; break;
              case 'adv': name = 'Adverbia'; break;
              case 'num': name = 'Numeralia'; break;
              case 'p': name = 'Partikel'; break;
              case 'pron': name = 'Pronomina'; break;
            }
            
            if (name) {
              wordClasses.push({
                kode: code,
                nama: name
              });
            }
            
            // Remove the word class from the text
            text = text.replace(classMatch[0], '').trim();
          }
          
          // Add as a single meaning
          meanings.push({
            nomor: '1',
            kelasKata: wordClasses,
            definisi: text,
            contoh: []
          });
        }
      }
    }
    
    return meanings;
  }

  /**
   * Special extraction for compound words which often have a different structure
   * @param {Object} $h2 - jQuery object of entry heading
   * @returns {Array} Array of meaning objects
   */
  extractCompoundWordMeanings($h2) {
    const meanings = [];
    
    // For compound words, the structure is often:
    // 1. A heading (h2)
    // 2. Followed by a list (ol) with items (li) containing definitions
    
    // Start by finding the closest list
    let $ol = $h2.nextAll('ol').first();
    
    // If not found directly after, try the parent container
    if (!$ol.length) {
      const $container = $h2.parent();
      $ol = $container.find('ol').first();
    }
    
    // If we found a list, process the items
    if ($ol.length) {
      $ol.find('li').each((i, li) => {
        const $li = this.$(li);
        const text = $li.text().trim();
        
        // Skip "usulkan makna baru" items
        if (text.includes('Usulkan makna baru')) {
          return;
        }
        
        // Extract word classes, definition, and examples
        const wordClasses = this.extractWordClasses($li);
        let definitionText = text;
        
        // Remove word class markers
        $li.find('[color="red"], font[color="red"]').each((_, el) => {
          definitionText = definitionText.replace(this.$(el).text(), '');
        });
        
        // Clean up the definition
        definitionText = definitionText.replace(/^\s*[;:]\s*|\s*[;:]\s*$/, '').trim();
        
        // Check if there are examples (separated by colon)
        const examples = [];
        const colonIndex = definitionText.indexOf(':');
        
        if (colonIndex !== -1) {
          const examplesText = definitionText.substring(colonIndex + 1).trim();
          definitionText = definitionText.substring(0, colonIndex).trim();
          
          if (examplesText) {
            // Split by semicolons to get multiple examples
            examplesText.split(';').forEach((ex, index) => {
              const exampleText = ex.trim();
              if (exampleText) {
                examples.push({
                  nomor: index + 1,
                  teks: exampleText
                });
              }
            });
          }
        }
        
        // Create the meaning object
        if (definitionText) {
          meanings.push({
            nomor: i + 1,
            kelasKata: wordClasses,
            definisi: definitionText,
            contoh: examples,
            kiasan: $li.find('i:contains("ki")').length > 0
          });
        }
      });
    }
    
    // If no meanings found, look for paragraph-style definitions
    if (meanings.length === 0) {
      // Try to find paragraph elements following the heading
      let found = false;
      const $container = $h2.parent().parent(); // Go up two levels to find the container
      
      // Find paragraphs or divs with text inside the container
      $container.find('p, div').each((i, el) => {
        // Skip if we already passed another heading
        if (this.$(el).prevAll('h2').first().get(0) !== $h2.get(0)) {
          return;
        }
        
        const text = this.$(el).text().trim();
        if (text && text.length > 5 && !text.includes('Usulkan makna baru')) {
          meanings.push({
            nomor: meanings.length + 1,
            kelasKata: [],
            definisi: text,
            contoh: [],
            kiasan: false
          });
          found = true;
        }
      });
      
      // If still no definitions found, try direct text nodes
      if (!found) {
        let nextNode = $h2.get(0).nextSibling;
        while (nextNode) {
          if (nextNode.nodeType === 3) { // Text node
            const text = nextNode.nodeValue.trim();
            if (text && text.length > 5) {
              meanings.push({
                nomor: meanings.length + 1,
                kelasKata: [],
                definisi: text,
                contoh: [],
                kiasan: false
              });
              found = true;
            }
          } else if (nextNode.nodeType === 1 && nextNode.tagName.toLowerCase() === 'h2') {
            // Stop if we reach another h2
            break;
          }
          nextNode = nextNode.nextSibling;
        }
      }
    }
    
    return meanings;
  }

  /**
   * Extract word classes
   * @param {Object} $li - jQuery object
   * @returns {Array} Array of word class objects
   */
  extractWordClasses($li) {
    const classes = [];
    
    // Exclusively look for red-colored elements which contain word classes
    // This avoids misinterpreting parts of the definition as word classes
    
    // Method 1: Extract from font color="red" elements with span title attributes
    $li.find('font[color="red"] span[title], [color="red"] span[title]').each((i, span) => {
      const $span = this.$(span);
      const code = $span.text().trim();
      const title = $span.attr('title');
      
      if (code && title) {
        const parts = title.split(':');
        const name = parts[0]?.trim() || '';
        
        classes.push({
          kode: code,
          nama: name
        });
      }
    });
    
    // Method 2: Extract directly from font[color="red"] elements
    if (classes.length === 0) {
      // Find all red-colored font elements
      $li.find('font[color="red"], [color="red"]').each((i, font) => {
        const $font = this.$(font);
        
        // Skip if this is inside another element we've already processed
        if ($font.parents('font[color="red"], [color="red"]').length > 0) return;
        
        // Get the text content
        const fontText = $font.text().trim();
        
        if (fontText) {
          // Split by spaces to get individual class codes
          const parts = fontText.split(/\s+/);
          
          parts.forEach(part => {
            const cleanPart = part.trim();
            if (cleanPart && cleanPart !== ',' && cleanPart !== ';' && cleanPart !== '(' && cleanPart !== ')') {
              let name = '';
              
              // Find any span with title inside this element
              const $titleSpan = $font.find('span[title]');
              if ($titleSpan.length > 0) {
                const title = $titleSpan.attr('title');
                if (title) {
                  const titleParts = title.split(':');
                  name = titleParts[0]?.trim() || '';
                }
              } else {
                // Map common codes to names if no title is available
                switch (cleanPart) {
                  case 'n': name = 'Nomina'; break;
                  case 'v': name = 'Verba'; break;
                  case 'a': name = 'Adjektiva'; break;
                  case 'adv': name = 'Adverbia'; break;
                  case 'num': name = 'Numeralia'; break;
                  case 'p': name = 'Partikel'; break;
                  case 'pron': name = 'Pronomina'; break;
                  case 'ki': name = 'kiasan'; break;
                  case 'Jp': name = 'Jepang'; break;
                  case 'sing': name = 'singkatan'; break;
                  case 'Komp': name = 'Komputer'; break;
                  case 'Prw': name = 'Pariwisata'; break;
                  case 'Kap': name = 'Perkapalan'; break;
                  default: name = ''; break;
                }
              }
              
              // Only add if we have a valid code
              if (cleanPart) {
                classes.push({
                  kode: cleanPart,
                  nama: name
                });
              }
            }
          });
        }
      });
    }
    
    return classes;
  }
  
  /**
   * Map language or special codes to descriptive names
   * @param {string} code - Language or special code
   * @returns {string} Descriptive name
   */
  mapLanguageCode(code) {
    const map = {
      'Jp': 'Jepang',
      'Cn': 'Cina',
      'Ar': 'Arab',
      'Skt': 'Sanskerta',
      'Jw': 'Jawa',
      'Sd': 'Sunda',
      'Eng': 'Inggris',
      'kl': 'Klasik',
      'ki': 'Kiasan',
      'cak': 'Cakapan'
    };
    
    return map[code] || code;
  }

  /**
   * Extract definition from li element
   * @param {Object} $li - jQuery object
   * @returns {string} Definition text
   */
  extractDefinition($li) {
    // Clone the element to avoid modifying the original
    const $clone = $li.clone();
    
    // Remove elements we don't want in the definition
    $clone.find('font[color="grey"], [color="grey"]').remove();
    $clone.find('font[color="red"], [color="red"]').remove();
    $clone.find('.entrisButton').remove();
    
    // Get the text content of what remains
    let definition = $clone.text().trim();
    
    // Clean up the definition
    definition = definition.replace(/\s+/g, ' '); // Replace multiple spaces with single space
    definition = definition.replace(/^\s*:\s*/, ''); // Remove leading colon
    definition = definition.replace(/\s*[;:]\s*$/, ''); // Remove trailing semicolon or colon
    
    // Remove unwanted characters
    definition = definition.replace(/^[-–—•\s]+/, '');
    
    return definition || 'Tidak tersedia';
  }

  /**
   * Extract examples
   * @param {Object} $li - jQuery object
   * @returns {Array} Array of example objects
   */
  extractExamples($li) {
    const examples = [];
    
    // Look for grey font elements which typically contain examples
    const $exampleElements = $li.find('font[color="grey"]');
    if ($exampleElements.length) {
      $exampleElements.each((i, el) => {
        const text = this.$(el).text().trim();
        if (text) {
          examples.push({
            nomor: i + 1,
            teks: text
          });
        }
      });
    } else {
      // If no specific example elements, try to find examples after a colon
      const text = $li.text().trim();
      const colonIndex = text.indexOf(':');
      
      if (colonIndex !== -1) {
        const examplesText = text.substring(colonIndex + 1).trim();
        if (examplesText) {
          // Split by semicolons for multiple examples
          examplesText.split(';').forEach((ex, index) => {
            const exampleText = ex.trim();
            if (exampleText) {
              examples.push({
                nomor: index + 1,
                teks: exampleText
              });
            }
          });
        }
      }
    }
    
    return examples;
  }
  
  /**
   * Extract etymology information
   * @param {Object} $h2 - jQuery object
   * @returns {Object|null} Etymology object or null
   */
  extractEtymology($h2) {
    // Simplified approach: directly search for the etymology pattern in the HTML
    const htmlContent = this.$.html();
    
    // Look for the typical etymology pattern: label followed by bracketed content
    const etymologyRegex = /Etimologi:<\/b>\s*\[(.*?)\]/i;
    const match = htmlContent.match(etymologyRegex);
    
    if (match && match[1]) {
      const etymologyContent = match[1].trim();
      
      // Extract language name - typically in <i> tags with darkred color
      const langRegex = /<i[^>]*color:darkred[^>]*>(.*?)<\/i>/i;
      const langMatch = etymologyContent.match(langRegex);
      
      const languages = [];
      if (langMatch && langMatch[1]) {
        languages.push(langMatch[1].trim());
      }
      
      // Clean up the etymology text by removing HTML tags
      const cleanText = etymologyContent
        .replace(/<[^>]*>/g, ' ')  // Replace HTML tags with spaces
        .replace(/\s+/g, ' ')      // Normalize whitespace
        .trim();
      
      return {
        text: `[${cleanText}]`,
        languages
      };
    }
    
    return null;
  }
  
  /**
   * Extract related words
   * @param {Object} $h2 - jQuery object
   * @returns {Object|null} Related words object or null
   */
  extractRelated($h2) {
    const related = {
      kataTurunan: [],
      gabunganKata: [],
      peribahasa: [],
      idiom: []
    };
    
    // Find all section headings (h4) that follow the main entry heading
    const $sections = $h2.nextAll('h4');
    
    $sections.each((_, section) => {
      const $section = this.$(section);
      const headingText = $section.text().trim();
      
      // Based on the heading text, determine which type of related words this is
      let relatedType = null;
      if (headingText.includes('Kata Turunan')) {
        relatedType = 'kataTurunan';
      } else if (headingText.includes('Gabungan Kata')) {
        relatedType = 'gabunganKata';
      } else if (headingText.includes('Peribahasa')) {
        relatedType = 'peribahasa';
      } else if (headingText.includes('Idiom')) {
        relatedType = 'idiom';
      }
      
      if (relatedType) {
        // Find the element containing the related words (usually a ul following the heading)
        const $container = $section.next('ul');
        if ($container.length) {
          // Extract links within the container
          $container.find('a').each((_, link) => {
            const text = this.$(link).text().trim();
            if (text && !related[relatedType].includes(text)) {
              related[relatedType].push(text);
            }
          });
        }
      }
    });
    
    // Only return if we found any related words
    return (
      related.kataTurunan.length ||
      related.gabunganKata.length ||
      related.peribahasa.length ||
      related.idiom.length
    ) ? related : null;
  }
  
  /**
   * Parse mirip when word is not found
   * @returns {Array} Array of mirip strings
   */
  parseMirip() {
    const mirip = [];
    
    // Look for mirip in the standard location
    this.$('.col-md-3').each((i, el) => {
      const text = this.$(el).text().trim();
      if (text) {
        mirip.push(text);
      }
    });
    
    // Also check alternate locations
    this.$('ul.daftar-selaras li a').each((i, el) => {
      const text = this.$(el).text().trim();
      if (text) {
        mirip.push(text);
      }
    });
    
    return mirip;
  }

  /**
   * Check if user is authenticated
   * @returns {boolean} Authentication status
   */
  checkAuthentication() {
    // Look for login/logout indicators
    return (
      this.$('a:contains("Keluar")').length > 0 ||
      this.$('button:contains("Keluar")').length > 0
    );
  }

  /**
   * Extract root word from entry heading
   * @param {Object} $h2 - jQuery object of h2 element
   * @returns {string|null} Root word text or null if not present
   */
  extractRootWord($h2) {
    // Look for root word in different formats
    // Method 1: Using ul elements on the page with links containing the root word
    const rootWords = [];
    
    // Check parent page structure for kata dasar (root word) section
    this.$('h4:contains("Kata Dasar")').next('ul').find('a').each((i, link) => {
      const rootText = this.$(link).text().trim();
      if (rootText) rootWords.push(rootText);
    });
    
    // Method 2: Look for rootword span or links in the heading
    if (rootWords.length === 0) {
      const $rootWord = $h2.find('.rootword');
      if ($rootWord.length) {
        // Extract text from the link inside rootword span
        const $link = $rootWord.find('a');
        if ($link.length) {
          let rootText = $link.text().trim();
      
          // If there's a superscript, include it
          const $sup = $link.find('sup');
          if ($sup.length) {
            const supText = $sup.text().trim();
            if (supText) {
              rootText += this.toSuperscript(supText);
            }
          }
        
          // Remove any stray numbers that might appear before the superscript (e.g., "kaki1¹")
          rootText = rootText.replace(/(\w+)\d+([\u00B9\u00B2\u00B3\u2074-\u207E]+)/, '$1$2');
        
          rootWords.push(rootText);
        }
      }
    }
    
    return rootWords.length > 0 ? rootWords[0] : null;
  }
  
  /**
   * Convert a number to superscript for display
   * @param {string} number - Number to convert
   * @returns {string} Superscript version of the number
   */
  toSuperscript(number) {
    if (!number) return '';
    const superscripts = {
      '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
      '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹'
    };
    return number.toString().split('').map(char => superscripts[char] || char).join('');
  }

  /**
   * Extract entry type from small tag following the heading
   * @param {Object} $h2 - jQuery object of h2 element
   * @returns {string|null} Entry type or null if not found
   */
  extractEntryType($h2) {
    // Look for the small tag with saddlebrown color that follows the h2 heading
    const $entryType = $h2.nextAll('small[style*="color:saddlebrown"]').first();
    
    if ($entryType.length) {
      // Extract the text content and remove any HTML tags
      const text = $entryType.text().replace(/<[^>]*>/g, '').trim();
      return text;
    }
    
    return null;
  }
}

module.exports = KBBIParser; 