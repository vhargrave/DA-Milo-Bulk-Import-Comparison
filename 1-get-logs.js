const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const dataDir = 'data'; // Define data directory

// Default 'from' parameter - can be adjusted as needed
const defaultFromParam = '2024-01-01T00:00:00.000Z';

const fetchRequest = function(purl, headers) {
  return fetch(purl, {
    method: 'GET',
    headers,
  });
};

/**
 * Fetches logs for a specific site and saves them to a file.
 * @param {string} siteName - The name of the site (e.g., 'da-bacom', 'bacom'). Used for the filename.
 * @param {string} baseUrl - The base URL for the log endpoint (e.g., 'https://admin.hlx.page/log/adobecom/da-bacom/main').
 * @param {string} [fromParam=defaultFromParam] - Optional ISO date string for the 'from' query parameter.
 */
async function fetchLogsForSite(siteName, baseUrl, headers, fromParam = defaultFromParam) {
  console.log(`Fetching logs for site: ${siteName} from ${baseUrl}...`);

  const initialUrl = `${baseUrl}?from=${fromParam}`;
  const entries = [];
  let totalFetched = 0;

  try {
    let nextUrl = initialUrl;
    let requestCount = 0;
    const maxRequests = 1000; // Safety break

    while (nextUrl && requestCount < maxRequests) {
      requestCount++;
      console.log(`Fetching page ${requestCount} for ${siteName}: ${nextUrl}`);
      const request = await fetchRequest(nextUrl, headers);

      if (!request.ok) {
          console.error(`Error fetching logs for ${siteName}: ${request.status} ${request.statusText}`);
          const errorBody = await request.text();
          console.error(`Response body: ${errorBody}`);
          throw new Error(`Failed to fetch logs: ${request.status}`);
      }

      const json = await request.json();

      if (json.entries && json.entries.length > 0) {
         entries.push(...json.entries);
         totalFetched += json.entries.length;
         console.log(`Fetched ${json.entries.length} entries for ${siteName}. Total: ${totalFetched}`);
      } else {
         console.log(`No new entries found on page ${requestCount} for ${siteName}.`);
      }

      nextUrl = json.links?.next;
       if (!nextUrl) {
           console.log(`No more pages found for ${siteName}.`);
           break;
       }
    }

    if (requestCount >= maxRequests) {
        console.warn(`Warning: Reached maximum request limit (${maxRequests}) for ${siteName}. Log data might be incomplete.`);
    }

    // --- Save to file ---
    const outputFileName = `${siteName}-logs.json`; // Use siteName in filename
    const outputFilePath = path.join(dataDir, outputFileName);

    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`Created directory: ${dataDir}`);
    }

    const jsonData = JSON.stringify(entries, null, 2);
    fs.writeFileSync(outputFilePath, jsonData);
    if (outputFilePath === 'data/bacom-logs.json') fs.writeFileSync('data/bacom-logs-bulk.json', jsonData);
    console.log(`Successfully wrote ${totalFetched} entries for ${siteName} to ${outputFilePath}`);

    return outputFilePath; // Return path to the created file

  } catch (err) {
    console.error(`Error fetching or writing logs for site ${siteName}:`, err);
    throw err; // Re-throw error
  }
}

// Remove the direct call to fetchLog()
// fetchLog();

// Export the function
module.exports = { fetchLogsForSite };

