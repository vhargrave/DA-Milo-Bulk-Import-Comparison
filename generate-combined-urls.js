const fs = require('fs');
const path = require('path');

const resultsDir = 'results';
const dataDir = 'data';

// Input files containing paths
const inputFile1 = path.join(resultsDir, 'paths-to-reimport-to-da-bacom.txt');
const inputFile2 = path.join(dataDir, 'paths-megan.txt');

// Output file for combined unique paths
const outputFile = path.join(resultsDir, 'paths-to-reimport-to-da-bacom-with-content-megan.txt'); // Keep user's desired output name

// Base URL (no longer needed for this specific task, can be removed or kept if other logic is added later)
// const baseUrl = 'https://main--bacom--adobecom.aem.live';

/**
 * Reads a text file line by line, trims lines, and filters out empty ones.
 * @param {string} filePath Path to the text file.
 * @returns {string[] | null} Array of non-empty lines, or null on critical error.
 */
function readPathsFromFile(filePath) {
  console.log(`Reading paths from ${filePath}...`);
  try {
    const rawData = fs.readFileSync(filePath, 'utf8');
    return rawData
      .split(/\r?\n/) // Split by newline, handling Windows/Unix endings
      .map(line => line.trim())
      .filter(line => line.length > 0); // Filter out empty lines
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn(`Warning: Input file not found - ${filePath}. Skipping.`);
      return []; // Return empty array if file not found
    } else {
      console.error(`Error reading file ${filePath}:`, err);
      return null; // Indicate critical error
    }
  }
}

// --- Main Logic ---
console.log(`Combining unique paths from ${path.basename(inputFile1)} and ${path.basename(inputFile2)}...`);

const pathsFromFile1 = readPathsFromFile(inputFile1);
const pathsFromFile2 = readPathsFromFile(inputFile2);

if (pathsFromFile1 === null || pathsFromFile2 === null) {
    console.error("Aborting due to critical errors reading input files.");
    process.exit(1);
}

// Combine and deduplicate using a Set
const uniquePaths = new Set([...pathsFromFile1, ...pathsFromFile2]);
console.log(`Found ${uniquePaths.size} unique paths in total.`);

// Sort the unique paths
const sortedUniquePaths = Array.from(uniquePaths).sort();

// Format for output (just paths, no base URL)
const outputString = sortedUniquePaths.join('\n');

// --- Write unique combined paths to the file ---
try {
  // Ensure the results directory exists
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
    console.log(`Created directory: ${resultsDir}`);
  }

  fs.writeFileSync(outputFile, outputString); // Write to the specified output file
  console.log(`Successfully wrote ${sortedUniquePaths.length} unique combined paths to ${outputFile}`);

} catch (err) {
  console.error(`\nError writing output file ${outputFile}:`, err);
  process.exit(1);
} 