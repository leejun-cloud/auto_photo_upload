import { imageSize } from 'image-size';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { logInfo } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { createAsset } from '@/lib/repository';
import { isOwnedUploadPath, readStoredObject, statStoredObject } from '@/lib/storage';
import { mediaTypeFromMime } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 200 * 1024 * 1024;

const schema = z.object({
  storagePath: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  releaseStatus: z.enum(['none', 'model_attached', 'property_attached', 'both_attached']).optional(),
});

// Step 2 of the direct-to-storage upload: the browser already PUT the bytes
// straight to the signed URL from /api/assets/upload-url. This only registers
// the asset record — it re-checks the object actually landed under this user's
// own prefix (never trust a client-supplied path blindly) before reading it
// back to measure real dimensions and size.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!rateLimit(`finalize:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const { storagePath, originalFilename, mimeType, releaseStatus } = parsed.data;

  if (!isOwnedUploadPath(storagePath, user.id)) {
    return NextResponse.json({ error: 'invalid storage path' }, { status: 403 });
  }

  const stat = await statStoredObject('firebase', storagePath);
  if (!stat.exists) {
    return NextResponse.json({ error: '업로드가 아직 완료되지 않았어요. 잠시 후 다시 시도해주세요.' }, { status: 409 });
  }
  if (stat.size > MAX_UPLOAD_BYTES) {
    const maxMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
    return NextResponse.json({ error: `파일이 너무 큽니다 (최대 ${maxMb}MB)` }, { status: 413 });
  }

  const mediaType = mediaTypeFromMime(mimeType);
  const dimensions =
    mediaType === 'image' ? imageSize(await readStoredObject('firebase', storagePath)) : { width: undefined, height: undefined };

  const title = (parsed.data.title || '').trim() || originalFilename.replace(/\.[^.]+$/, '');
  const description = (parsed.data.description || '').trim();
  const keywords = (parsed.data.keywords ?? []).map((k) => k.trim()).filter(Boolean);

  const asset = await createAsset({
    userId: user.id,
    originalFilename,
    storageBackend: 'firebase',
    storagePath,
    mimeType,
    mediaType,
    fileSize: stat.size,
    width: dimensions.width ?? null,
    height: dimensions.height ?? null,
    durationSeconds: null,
    title,
    description,
    keywords,
    releaseStatus: releaseStatus ?? 'none',
  });

  logInfo('asset.uploaded', { userId: user.id, assetId: asset.id, mediaType: asset.mediaType, fileSize: asset.fileSize, direct: true });

  return NextResponse.json({ asset });
}
