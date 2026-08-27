import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { localExportsDir, localUploadsDir } from './db';
import { adminBucket } from './firebase/admin';
import type { PlatformKey, StorageBackend } from './domain';
import { sanitizeFilename } from './utils';

const backend: StorageBackend =
  process.env.STORAGE_BACKEND === 'firebase' ? 'firebase' : process.env.STORAGE_BACKEND === 's3' ? 's3' : 'local';
const bucket = process.env.S3_BUCKET;
const region = process.env.S3_REGION ?? 'us-east-1';
const endpoint = process.env.S3_ENDPOINT;
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

const s3 = backend === 's3'
  ? new S3Client({
      region,
      endpoint,
      forcePathStyle,
      credentials: process.env.S3_ACCESS_KEY_ID
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
          }
        : undefined,
    })
  : null;

function getBucket() {
  if (!bucket) throw new Error('S3_BUCKET is required when STORAGE_BACKEND=s3');
  return bucket;
}

export function getStorageBackend(): StorageBackend {
  return backend;
}

export type UploadTarget =
  | { backend: StorageBackend; direct: true; uploadUrl: string; storagePath: string }
  | { backend: StorageBackend; direct: false; storagePath: '' };

// Vercel Functions hard-cap the request body at 4.5MB (platform-level, not
// configurable) — see https://vercel.com/docs/functions/limitations. Real camera
// JPEGs from a professional photographer routinely run 15–40MB+, so proxying
// upload bytes through a Next.js route handler silently caps out well below any
// real photo and returns FUNCTION_PAYLOAD_TOO_LARGE. For the `firebase` backend
// (what production actually uses), the client instead PUTs bytes directly to a
// short-lived signed URL, bypassing the function body entirely; only the tiny
// JSON handshake (filename/mime) touches the function.
export async function createUploadTarget(params: {
  ownerId: string;
  fileName: string;
  mimeType: string;
}): Promise<UploadTarget> {
  if (backend !== 'firebase') {
    // local/S3 dev paths keep the original small-file proxy flow; only
    // production (firebase backend) needs the large-file bypass.
    return { backend, direct: false, storagePath: '' };
  }

  const key = `uploads/${params.ownerId}/${randomUUID()}-${sanitizeFilename(params.fileName)}`;
  const objectName = `stockflow/${key}`;
  const [uploadUrl] = await adminBucket()
    .file(objectName)
    .getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 10 * 60 * 1000,
      contentType: params.mimeType,
    });
  return { backend, direct: true, uploadUrl, storagePath: objectName };
}

/** True when `storagePath` is a real object under this owner's own upload prefix. */
export function isOwnedUploadPath(storagePath: string, ownerId: string): boolean {
  return storagePath.startsWith(`stockflow/uploads/${ownerId}/`);
}

export async function statStoredObject(storageBackend: StorageBackend, storagePath: string): Promise<{ exists: boolean; size: number }> {
  if (storageBackend !== 'firebase') {
    // Only the direct-upload (firebase) path needs a pre-download existence
    // check; other backends never reach this without bytes already in hand.
    return { exists: false, size: 0 };
  }
  const [exists] = await adminBucket().file(storagePath).exists();
  if (!exists) return { exists: false, size: 0 };
  const [meta] = await adminBucket().file(storagePath).getMetadata();
  return { exists: true, size: Number(meta.size ?? 0) };
}

export async function saveUploadObject(params: { ownerId: string; fileName: string; mimeType: string; bytes: Buffer }) {
  const key = `uploads/${params.ownerId}/${randomUUID()}-${sanitizeFilename(params.fileName)}`;
  if (backend === 'local') {
    const absolutePath = path.join(localUploadsDir, path.basename(key));
    await writeFile(absolutePath, params.bytes);
    return { backend, path: absolutePath };
  }

  if (backend === 'firebase') {
    const objectName = `stockflow/${key}`;
    await adminBucket().file(objectName).save(params.bytes, { contentType: params.mimeType });
    return { backend, path: objectName };
  }

  await new Upload({
    client: s3!,
    params: {
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: params.mimeType,
    },
  }).done();

  return { backend, path: key };
}

export async function saveExportObject(params: {
  ownerId: string;
  assetId: string;
  platform: PlatformKey;
  fileName: string;
  bytes: Buffer;
}) {
  const key = `exports/${params.ownerId}/${params.assetId}/${params.platform}/${sanitizeFilename(params.fileName)}`;

  if (backend === 'local') {
    const dir = path.join(localExportsDir, params.assetId, params.platform);
    await mkdir(dir, { recursive: true });
    const absolutePath = path.join(dir, sanitizeFilename(params.fileName));
    await writeFile(absolutePath, params.bytes);
    return { backend, path: absolutePath };
  }

  if (backend === 'firebase') {
    const objectName = `stockflow/${key}`;
    await adminBucket().file(objectName).save(params.bytes, { contentType: 'application/zip' });
    return { backend, path: objectName };
  }

  await new Upload({
    client: s3!,
    params: {
      Bucket: getBucket(),
      Key: key,
      Body: params.bytes,
      ContentType: 'application/zip',
    },
  }).done();

  return { backend, path: key };
}

export async function readStoredObject(storageBackend: StorageBackend, storagePath: string) {
  if (storageBackend === 'local') {
    return readFile(storagePath);
  }

  if (storageBackend === 'firebase') {
    const [contents] = await adminBucket().file(storagePath).download();
    return contents;
  }

  const response = await s3!.send(new GetObjectCommand({ Bucket: getBucket(), Key: storagePath }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
