import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { createUploadTarget } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 200 * 1024 * 1024;

const schema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  fileSize: z.number().int().positive(),
});

// Step 1 of the direct-to-storage upload: hand the browser a short-lived signed
// URL so the file bytes never pass through this (4.5MB-capped) function. See
// storage.ts for why this exists.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!rateLimit(`upload-url:${user.id}`, 60, 60_000)) {
    return NextResponse.json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' }, { status: 429 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  if (parsed.data.fileSize > MAX_UPLOAD_BYTES) {
    const maxMb = Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024));
    return NextResponse.json({ error: `파일이 너무 큽니다 (최대 ${maxMb}MB)` }, { status: 413 });
  }

  const target = await createUploadTarget({
    ownerId: user.id,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
  });

  return NextResponse.json(target);
}
