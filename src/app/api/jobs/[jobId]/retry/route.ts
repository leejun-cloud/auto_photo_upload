import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { logInfo } from '@/lib/logger';
import { getJobForUser, retryJob } from '@/lib/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { jobId } = await params;
  const existing = await getJobForUser(user.id, jobId);
  if (!existing) {
    return NextResponse.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 });
  }
  if (existing.status !== 'failed') {
    return NextResponse.json({ error: '이미 완료되었거나 진행 중인 작업입니다.' }, { status: 409 });
  }

  const job = await retryJob(user.id, jobId);
  logInfo('job.retry_requested', { userId: user.id, jobId });
  return NextResponse.json({ job });
}
