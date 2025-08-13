const AWS = require('aws-sdk');
const sharp = require('sharp');
const pLimit = require('p-limit');
const fs = require('fs');
const path = require('path');
const args = require('minimist')(process.argv.slice(2), {
  string: ['exclude', 'include'],
  boolean: ['dry-run'],
  default: { concurrency: 5 }
});

// Disable keep-alive so Node exits cleanly
AWS.config.update({
  httpOptions: {
    connectTimeout: 5000,
    timeout: 10000,
    agent: new (require('https').Agent)({ keepAlive: false, maxSockets: 1 })
  }
});

const S3 = new AWS.S3({ region: 'YOUR_S3_BUCKET_REGION' });
const bucket = 'YOUR_BUCKET_NAME';

// CLI options
const EXCLUDE_PREFIXES = args.exclude ? args.exclude.split(',').map(p => p.trim().replace(/\/?$/, '/')) : [];
const INCLUDE_PREFIX = args.include ? args.include.trim().replace(/\/?$/, '/') : null;
const CONCURRENCY = parseInt(args.concurrency, 10) || 5;
const DRY_RUN = args['dry-run'];

const failedKeysFile = path.join(__dirname, 'failed-keys.txt');
let totalProcessed = 0;
let totalCount = 0;
let failedKeys = [];

// Timeout wrapper
async function withTimeout(promise, ms, key) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms for ${key}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

// Decide if we should process this key
function shouldProcess(key) {
  if (key.toLowerCase().endsWith('.webp')) return false;
  if (INCLUDE_PREFIX && !key.startsWith(INCLUDE_PREFIX)) return false;
  if (EXCLUDE_PREFIXES.some(prefix => key.startsWith(prefix))) return false;
  return true;
}

async function convertImage(key) {
  const webpKey = key.replace(/\.[^.]+$/, '') + '.webp';

  // Skip if WebP already exists
  try {
    await withTimeout(S3.headObject({ Bucket: bucket, Key: webpKey }).promise(), 8000, webpKey);
    console.log(`Skipping (already exists): ${webpKey}`);
    return;
  } catch (err) {
    if (err.code !== 'NotFound') {
      console.error(`Error checking ${webpKey}:`, err.message);
      failedKeys.push(key);
      return;
    }
  }

  if (DRY_RUN) {
    console.log(`[DRY RUN] Would convert: ${key}`);
    return;
  }

  try {
    const obj = await withTimeout(S3.getObject({ Bucket: bucket, Key: key }).promise(), 15000, key);
    const originalSize = obj.Body.length;

    const webpBuffer = await sharp(obj.Body)
      .webp({ quality: 65, effort: 6, smartSubsample: true })
      .toBuffer();

    await withTimeout(S3.putObject({
      Bucket: bucket,
      Key: webpKey,
      Body: webpBuffer,
      ContentType: 'image/webp',
      ACL: 'public-read'
    }).promise(), 15000, webpKey);

    console.log(
      `Converted: ${webpKey} | ${(originalSize / 1024).toFixed(1)} KB → ${(webpBuffer.length / 1024).toFixed(1)} KB`
    );
  } catch (err) {
    console.error(`Error processing ${key}:`, err.message);
    failedKeys.push(key);
  }
}

async function processAllObjects() {
  let continuationToken;
  const limit = pLimit(CONCURRENCY);

  console.log(`🔍 Starting batch job...`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Include: ${INCLUDE_PREFIX || '(all)'}`);
  console.log(`   Exclude: ${EXCLUDE_PREFIXES.join(', ') || '(none)'}`);
  if (DRY_RUN) console.log(`   Mode: DRY RUN (no changes will be made)`);

  do {
    const params = { Bucket: bucket, ContinuationToken: continuationToken };
    const data = await withTimeout(S3.listObjectsV2(params).promise(), 10000, 'listObjectsV2');

    const batchKeys = data.Contents.filter(item => shouldProcess(item.Key));
    totalCount += batchKeys.length;

    await Promise.all(
      batchKeys.map(item => limit(async () => {
        await convertImage(item.Key);
        totalProcessed++;
        if (totalProcessed % 50 === 0 || totalProcessed === totalCount) {
          console.log(`Progress: ${totalProcessed}/${totalCount} (${((totalProcessed / totalCount) * 100).toFixed(1)}%)`);
        }
      }))
    );

    continuationToken = data.IsTruncated ? data.NextContinuationToken : null;
  } while (continuationToken);

  if (failedKeys.length > 0) {
    fs.writeFileSync(failedKeysFile, failedKeys.join('\n'));
    console.log(`⚠️ ${failedKeys.length} files failed. Saved to ${failedKeysFile}`);
  }
}

processAllObjects()
  .then(() => {
    console.log('✅ Done');
    process.exit(0); // Force exit so AWS SDK sockets don't keep Node alive
  })
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
