import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateMetadata } from '@/lib/ai/metadata';
import { getCurrentUser } from '@/lib/auth';
import { logInfo } from '@/lib/logger';
import { getAssetByIdForUser, updateAssetMetadata } from '@/lib/repository';
import { readStoredObject } from '@/lib/storage';

export const runtime = 'nodejs';

const schema = z.object({
  hint: z.string().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { assetId } = await context.params;
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const asset = await getAssetByIdForUser(user.id, assetId);
  if (!asset) {
    return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  }

  const fileBytes = await readStoredObject(asset.storageBackend, asset.storagePath);

  let metadata;
  try {
    metadata = await generateMetadata(fileBytes, asset.mimeType, { hint: parsed.data.hint });
  } catch (error) {
    return NextResponse.json(
      { error: 'metadata generation failed', detail: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }

  const updated = await updateAssetMetadata(user.id, assetId, metadata);
  logInfo('asset.metadata_generated', { userId: user.id, assetId });
  return NextResponse.json({ metadata, asset: updated });
}
