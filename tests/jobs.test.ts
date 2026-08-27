import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { AssetRecord, PlatformKey } from '../src/lib/domain';
import type { GeneratedMetadata } from '../src/lib/ai/metadata';
import type { UploadResult } from '../src/lib/ftp/uploader';
import { runAssetPipeline, type PipelineDeps } from '../src/lib/jobs/pipeline';
import { deliveryFailureMessage, processJob } from '../src/lib/jobs/worker';
import { createUserFromFirebase, enqueueJob, getJobForUser, markJobFailed } from '../src/lib/repository';

const asset: AssetRecord = {
  id: 'asset-1',
  userId: 'user-1',
  originalFilename: 'photo.jpg',
  storageBackend: 'local',
  storagePath: '/tmp/photo.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'image',
  fileSize: 10,
  width: 100,
  height: 100,
  durationSeconds: null,
  title: 'Old title',
  description: 'Old description',
  keywords: ['old'],
  releaseStatus: 'none',
  createdAt: 'now',
  updatedAt: 'now',
};

function makeDeps(overrides: Partial<PipelineDeps> = {}) {
  const results: UploadResult[] = [{ platform: 'adobe', status: 'uploaded', remotePath: 'photo.jpg' }];
  const generated: GeneratedMetadata = { title: 'New title', description: 'New description', keywords: ['new'] };
  const deps = {
    loadAsset: vi.fn(async () => asset),
    readBytes: vi.fn(async () => Buffer.from('RAW')),
    generateMetadata: vi.fn(async () => generated),
    updateAssetMetadata: vi.fn(async () => ({ ...asset, ...generated })),
    uploadToAgencies: vi.fn(async () => results),
    createSubmission: vi.fn(async () => ({}) as never),
    ...overrides,
  } satisfies PipelineDeps;
  return { deps, results, generated };
}

describe('runAssetPipeline', () => {
  it('generates metadata and uploads with the refreshed asset when generateMetadata is true', async () => {
    const { deps, results, generated } = makeDeps();

    const summary = await runAssetPipeline(
      { userId: 'user-1', assetId: 'asset-1', platforms: ['adobe'] as PlatformKey[], generateMetadata: true },
      deps,
    );

    expect(deps.generateMetadata).toHaveBeenCalledWith(Buffer.from('RAW'), 'image/jpeg');
    expect(deps.updateAssetMetadata).toHaveBeenCalledWith('user-1', 'asset-1', generated);
    // Upload must use the refreshed asset returned by updateAssetMetadata.
    expect(deps.uploadToAgencies).toHaveBeenCalledWith(
      expect.objectContaining({ asset: expect.objectContaining({ title: 'New title' }) }),
    );
    expect(deps.createSubmission).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ metadataGenerated: true, results });
  });

  it('skips metadata generation and uploads directly when generateMetadata is false', async () => {
    const { deps, results } = makeDeps();

    const summary = await runAssetPipeline(
      { userId: 'user-1', assetId: 'asset-1', platforms: ['adobe'] as PlatformKey[], generateMetadata: false },
      deps,
    );

    expect(deps.generateMetadata).not.toHaveBeenCalled();
    expect(deps.updateAssetMetadata).not.toHaveBeenCalled();
    expect(deps.uploadToAgencies).toHaveBeenCalledTimes(1);
    expect(summary).toEqual({ metadataGenerated: false, results });
  });

  it('throws when the asset is missing', async () => {
    const { deps } = makeDeps({ loadAsset: vi.fn(async () => null) });
    await expect(
      runAssetPipeline({ userId: 'user-1', assetId: 'missing', platforms: [], generateMetadata: false }, deps),
    ).rejects.toThrow(/asset not found/);
  });
});

describe('processJob', () => {
  it('routes asset_pipeline to the pipeline (which rejects for a nonexistent asset)', async () => {
    const job = {
      id: 'job-1',
      userId: 'user-1',
      assetId: 'no-such-asset',
      type: 'asset_pipeline',
      status: 'processing' as const,
      attempts: 0,
      maxAttempts: 3,
      payload: { platforms: ['adobe'], generateMetadata: false },
      result: null,
      error: null,
      runAfter: 'now',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await expect(processJob(job)).rejects.toThrow(/asset not found/);
  });

  it('throws on an unknown job type', async () => {
    const job = {
      id: 'job-2',
      userId: 'user-1',
      assetId: null,
      type: 'mystery',
      status: 'processing' as const,
      attempts: 0,
      maxAttempts: 3,
      payload: {},
      result: null,
      error: null,
      runAfter: 'now',
      createdAt: 'now',
      updatedAt: 'now',
    };
    await expect(processJob(job)).rejects.toThrow(/unknown job type/);
  });
});

describe('deliveryFailureMessage', () => {
  // A pipeline that finishes without throwing is NOT necessarily a delivery.
  // uploadToAgencies reports per-platform FTP errors as data, and treating that
  // as success showed "완료 ✅" for photos that never reached the agency.
  it('returns null when every platform uploaded', () => {
    expect(
      deliveryFailureMessage({
        results: [
          { platform: 'adobe', status: 'uploaded' },
          { platform: 'alamy', status: 'uploaded' },
        ],
      }),
    ).toBeNull();
  });

  it('names the agency when a platform failed', () => {
    expect(deliveryFailureMessage({ results: [{ platform: 'adobe', status: 'failed' }] })).toBe(
      '어도비 스톡 업로드 실패 (1/1)',
    );
  });

  it('reports a partial delivery rather than calling it success', () => {
    const message = deliveryFailureMessage({
      results: [
        { platform: 'adobe', status: 'uploaded' },
        { platform: 'shutterstock', status: 'failed' },
      ],
    });
    expect(message).toBe('셔터스톡 업로드 실패 (1/2)');
  });

  it('treats an unknown status as not delivered', () => {
    expect(deliveryFailureMessage({ results: [{ platform: 'alamy', status: 'weird' }] })).toBe('알라미 업로드 실패 (1/1)');
  });

  it('is defensive about missing or non-upload results', () => {
    // Jobs without platform results (e.g. future job types) must stay succeedable.
    expect(deliveryFailureMessage(null)).toBeNull();
    expect(deliveryFailureMessage({})).toBeNull();
    expect(deliveryFailureMessage({ results: [] })).toBeNull();
    expect(deliveryFailureMessage({ results: 'nope' } as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('markJobFailed retry decision', () => {
  it('requeues with a future run_after while retries remain, then fails at max_attempts', async () => {
    const user = await createUserFromFirebase({ uid: randomUUID(), email: `${randomUUID()}@t.io`, name: 'T' });
    const job = await enqueueJob({ userId: user.id, type: 'asset_pipeline', payload: { platforms: [] } });
    expect(job.attempts).toBe(0);
    expect(job.status).toBe('pending');

    // Attempt 1 of 3: requeued.
    await markJobFailed(job.id, 'boom', 5000);
    let after = await getJobForUser(user.id, job.id);
    expect(after?.attempts).toBe(1);
    expect(after?.status).toBe('pending');
    expect(after?.error).toBe('boom');
    expect(new Date(after!.runAfter).getTime()).toBeGreaterThan(Date.now());

    // Attempt 2 of 3: still requeued.
    await markJobFailed(job.id, 'boom2', 5000);
    after = await getJobForUser(user.id, job.id);
    expect(after?.attempts).toBe(2);
    expect(after?.status).toBe('pending');

    // Attempt 3 of 3: exhausted -> failed.
    await markJobFailed(job.id, 'boom3', 5000);
    after = await getJobForUser(user.id, job.id);
    expect(after?.attempts).toBe(3);
    expect(after?.status).toBe('failed');
  });
});
