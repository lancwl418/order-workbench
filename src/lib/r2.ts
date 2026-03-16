import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";

let _client: S3Client | null = null;

function getClient() {
  if (_client) return _client;

  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials not configured");
  }

  _client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  return _client;
}

/**
 * Upload a file buffer to Cloudflare R2.
 * Returns the public URL of the uploaded file.
 */
export async function uploadToR2(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!bucket || !publicUrl) {
    throw new Error("R2 bucket or public URL not configured");
  }

  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  // Remove trailing slash from publicUrl if present
  const base = publicUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

/**
 * Stream-upload a file to R2 using multipart upload.
 * Keeps memory usage low for large files.
 */
export async function streamUploadToR2(
  stream: Readable,
  key: string,
  contentType: string,
  contentLength?: number
): Promise<string> {
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL;

  if (!bucket || !publicUrl) {
    throw new Error("R2 bucket or public URL not configured");
  }

  const client = getClient();

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: key,
      Body: stream,
      ContentType: contentType,
      ...(contentLength ? { ContentLength: contentLength } : {}),
    },
    // 10MB parts, up to 4 concurrent uploads
    partSize: 10 * 1024 * 1024,
    queueSize: 4,
  });

  await upload.done();

  const base = publicUrl.replace(/\/$/, "");
  return `${base}/${key}`;
}

const CS_BUCKET = "others";
const CS_PUBLIC_URL = "https://pub-498ec5ccaa124100aa536cb9d43ec257.r2.dev";

/**
 * Upload a file to the CS attachments R2 bucket ("others").
 */
export async function uploadToCsBucket(
  buffer: Buffer,
  key: string,
  contentType: string
): Promise<string> {
  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: CS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return `${CS_PUBLIC_URL}/${key}`;
}
