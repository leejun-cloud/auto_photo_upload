import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { logInfo } from '@/lib/logger';
import { runAssetPipeline } from '@/lib/jobs/pipeline';
import { getAssetByIdForUser } from '@/lib/repository';

export const runtime = 'nodejs';

const schema = z.object({
  platforms: z.array(z.enum(['adobe', 'shutterstock', 'alamy', 'getty'])).min(1),
});

export async function POST(request: Request, context: { params: Promise<{ assetId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { assetId } = await context.params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const asset = await getAssetByIdForUser(user.id, assetId);
  if (!asset) {
    return NextResponse.json({ error: 'asset not found' }, { status: 404 });
  }

  const { results } = await runAssetPipeline({
    userId: user.id,
    assetId: asset.id,
    platforms: parsed.data.platforms,
    generateMetadata: false,
  });

  logInfo('asset.ftp_uploaded', {
    userId: user.id,
    assetId: asset.id,
    uploaded: results.filter((r) => r.status === 'uploaded').length,
    failed: results.filter((r) => r.status === 'failed').length,
  });

  return NextResponse.json({ results });
}
