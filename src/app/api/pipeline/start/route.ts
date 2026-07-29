import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUser } from '@/lib/auth';
import { logInfo } from '@/lib/logger';
import { enqueueJob, getAssetByIdForUser } from '@/lib/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  assetIds: z.array(z.string()).min(1),
  platforms: z.array(z.enum(['adobe', 'shutterstock', 'alamy', 'getty'])).min(1),
  generateMetadata: z.boolean(),
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid payload' }, { status: 400 });
  }

  const { assetIds, platforms, generateMetadata } = parsed.data;
  const jobIds: string[] = [];
  const skipped: string[] = [];

  for (const assetId of assetIds) {
    const asset = await getAssetByIdForUser(user.id, assetId);
    if (!asset) {
      skipped.push(assetId);
      continue;
    }
    const job = await enqueueJob({
      userId: user.id,
      assetId,
      type: 'asset_pipeline',
      payload: { platforms, generateMetadata },
    });
    jobIds.push(job.id);
  }

  logInfo('pipeline.batch_started', { userId: user.id, count: jobIds.length });

  return NextResponse.json({ jobIds, skipped });
}
