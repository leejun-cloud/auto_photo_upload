import { imageSize } from 'image-size';
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { logInfo } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { createAsset } from '@/lib/repository';
import { saveUploadObject } from '@/lib/storage';
import { mediaTypeFromMime } from '@/lib/utils';

export const runtime = 'nodejs';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 200 * 1024 * 1024;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!rateLimit(`upload:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }

  const formData = await request.formData();
  const uploaded = formData.get('file');

  if (!(uploaded instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }

  if (uploaded.size > MAX_UPLOAD_BYTES) {
    const maxMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
    return NextResponse.json({ error: `파일이 너무 큽니다 (최대 ${maxMb}MB)` }, { status: 413 });
  }

  const title = String(formData.get('title') || '').trim() || uploaded.name.replace(/\.[^.]+$/, '');
  const description = String(formData.get('description') || '').trim();
  const keywordText = String(formData.get('keywords') || '').trim();
  const releaseStatus = String(formData.get('releaseStatus') || 'none');
  const keywords = keywordText.split(',').map((item) => item.trim()).filter(Boolean);

  const bytes = Buffer.from(await uploaded.arrayBuffer());
  const mimeType = uploaded.type || 'application/octet-stream';
  const mediaType = mediaTypeFromMime(mimeType);
  const stored = await saveUploadObject({ ownerId: user.id, fileName: uploaded.name, mimeType, bytes });
  const dimensions = mediaType === 'image' ? imageSize(bytes) : { width: undefined, height: undefined };

  const asset = await createAsset({
    userId: user.id,
    originalFilename: uploaded.name,
    storageBackend: stored.backend,
    storagePath: stored.path,
    mimeType,
    mediaType,
    fileSize: uploaded.size,
    width: dimensions.width ?? null,
    height: dimensions.height ?? null,
    durationSeconds: null,
    title,
    description,
    keywords,
    releaseStatus: releaseStatus as 'none' | 'model_attached' | 'property_attached' | 'both_attached',
  });

  logInfo('asset.uploaded', { userId: user.id, assetId: asset.id, mediaType: asset.mediaType, fileSize: asset.fileSize });

  return NextResponse.json({ asset });
}
