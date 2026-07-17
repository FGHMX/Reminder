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
    console.log(`[GCS] Backing up and uploading ${DB_FILENAME} to bucket ${bucketName}...`);
    
    // Create a safe hot-backup to capture all WAL and memory data
    const db = require('./database').getDb();
    const backupPath = LOCAL_DB_PATH + '.backup';
    await db.backup(backupPath);

    // Upload the safe backup file to GCS instead of the live DB
    await storage.bucket(bucketName).upload(backupPath, {
      destination: DB_FILENAME,
    });
    
    // Clean up the backup file locally
    const fs = require('fs');
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    
    console.log(`[GCS] Successfully uploaded ${DB_FILENAME}`);
    return true;
  } catch (err) {
    console.error(`[GCS] Error uploading DB: ${err.message}`);
    return false;
  }
}

// In serverless environments like Cloud Run, we cannot use setTimeout because the CPU suspends.
// We fire the upload immediately.
let isUploading = false;
async function scheduleDbUpload() {
  if (!bucketName || isUploading) return;
  
  isUploading = true;
  try {
    await uploadDb();
  } finally {
    isUploading = false;
  }
}

module.exports = {
  downloadDb,
  uploadDb,
  scheduleDbUpload,
  LOCAL_DB_PATH
};
