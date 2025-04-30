const fs = require('fs');
const path = require('path'); // Import path

/**
 * Processes a raw log file to generate JSON files containing details of the last action for each path.
 * @param {string} inputFilePath Path to the raw JSON log file.
 * @param {string} publishedOutputFilePath Path to write the JSON list of last published actions.
 * @param {string} deletedOutputFilePath Path to write the JSON list of last deleted actions.
 */
function generateLastActionFiles(inputFilePath, publishedOutputFilePath, deletedOutputFilePath) {
  console.log(`Processing ${inputFilePath} to generate last action JSON files...`);
  try {
    // Ensure the output directory exists
    const outputDir = path.dirname(publishedOutputFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
      console.log(`Created directory: ${outputDir}`);
    }

    // Read the input file
    const rawData = fs.readFileSync(inputFilePath, 'utf8');
    const entries = JSON.parse(rawData);

    if (!Array.isArray(entries)) {
      console.error(`Error: Expected an array in ${inputFilePath}, but got ${typeof entries}`);
      return;
    }

    // Sort entries by timestamp
    entries.sort((a, b) => a.timestamp - b.timestamp);

    const latestActionPerPath = new Map();

    for (const entry of entries) {
      let actionType = null;
      let paths = [];

      const isLive = entry.route === 'live' && entry.method === 'POST';
      let isLivePost = inputFilePath === 'data/bacom-logs-bulk.json' ? isLive && entry.status === 202: isLive;
      const isLiveDelete = entry.route === 'live' && entry.method === 'DELETE';
      const isBulkDeletePost = entry.method === 'POST' && Array.isArray(entry.paths) && entry.delete === true;

      if (isLiveDelete || isBulkDeletePost) {
        actionType = 'delete';
      } else if (isLivePost) {
        if (!(Array.isArray(entry.paths) && entry.delete === true)) {
          actionType = 'publish';
        }
      }

      if (Array.isArray(entry.paths)) {
        paths = entry.paths;
      } else if (typeof entry.path === 'string') {
        paths = [entry.path];
      } else {
        if (actionType) {
          console.warn(`Entry with timestamp ${entry.timestamp} has action type ${actionType} but no valid path/paths field. Skipping.`);
        }
        continue;
      }

      if (actionType) {
        const currentTimestamp = entry.timestamp;
        for (const p of paths) {
          if (typeof p !== 'string') continue;
          
          // Skip excluded paths
          if (p.includes('/metadata.json') || p.includes('/query-index.json') || p.includes('/redirects.json')) {
            continue; // Skip this path
          }

          const existing = latestActionPerPath.get(p);
          if (!existing || currentTimestamp >= existing.timestamp) {
            latestActionPerPath.set(p, {
              timestamp: currentTimestamp,
              type: actionType,
              entry: { ...entry } // Store the full entry again
            });
          }
        }
      }
    }

    // --- Collect details for the last action per path --- 
    const publishedOutputData = [];
    const deletedOutputData = [];

    for (const [pathKey, actionData] of latestActionPerPath.entries()) {
      const entry = actionData.entry;
      const user = entry.user || null; // Attempt to find user info

      const outputEntry = {
        path: pathKey, // Use the map key as the definitive path
        method: entry.method || null,
        route: entry.route || null,
        user: user,
        timestamp: new Date(actionData.timestamp).toISOString(), // Convert number timestamp back to ISO string
        repo: entry.repo || null,
        status: entry.status || null,
      };

      if (actionData.type === 'publish') {
        publishedOutputData.push(outputEntry);
      } else if (actionData.type === 'delete') {
        deletedOutputData.push(outputEntry);
      }
    }

    // --- Sort the results (e.g., by path) ---
    publishedOutputData.sort((a, b) => a.path.localeCompare(b.path));
    deletedOutputData.sort((a, b) => a.path.localeCompare(b.path));

    // --- Write the JSON arrays to files ---

    // Published paths
    const publishedJsonString = JSON.stringify(publishedOutputData, null, 2); // Pretty print JSON
    fs.writeFileSync(publishedOutputFilePath, publishedJsonString);
    console.log(`Saved ${publishedOutputData.length} last published action details to ${publishedOutputFilePath}`);

    // Deleted paths
    if(deletedOutputFilePath) {
      const deletedJsonString = JSON.stringify(deletedOutputData, null, 2); // Pretty print JSON
      fs.writeFileSync(deletedOutputFilePath, deletedJsonString);
      console.log(`Saved ${deletedOutputData.length} last deleted action details to ${deletedOutputFilePath}`);
    }


  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Input file not found - ${inputFilePath}`);
    } else if (err instanceof SyntaxError) {
      console.error(`Error: Failed to parse JSON from ${inputFilePath}. Check if it's valid JSON.`, err);
    } else {
      console.error(`Error processing file ${inputFilePath}:`, err);
    }
  }
}

// Define input and output file names within the 'data' directory
const dataDir = 'data';
const inputFile1 = path.join(dataDir, 'da-bacom-logs.json');
const publishedOutputFile1 = path.join(dataDir, 'da-bacom-last-published.json'); // Changed filename
const deletedOutputFile1 = path.join(dataDir, 'da-bacom-last-deleted.json');   // Changed filename

const inputFile2 = path.join(dataDir, 'bacom-logs-bulk.json');
const publishedOutputFile2 = path.join(dataDir, 'bacom-last-published-bulk.json'); // Changed filename
const deletedOutputFile2 = path.join(dataDir, 'bacom-last-deleted.json');   // Changed filename

const inputFile3 = path.join(dataDir, 'bacom-logs.json');
const publishedOutputFile3 = path.join(dataDir, 'bacom-last-published.json'); // Changed filename

// Process both files
generateLastActionFiles(inputFile1, publishedOutputFile1, deletedOutputFile1);
generateLastActionFiles(inputFile2, publishedOutputFile2, deletedOutputFile2);
generateLastActionFiles(inputFile3, publishedOutputFile3, null);

