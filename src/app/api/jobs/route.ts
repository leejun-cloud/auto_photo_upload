import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { listJobsForUser } from '@/lib/repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  return NextResponse.json({ jobs: await listJobsForUser(user.id) });
}
