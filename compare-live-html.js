const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const cheerio = require('cheerio');

const resultsDir = 'results';
const inputFile = path.join(resultsDir, 'temp.json');
const outputFile = path.join(resultsDir, 'html-differences.txt');

const bacomBaseUrl = 'https://main--bacom--adobecom.aem.live';
const daBacomBaseUrl = 'https://main--da-bacom--adobecom.aem.live';
const suffix = '.plain.html';

// Delay between requests in milliseconds to avoid overwhelming servers
const requestDelay = 100; 

// List of file extensions to ignore in links/sources (case-insensitive)
const ignoredExtensions = [
    '.svg', '.mp4', '.mov', '.webm', // Media
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', // Images
    '.pdf', '.zip', '.gz', '.docx', '.xlsx', '.pptx' // Documents/Archives
];

// Base URLs to replace in text content before comparison
const textBaseUrlPatterns = [
    /https?:\/\/main--bacom--adobecom\.hlx\.live/gi,
    /https?:\/\/main--bacom--adobecom\.hlx\.page/gi,
    // Add DA versions just in case they appear in Bacom text or vice-versa
    /https?:\/\/main--da-bacom--adobecom\.hlx\.live/gi,
    /https?:\/\/main--da-bacom--adobecom\.hlx\.page/gi
];
const textUrlPlaceholder = '[BASE_URL]';

/**
 * Fetches HTML content from a URL.
 * @param {string} url The URL to fetch.
 * @returns {Promise<{success: boolean, status: number|null, content: string|null, error: string|null}>} 
 */
async function fetchHtml(url) {
  try {
    const response = await fetch(url);
    if (response.ok) {
      const content = await response.text();
      return { success: true, status: response.status, content: content, error: null };
    } else {
      return { success: false, status: response.status, content: null, error: `HTTP status ${response.status}` };
    }
  } catch (error) {
    return { success: false, status: null, content: null, error: error.message };
  }
}

/**
 * Parses srcset attribute into entries of { url, descriptor }.
 * Basic parser, may not handle all edge cases perfectly.
 * @param {string} srcsetString
 * @returns {Array<{url: string, descriptor: string | undefined}>}
 */
function parseSrcset(srcsetString) {
    if (!srcsetString) return [];
    return srcsetString.split(',').map(part => {
        part = part.trim();
        const parts = part.split(/\s+/);
        return {
            url: parts[0],
            descriptor: parts.length > 1 ? parts.slice(1).join(' ') : undefined
        };
    });
}

/**
 * Normalizes a URL string, keeping only path, query, and hash for absolute HTTP/S URLs.
 * @param {string} urlString
 * @returns {string} Normalized URL string or original if not applicable/error.
 */
function normalizeUrlPath(urlString) {
     if (!urlString) return urlString;
     try {
         // Base URL is needed for resolving relative paths correctly if needed,
         // but here we only care if it's *already* absolute http/s.
         const url = new URL(urlString, 'http://dummybase'); // Provide a dummy base for the constructor
         if (url.protocol === 'http:' || url.protocol === 'https:') {
             // It's an absolute HTTP/S URL, return only path+query+hash
             return url.pathname + url.search + url.hash;
         }
         // Otherwise (e.g., relative path, mailto:, data:), return original
         return urlString;
     } catch (e) {
         // If URL parsing fails, return the original string
         // console.warn(`URL parsing failed for "${urlString}": ${e.message}`);
         return urlString;
     }
}

/**
 * Normalizes an HTML document using Cheerio for comparison.
 * - Removes scripts and styles.
 * - Normalizes URLs (strips domain) in common attributes.
 * @param {string} htmlString The raw HTML string.
 * @returns {cheerio.CheerioAPI | null} The normalized Cheerio object, or null on error.
 */
function normalizeHtmlDocument(htmlString) {
    // Only performs basic normalization now - script/style removal and URL path normalization
    if (!htmlString) return null;
    try {
        const $ = cheerio.load(htmlString);
        $('script, style').remove();

        // Normalize URLs (can keep this lightweight normalization)
        $('img').each((i, el) => {
            const img = $(el);
            let src = img.attr('src');
            if (src) { img.attr('src', normalizeUrlPath(src)); }
        });
        $('a[href], link[href]').each((i, el) => {
             const element = $(el);
             let href = element.attr('href');
             if (href) { element.attr('href', normalizeUrlPath(href)); }
        });
         $('img[srcset], source[srcset]').each((i, el) => {
            const element = $(el);
            let srcSet = element.attr('srcset');
            if (srcSet) {
                const parsed = parseSrcset(srcSet);
                const normalizedEntries = parsed.map(entry => {
                    const normalizedUrl = normalizeUrlPath(entry.url);
                    return entry.descriptor ? `${normalizedUrl} ${entry.descriptor}` : normalizedUrl;
                });
                element.attr('srcset', normalizedEntries.join(', '));
            }
        });
        return $;
    } catch(parseError) {
        console.warn(`Cheerio parsing error during normalization: ${parseError.message}`);
        return null;
    }
}

/**
 * Finds the index of the first differing character between two strings.
 * @param {string} str1 
 * @param {string} str2 
 * @returns {number} The index of the first difference, or -1 if strings are identical.
 */
function findFirstDiffIndex(str1, str2) {
  const len = Math.min(str1.length, str2.length);
  for (let i = 0; i < len; i++) {
    if (str1[i] !== str2[i]) {
      return i;
    }
  }
  if (str1.length !== str2.length) {
      return len;
  }
  return -1;
}

/**
 * Gets a snippet of text around a specific index.
 * @param {string} str The source string.
 * @param {number} index The index to center the snippet around.
 * @param {number} [context=60] The number of characters before and after the index.
 * @returns {string} The context snippet.
 */
function getContextSnippet(str, index, context = 60) { // Increased context slightly
    const start = Math.max(0, index - context);
    const end = Math.min(str.length, index + context);
    const prefix = start > 0 ? "..." : "";
    const suffix = end < str.length ? "..." : "";
    // Use JSON.stringify for reliable logging of snippet content
    return prefix + JSON.stringify(str.substring(start, end)) + suffix;
}

/**
 * Gets all unique classes within a Cheerio selection.
 * @param {cheerio.CheerioAPI} $ The Cheerio instance for the document.
 * @param {cheerio.Cheerio<cheerio.Element>} $selection Cheerio selection (e.g., $('body')).
 * @returns {Set<string>} A set of unique class names.
 */
function getUniqueClasses($, $selection) {
    const classes = new Set();
    $selection.find('[class]').each((i, el) => {
        const elementClasses = $(el).attr('class');
        if (elementClasses) {
            elementClasses.split(/\s+/).forEach(cls => { if (cls) classes.add(cls); });
        }
    });
    return classes;
}

/**
 * Gets all unique IDs within a Cheerio selection.
 * @param {cheerio.CheerioAPI} $ The Cheerio instance for the document.
 * @param {cheerio.Cheerio<cheerio.Element>} $selection Cheerio selection (e.g., $('body')).
 * @returns {Set<string>} A set of unique ID values.
 */
function getUniqueIDs($, $selection) {
    const ids = new Set();
    $selection.find('[id]').each((i, el) => {
        const id = $(el).attr('id');
        if (id) {
            ids.add(id);
        }
    });
    return ids;
}

/**
 * Main comparison function.
 */
async function compareHtmlContent() {
  console.log(`Reading paths from ${inputFile}...`);
  let entries;
  try {
    const rawData = fs.readFileSync(inputFile, 'utf8');
    entries = JSON.parse(rawData);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Input file not found - ${inputFile}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Error: Failed to parse JSON from ${inputFile}.`, err);
    } else {
      console.error(`Error reading file ${inputFile}:`, err);
    }
    process.exit(1);
  }

  if (!Array.isArray(entries)) {
    console.error(`Error: Expected an array in ${inputFile}, but got ${typeof entries}`);
    process.exit(1);
  }

  console.log(`Found ${entries.length} paths to compare.`);
  const pathsWithDifferences = [];
  let checkedCount = 0;

  for (const entry of entries) {
    const pagePath = entry?.path;
    checkedCount++;
    console.log(`\n(${checkedCount}/${entries.length}) Checking path: ${pagePath}`);

    if (!pagePath || typeof pagePath !== 'string') {
      console.warn("Skipping entry with missing or invalid path:", entry);
      continue;
    }

    const bacomUrl = `${bacomBaseUrl}${pagePath}${suffix}`;
    const daBacomUrl = `${daBacomBaseUrl}${pagePath}${suffix}`;

    console.log(`  Fetching Bacom: ${bacomUrl}`);
    const bacomResult = await fetchHtml(bacomUrl);
    await new Promise(resolve => setTimeout(resolve, requestDelay));

    console.log(`  Fetching DA Bacom: ${daBacomUrl}`);
    const daBacomResult = await fetchHtml(daBacomUrl);
    await new Promise(resolve => setTimeout(resolve, requestDelay));

    let differenceFound = false;
    let diffDetails = "";

    if (bacomResult.success && daBacomResult.success) {
        console.log("  Normalizing HTML documents for comparison...");
        const $bacom = normalizeHtmlDocument(bacomResult.content);
        const $da = normalizeHtmlDocument(daBacomResult.content);

        if (!$bacom || !$da) {
             console.warn("  [WARN] Skipping comparison due to normalization error.");
             // Optionally treat normalization error as a difference
             // differenceFound = true;
             // diffDetails = "Normalization error occurred.";
        } else {
            let textDiffers = false;
            let classDiffers = false;
            let idDiffers = false;
            let detailLogs = []; 

            // 1. Compare Normalized Text Content
            let bacomRawText = $bacom('body').text();
            let daRawText = $da('body').text();

            // Replace specific base URLs in the text
            for (const pattern of textBaseUrlPatterns) {
                bacomRawText = bacomRawText.replace(pattern, textUrlPlaceholder);
                daRawText = daRawText.replace(pattern, textUrlPlaceholder);
            }

            // Normalize whitespace *after* URL replacement
            const bacomNormalizedText = bacomRawText.replace(/\s+/g, ' ').trim();
            const daNormalizedText = daRawText.replace(/\s+/g, ' ').trim();

            if (bacomNormalizedText !== daNormalizedText) {
                textDiffers = true;
                // Use the fully normalized text for diff context
                const diffIndex = findFirstDiffIndex(bacomNormalizedText, daNormalizedText);
                let textDiffDetails = `First text difference at index ${diffIndex} (after URL/whitespace norm).\n`;
                textDiffDetails += `      Bacon Norm Text: ${getContextSnippet(bacomNormalizedText, diffIndex)}\n`;
                textDiffDetails += `      DA    Norm Text: ${getContextSnippet(daNormalizedText, diffIndex)}`;
                detailLogs.push(textDiffDetails);
            }

            // 2. Compare Unique Classes
            const bacomClasses = getUniqueClasses($bacom, $bacom('body'));
            const daClasses = getUniqueClasses($da, $da('body'));
            const addedClasses = [...daClasses].filter(cls => !bacomClasses.has(cls));
            const removedClasses = [...bacomClasses].filter(cls => !daClasses.has(cls));
            if (addedClasses.length > 0 || removedClasses.length > 0) {
                 classDiffers = true;
                 let classDetails = "Class sets differ.\n";
                 if (addedClasses.length > 0) classDetails += `      DA Classes Not In Bacom: ${addedClasses.join(', ')}\n`;
                 if (removedClasses.length > 0) classDetails += `      Bacom Classes Not In DA: ${removedClasses.join(', ')}`;
                 detailLogs.push(classDetails.trim());
            }
            
            // 3. Compare Unique IDs
            const bacomIDs = getUniqueIDs($bacom, $bacom('body'));
            const daIDs = getUniqueIDs($da, $da('body'));
            const addedIDs = [...daIDs].filter(id => !bacomIDs.has(id));
            const removedIDs = [...bacomIDs].filter(id => !daIDs.has(id));
             if (addedIDs.length > 0 || removedIDs.length > 0) {
                 idDiffers = true;
                 let idDetails = "ID sets differ.\n";
                 if (addedIDs.length > 0) idDetails += `      DA IDs Not In Bacom: ${addedIDs.join(', ')}\n`;
                 if (removedIDs.length > 0) idDetails += `      Bacom IDs Not In DA: ${removedIDs.join(', ')}`;
                 detailLogs.push(idDetails.trim());
            }

            // 4. Report Differences
            if (textDiffers || classDiffers || idDiffers) {
                differenceFound = true;
                let diffMessages = [];
                if (textDiffers) diffMessages.push("Text");
                if (classDiffers) diffMessages.push("Classes");
                if (idDiffers) diffMessages.push("IDs");
                
                console.log(`  [DIFFERENCE FOUND] Types: ${diffMessages.join(', ')}.`);
                
                // Print all collected detail logs
                if (detailLogs.length > 0) {
                    console.log(detailLogs.join('\n---\n'));
                }
                
                // Optionally log raw content as before if needed
                // console.log("\n--- Raw Bacom HTML Content ---"); ...

            } else {
                console.log(`  [OK] Normalized text, classes, and IDs match.`);
            }
        }
    } else {
        // Handle fetch errors/status differences as before
        if (bacomResult.status !== daBacomResult.status) {
             differenceFound = true;
             diffDetails = `Status codes differ (Bacom: ${bacomResult.status}, DA: ${daBacomResult.status}).`;
             console.log(`  [DIFFERENCE FOUND] ${diffDetails}`);
        }
        let errorDifference = false;
        if (bacomResult.error) {
             console.warn(`  [WARN] Error fetching Bacom: ${bacomResult.error}`);
             if (!daBacomResult.error) errorDifference = true;
        }
        if (daBacomResult.error) {
             console.warn(`  [WARN] Error fetching DA Bacom: ${daBacomResult.error}`);
             if (!bacomResult.error) errorDifference = true;
        }
        if (errorDifference) {
            if (!differenceFound) { 
                 diffDetails = "Fetch error occurred on only one side.";
                 console.log(`  [DIFFERENCE FOUND] ${diffDetails}`);
            }
            differenceFound = true;
        }
         if (bacomResult.error && daBacomResult.error) {
             console.warn(`  [WARN] Both fetches failed.`);
         } else if (bacomResult.status && bacomResult.status !== 200 && bacomResult.status === daBacomResult.status) {
             console.log(`  [NOTE] Both URLs returned status ${bacomResult.status}. Not counting as difference.`);
         }
    }

    if (differenceFound) {
        // Add path to list even if only raw content is logged
        if (!pathsWithDifferences.includes(pagePath)) {
             pathsWithDifferences.push(pagePath);
        }
    }
  }

  // --- Write results ---
  console.log("\nComparison finished.");
  if (pathsWithDifferences.length > 0) {
    console.log(`Found significant differences for ${pathsWithDifferences.length} paths.`);
    pathsWithDifferences.sort();
    const outputString = pathsWithDifferences.join('\n');
    try {
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }
      fs.writeFileSync(outputFile, outputString);
      console.log(`List of paths with significant differences saved to ${outputFile}`);
    } catch (err) {
      console.error(`Error writing output file ${outputFile}:`, err);
    }
  } else {
    console.log("No significant differences found between the checked paths.");
  }
}

// Run the comparison
compareHtmlContent(); 