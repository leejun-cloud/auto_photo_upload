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
