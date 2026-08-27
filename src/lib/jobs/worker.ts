import type { JobRecord, PlatformKey } from '../domain';
import { PLATFORM_LABELS } from '../ftp/presets';
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

type PlatformResultLike = { platform?: unknown; status?: unknown };

/**
 * Returns a Korean failure message when a pipeline finished without throwing but
 * did not actually deliver to every platform, otherwise null.
 *
 * uploadToAgencies catches per-platform FTP errors and reports them as data, so a
 * job whose uploads all failed still resolves normally. Marking that "succeeded"
 * showed the photographer "완료 ✅" for photos that never reached the agency, and
 * blocked the retry endpoint (409, since retry only accepts failed jobs).
 */
export function deliveryFailureMessage(result: Record<string, unknown> | null | undefined): string | null {
  const results = Array.isArray((result as { results?: unknown } | null | undefined)?.results)
    ? ((result as { results: PlatformResultLike[] }).results)
    : [];
  if (results.length === 0) return null;

  const failedPlatforms = results
    .filter((item) => item?.status !== 'uploaded')
    .map((item) => PLATFORM_LABELS[item?.platform as PlatformKey] ?? String(item?.platform ?? 'unknown'));

  if (failedPlatforms.length === 0) return null;

  return `${failedPlatforms.join(', ')} 업로드 실패 (${failedPlatforms.length}/${results.length})`;
}

export async function processReadyJobs(limit = 5): Promise<{ processed: number; succeeded: number; failed: number }> {
  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextReadyJob();
    if (!job) break;
    processed += 1;

    // Exponential backoff on the (0-based) attempts already made.
    const backoffMs = 1000 * 2 ** job.attempts;

    try {
      const result = await processJob(job);
      const deliveryFailure = deliveryFailureMessage(result);

      if (deliveryFailure) {
        // Re-uploading is safe: the uploader always writes the same remote
        // filename, so a retry overwrites rather than duplicating a submission.
        await markJobFailed(job.id, deliveryFailure, backoffMs);
        failed += 1;
        logError('job.delivery_failed', new Error(deliveryFailure), {
          jobId: job.id,
          type: job.type,
          userId: job.userId,
        });
        continue;
      }

      await markJobSucceeded(job.id, result);
      succeeded += 1;
      logInfo('job.succeeded', { jobId: job.id, type: job.type, userId: job.userId });
    } catch (error) {
      await markJobFailed(job.id, error instanceof Error ? error.message : String(error), backoffMs);
      failed += 1;
      logError('job.failed', error, { jobId: job.id, type: job.type, userId: job.userId });
    }
  }

  return { processed, succeeded, failed };
}
