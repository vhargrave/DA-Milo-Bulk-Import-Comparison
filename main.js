const { execSync } = require('child_process');
const { fetchLogsForSite } = require('./1-get-logs.js');

// Define the header - Consider making this an argument or reading from config if needed
const headers = {
  'X-Auth-Token': ''
};
// Adjust the starting date if needed
const fromDateParam = '2025-04-29T00:00:00.000Z';


// --- Configuration ---
const sites = [
  {
    name: 'da-bacom',
    baseUrl: 'https://admin.hlx.page/log/adobecom/da-bacom/main'
  },
  {
    name: 'bacom',
    baseUrl: 'https://admin.hlx.page/log/adobecom/bacom/main'
  }
];

// Scripts to execute in order after fetching logs
const processingScripts = [
    '2-extract-last-published-and-deleted.js',
    '3-extract-paths-to-reimport-to-da-bacom.js',
    '3-extract-paths-to-delete-from-da-bacom.js'
];
// -------------------

/**
 * Executes a shell command synchronously and logs output/errors.
 * @param {string} command The command to execute.
 * @param {string} description A description of the step for logging.
 */
function runScript(command, description) {
  console.log(`\n--- Running Step: ${description} ---`);
  console.log(`Executing: ${command}`);
  try {
    // Remove stdio:inherit to capture output
    const output = execSync(command, { encoding: 'utf8' });
    console.log("--- Script Output ---");
    console.log(output.trim()); // Print captured stdout
    console.log("--- End Script Output ---");
    console.log(`--- Finished Step: ${description} ---`);
  } catch (error) {
    console.error(`\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    console.error(`Error during step: ${description}`);
    console.error(`Command failed: ${command}`);
    console.error(`Error message: ${error.message}`);
    // Often, stderr and stdout are properties of the error object when execSync fails
    if (error.stderr) {
        console.error("--- Script Stderr ---");
        console.error(error.stderr.toString().trim());
        console.error("--- End Script Stderr ---");
    }
    if (error.stdout) {
        console.log("--- Script Stdout (before error) ---");
        console.log(error.stdout.toString().trim());
        console.log("--- End Script Stdout (before error) ---");
    }
    console.error(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
    throw error; // Stop the whole process if a step fails
  }
}

/**
 * Main orchestration function.
 */
async function runAnalysis() {
  console.log('Starting log analysis process...');

  try {
    // 1. Fetch logs for all sites
    console.log('\n--- Running Step: Fetching Logs ---');
    for (const site of sites) {
      await fetchLogsForSite(site.name, site.baseUrl, headers, fromDateParam);
    }
    console.log('--- Finished Step: Fetching Logs ---');

    // 2. Run processing scripts
    for (const scriptName of processingScripts) {
        runScript(`node ${scriptName}`, `Running ${scriptName}`);
    }

    console.log('\n===================================');
    console.log('Log analysis process completed successfully!');
    console.log('Check the \'data/\' and \'results/\' directories for output files.');
    console.log('===================================');

  } catch (error) {
    console.error('\n***********************************');
    console.error('Log analysis process failed!');
    // Error details were already logged by runScript or fetchLogsForSite
    console.error('***********************************');
    process.exit(1); // Exit with a non-zero code to indicate failure
  }
}

// Run the orchestrator
runAnalysis();
