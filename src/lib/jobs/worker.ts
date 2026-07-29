import type { JobRecord, PlatformKey } from '../domain';
import { logError, logInfo } from '../logger';
import { claimNextReadyJob, markJobFailed, markJobSucceeded } from '../repository';
import { runAssetPipeline } from './pipeline';

export async function processJob(job: JobRecord): Promise<Record<string, unknown>> {
  if (job.type === 'asset_pipeline') {
    if (!job.assetId) throw new Error('asset_pipeline job missing assetId');
    const payload = job.payload as { platforms?: PlatformKey[]; generateMetadata?: boolean };
    const summary = await runAssetPipeline({
      userId: job.userId,
      assetId: job.assetId,
      platforms: payload.platforms ?? [],
      generateMetadata: Boolean(payload.generateMetadata),
    });
    return summary as unknown as Record<string, unknown>;
  }
  throw new Error(`unknown job type: ${job.type}`);
}

export async function processReadyJobs(limit = 5): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextReadyJob();
    if (!job) break;
    processed += 1;

    try {
      const result = await processJob(job);
      await markJobSucceeded(job.id, result);
      succeeded += 1;
      logInfo('job.succeeded', { jobId: job.id, type: job.type, userId: job.userId });
    } catch (error) {
      // Exponential backoff on the (0-based) attempts already made.
      const backoffMs = 1000 * 2 ** job.attempts;
      await markJobFailed(job.id, error instanceof Error ? error.message : String(error), backoffMs);
      failed += 1;
      logError('job.failed', error, { jobId: job.id, type: job.type, userId: job.userId });
    }
  }

  return { processed, succeeded, failed };
}
