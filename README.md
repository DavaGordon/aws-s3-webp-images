# S3 Image to WebP Conversion Script

This script converts images in a specified S3 bucket to WebP format using [`sharp`](https://www.npmjs.com/package/sharp) and uploads them back to the bucket with a `.webp` extension. It processes images in batches with limited concurrency and supports inclusion/exclusion rules.

---

## Features

- Converts existing images (non-WebP) in an S3 bucket to WebP.
- Skips files that already exist as WebP.
- Supports inclusion and exclusion prefixes.
- Limits concurrency to avoid overwhelming S3.
- Optional dry-run mode to simulate conversions without uploading.
- Logs progress and writes failed keys to `failed-keys.txt`.

---

## Prerequisites

- AWS Account with access to the target S3 bucket.
- Node.js (v18+) installed.
- EC2 instance or local environment with IAM credentials allowing S3 access.

---

## IAM Role / Permissions

Attach an IAM role with at least the following permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR_BUCKET_NAME",
        "arn:aws:s3:::YOUR_BUCKET_NAME/*"
      ]
    }
  ]
}
```

---

## Setup

1. Clone or create a project folder:

```bash
mkdir ~/webp-converter
cd ~/webp-converter
```

2. Save the script as `convert-existing-batch.js`.

3. Initialize Node.js project and install dependencies:

```bash
npm init -y
npm install aws-sdk@2 sharp p-limit@3 minimist
```

4. Edit the script to set your bucket and region:

```js
const S3 = new AWS.S3({ region: 'YOUR_S3_BUCKET_REGION' });
const bucket = 'YOUR_BUCKET_NAME';
const CONCURRENCY = 5; // Adjust if needed
```

---

## Usage

Basic run:

```bash
node convert-existing-batch.js
```

### Command-line Options

| Option                        | Type    | Description                                          |
| ----------------------------- | ------- | ---------------------------------------------------- |
| `--exclude "prefix1,prefix2"` | string  | Comma-separated list of prefixes to skip.            |
| `--include "prefix"`          | string  | Only process keys starting with this prefix.         |
| `--dry-run`                   | boolean | Logs actions without uploading converted files.      |
| `--concurrency N`             | number  | Maximum number of parallel conversions (default: 5). |

**Examples:**

- Convert everything except the `backup/` folder:

```bash
node convert-existing-batch.js --exclude "backup/"
```

- Only process images in the `products/` folder:

```bash
node convert-existing-batch.js --include "products/"
```

- Test run without uploading:

```bash
node convert-existing-batch.js --dry-run
```

---

## Logging & Progress

- Prints progress every 50 images or at the end of processing.
- Skipped files and conversions are logged.
- Failed keys are written to `failed-keys.txt`.

---

## Notes

- Adjust `CONCURRENCY` to balance speed vs resource usage.
- Existing `.webp` files are skipped automatically.
- Make sure the IAM role or credentials have the necessary S3 permissions.

---

## Troubleshooting

- **Missing credentials error:**\
  Ensure the EC2 instance has the IAM role attached or AWS credentials are configured.

- **Sharp installation issues:**\
  May require build tools:

```bash
sudo apt install -y build-essential
```

---

## License

MIT License
