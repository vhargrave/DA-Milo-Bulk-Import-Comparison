const fs = require('fs');
const path = require('path'); // Import the path module

const dataDir = 'data'; // Define data directory
const resultsDir = 'results'; // Define the results directory name

const file1 = path.join(dataDir, 'da-bacom-last-published.json'); // Published DA in data/
const file2 = path.join(dataDir, 'bacom-last-deleted.json'); // Deleted Bacom in data/

// Helper function to read, parse, and handle errors
function readJsonFile(filePath) {
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Input file not found - ${filePath}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Error: Failed to parse JSON from ${filePath}. Check if it's valid JSON.`, err);
    } else {
      console.error(`Error reading file ${filePath}:`, err);
    }
    return null; // Indicate failure
  }
}

// Helper function to extract all unique paths and their timestamps from entries
function extractPathsWithTimestamps(entries) {
  const pathsMap = new Map();
  if (!Array.isArray(entries)) {
    console.error("Error: Expected an array of entries for path extraction.");
    return pathsMap; // Return empty map on error
  }
  for (const entry of entries) {
    const timestamp = entry.timestamp; // Assuming timestamp is already the ISO string
    if (!timestamp) continue; // Skip if no timestamp

    if (Array.isArray(entry.paths)) {
      entry.paths.forEach(p => {
        if (typeof p === 'string') {
          // Keep the latest timestamp if a path appears multiple times (shouldn't happen with processed files)
          if (!pathsMap.has(p) || timestamp > pathsMap.get(p)) {
             pathsMap.set(p, timestamp);
          }
        }
      });
    } else if (typeof entry.path === 'string') {
      const p = entry.path;
      if (!pathsMap.has(p) || timestamp > pathsMap.get(p)) {
        pathsMap.set(p, timestamp);
      }
    }
  }
  return pathsMap;
}

// --- Main Logic ---
console.log(`Comparing paths between ${file1} (Published DA) and ${file2} (Deleted Bacom)...`);

const entries1 = readJsonFile(file1);
const entries2 = readJsonFile(file2);

if (entries1 === null || entries2 === null) {
  console.error("Aborting comparison due to file reading errors.");
  process.exit(1); // Exit with error code
}

const pathsMap1 = extractPathsWithTimestamps(entries1); // Map<path, lastPublishedTimestampDA>
const pathsMap2 = extractPathsWithTimestamps(entries2); // Map<path, lastDeletedTimestampBacom>

console.log(`Found ${pathsMap1.size} unique paths in ${file1}.`);
console.log(`Found ${pathsMap2.size} unique paths in ${file2}.`);

const commonPathDetails = [];
for (const [path, deleteTimestamp] of pathsMap2.entries()) {
  if (pathsMap1.has(path)) {
    const publishTimestamp = pathsMap1.get(path);
    commonPathDetails.push({
      path: path,
      "last published DA": publishTimestamp,
      "last deleted Bacom": deleteTimestamp
    });
  }
}

// Optional: Sort results by path for consistency
commonPathDetails.sort((a, b) => a.path.localeCompare(b.path));

// --- Report Results ---
if (commonPathDetails.length > 0) {
  console.log('\nFound common paths with details:');
  // Output as a JSON array for easy parsing
  console.log(JSON.stringify(commonPathDetails, null, 2));

  // --- Generate plain text file with paths ---
  const outputFileName = 'paths-to-delete-from-da-bacom.txt';
  const outputFilePath = path.join(resultsDir, outputFileName); // Construct the full path to results/

  try {
    // Ensure the results directory exists
    if (!fs.existsSync(resultsDir)) {
      fs.mkdirSync(resultsDir, { recursive: true }); // Create it if it doesn't exist
      console.log(`\nCreated directory: ${resultsDir}`);
    }

    const pathListString = commonPathDetails.map(detail => detail.path).join('\n');
    fs.writeFileSync(outputFilePath, pathListString);
    console.log(`\nSuccessfully wrote list of ${commonPathDetails.length} common paths to ${outputFilePath}`);
  } catch (err) {
    console.error(`\nError writing path list file ${outputFilePath}:`, err);
  }

} else {
  console.log(`\nNo common paths found between ${file1} and ${file2}.`);
} 