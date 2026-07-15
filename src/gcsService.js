const { Storage } = require('@google-cloud/storage');
const path = require('path');

const storage = new Storage();

const DB_FILENAME = 'earnings_reminder.db';
const LOCAL_DB_PATH = path.join(process.cwd(), DB_FILENAME);
let bucketName = process.env.GCS_BUCKET_NAME;

async function downloadDb() {
  if (!bucketName) return false;
  
  try {
    console.log(`[GCS] Downloading ${DB_FILENAME} from bucket ${bucketName}...`);
    await storage.bucket(bucketName).file(DB_FILENAME).download({ destination: LOCAL_DB_PATH });
    console.log(`[GCS] Successfully downloaded ${DB_FILENAME}`);
    return true;
  } catch (err) {
    if (err.code === 404) {
      console.log(`[GCS] ${DB_FILENAME} not found in bucket. A new local DB will be created and uploaded.`);
    } else {
      console.error(`[GCS] Error downloading DB: ${err.message}`);
    }
    return false;
  }
}

async function uploadDb() {
  if (!bucketName) return false;

  try {
    console.log(`[GCS] Uploading ${DB_FILENAME} to bucket ${bucketName}...`);
    await storage.bucket(bucketName).upload(LOCAL_DB_PATH, {
      destination: DB_FILENAME,
    });
    console.log(`[GCS] Successfully uploaded ${DB_FILENAME}`);
    return true;
  } catch (err) {
    console.error(`[GCS] Error uploading DB: ${err.message}`);
    return false;
  }
}

// Ensure subsequent uploads don't overlap rapidly
let uploadTimeout = null;
function scheduleDbUpload() {
  if (!bucketName) return;
  
  if (uploadTimeout) {
    clearTimeout(uploadTimeout);
  }
  
  uploadTimeout = setTimeout(async () => {
    await uploadDb();
    uploadTimeout = null;
  }, 3000); // Wait 3 seconds after the last write to upload
}

module.exports = {
  downloadDb,
  uploadDb,
  scheduleDbUpload,
  LOCAL_DB_PATH
};
