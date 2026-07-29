import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { processReadyJobs } from '@/lib/jobs/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const summary = await processReadyJobs();
  return NextResponse.json(summary);
}

export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const isCron = Boolean(cronSecret) && request.headers.get('x-cron-secret') === cronSecret;

  if (!isCron) {
    // Client-driven processing: an authenticated user can drain the queue after enqueue.
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const summary = await processReadyJobs();
  return NextResponse.json(summary);
}
