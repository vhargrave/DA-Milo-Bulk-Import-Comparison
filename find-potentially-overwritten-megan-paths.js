const fs = require('fs');
const path = require('path');

const dataDir = 'data';
const resultsDir = 'results';

// Input files
const meganPathsFile = path.join(dataDir, 'paths-megan.txt');
const bacomLastPublishedFile = path.join(dataDir, 'bacom-last-published.json');
const daLastPublishedFile = path.join(dataDir, 'da-bacom-last-published.json');
const daLastDeletedFile = path.join(dataDir, 'da-bacom-last-deleted.json');

// Output file
const outputFile = path.join(resultsDir, 'megan-paths-conflict.txt');

// User to exclude from DA action files
const excludedUser = "osahin@adobe.comasdf";

/**
 * Reads a text file line by line, trims lines, filters out empty ones,
 * and normalizes full URLs to just path segments.
 * @param {string} filePath Path to the text file.
 * @returns {string[] | null} Array of non-empty path segments, or null on critical error.
 */
function readPathsFromFile(filePath) {
  console.log(`Reading and normalizing paths from ${filePath}...`);
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    return rawData
      .split(/\r?\n/) 
      .map(line => {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('http://') || trimmedLine.startsWith('https://')) {
              try {
                  const url = new URL(trimmedLine);
                  // Return path + query + hash
                  return url.pathname + url.search + url.hash;
              } catch (e) {
                  console.warn(`Skipping invalid URL in ${filePath}: ${trimmedLine}`);
                  return ''; // Return empty string for invalid URLs
              }
          } else {
              // Assume it's already a path if it doesn't start with http/https
              return trimmedLine;
          }
      })
      .filter(line => line.length > 0); // Filter out empty lines/skipped URLs
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Warning: Input file not found - ${filePath}. Skipping.`);
      return []; 
    } else {
      console.error(`Error reading file ${filePath}:`, err);
      return null; 
    }
  }
}

/**
 * Reads a JSON file containing last action details and extracts paths and timestamps into a Map.
 * Filters out entries where the user matches userToExclude.
 * @param {string} filePath Path to the JSON file.
 * @param {string | null} [userToExclude=null] User email to exclude from results.
 * @returns {Map<string, { timestamp: string, user: string | null }> | null} Map of path -> {timestamp, user}, or null on error.
 */
function readActionFileToMap(filePath, userToExclude = null) {
  console.log(`Reading action file: ${filePath}${userToExclude ? ` (excluding user ${userToExclude})` : ''}...`);
  let entries;
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    entries = JSON.parse(rawData);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Warning: Input file not found - ${filePath}. Assuming empty.`);
      return new Map(); 
    } else if (err instanceof SyntaxError) {
      console.error(`Error: Failed to parse JSON from ${filePath}.`, err);
    } else {
      console.error(`Error reading file ${filePath}:`, err);
    }
    return null; 
  }

  if (!Array.isArray(entries)) {
    console.error(`Error: Expected an array in ${filePath}, but got ${typeof entries}`);
    return null;
  }

  const pathsMap = new Map();
  let excludedCount = 0;
  for (const entry of entries) {
    const user = entry?.user || null;
    // --- User Exclustion Check --- 
    if (userToExclude && user === userToExclude) {
      excludedCount++;
      continue; // Skip this entry if the user matches the exclusion list
    }
    // -----------------------------

    if (entry && typeof entry.path === 'string' && typeof entry.timestamp === 'string') {
      const timestamp = entry.timestamp;
      const pathKey = entry.path;
      const existingData = pathsMap.get(pathKey);
      // Keep the latest timestamp among non-excluded entries
      if (!existingData || timestamp > existingData.timestamp) {
         pathsMap.set(pathKey, { timestamp: timestamp, user: user });
      }
    } else {
        console.warn(`Skipping invalid entry in ${filePath}:`, entry);
    }
  }
  if (userToExclude && excludedCount > 0) {
      console.log(`Excluded ${excludedCount} entries by user ${userToExclude} from ${filePath}.`);
  }
  console.log(`Extracted ${pathsMap.size} path-timestamp-user pairs from ${filePath}.`);
  return pathsMap;
}


// --- Main Logic ---
console.log('Checking Megan paths against last action states...');

const meganPaths = readPathsFromFile(meganPathsFile);
const bacomPubMap = readActionFileToMap(bacomLastPublishedFile);
const daPubMap = readActionFileToMap(daLastPublishedFile, excludedUser);
const daDelMap = readActionFileToMap(daLastDeletedFile, excludedUser);

if (meganPaths === null || !bacomPubMap || !daPubMap || !daDelMap) {
    console.error("Aborting due to critical errors reading input files.");
    process.exit(1);
}

const overwrittenPaths = [];
const meganPathsSet = new Set(meganPaths); 
const oneHourInMs = 60 * 60 * 1000; // Define one hour in milliseconds

for (const meganPath of meganPathsSet) {
    const bacomData = bacomPubMap.get(meganPath);

    if (!bacomData) {
        continue;
    }

    const bacomTimestampStr = bacomData.timestamp;
    const daPubData = daPubMap.get(meganPath);
    const daDelData = daDelMap.get(meganPath);
    const daPubTimestampStr = daPubData?.timestamp;
    const daDelTimestampStr = daDelData?.timestamp;

    let latestDaTimestampStr = null;
    if (daPubTimestampStr && daDelTimestampStr) {
        latestDaTimestampStr = daPubTimestampStr > daDelTimestampStr ? daPubTimestampStr : daDelTimestampStr;
    } else if (daPubTimestampStr) {
        latestDaTimestampStr = daPubTimestampStr;
    } else if (daDelTimestampStr) {
        latestDaTimestampStr = daDelTimestampStr;
    }

    // Check if a DA action exists and apply time difference condition
    if (latestDaTimestampStr) {
        try {
            const bacomTime = new Date(bacomTimestampStr).getTime();
            const latestDaTime = new Date(latestDaTimestampStr).getTime();

            // Condition: latest DA time is at least 1 hour after Bacom time
            if (latestDaTime >= (bacomTime + oneHourInMs)) {
                overwrittenPaths.push(meganPath);
            }
        } catch (parseError) {
             console.warn(`Skipping path ${meganPath} due to timestamp parsing error: ${parseError.message}`);
        }
    }
}

console.log(`\nFound ${overwrittenPaths.length} paths from ${path.basename(meganPathsFile)} where the last Bacom publish was potentially overwritten by a DA action at least 1 hour later.`);

// Sort the results
overwrittenPaths.sort();

// Format for output
const outputString = overwrittenPaths.join('\n');

// --- Write results to file ---
try {
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
    console.log(`Created directory: ${resultsDir}`);
  }

  fs.writeFileSync(outputFile, outputString);
  console.log(`Successfully wrote ${overwrittenPaths.length} potentially overwritten paths to ${outputFile}`);

} catch (err) {
  console.error(`\nError writing output file ${outputFile}:`, err);
  process.exit(1);
} 