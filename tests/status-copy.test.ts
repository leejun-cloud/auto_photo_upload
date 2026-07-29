import { describe, expect, it } from 'vitest';
import type { JobRecord } from '../src/lib/domain';
import { jobStatusLabel, jobSummaryText } from '../src/lib/jobs/status-copy';

function makeJob(overrides: Partial<JobRecord>): JobRecord {
  return {
    id: 'job-1',
    userId: 'user-1',
    assetId: 'asset-1',
    type: 'asset_pipeline',
    status: 'pending',
    attempts: 0,
    maxAttempts: 3,
    payload: {},
    result: null,
    error: null,
    runAfter: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('jobStatusLabel', () => {
  it('maps all four statuses to friendly Korean labels', () => {
    expect(jobStatusLabel('pending')).toBe('대기 중');
    expect(jobStatusLabel('processing')).toBe('처리 중');
    expect(jobStatusLabel('succeeded')).toBe('완료 ✅');
    expect(jobStatusLabel('failed')).toBe('실패 (다시 시도할 수 있어요)');
  });
});

describe('jobSummaryText', () => {
  it('summarizes a succeeded job with upload results', () => {
    const job = makeJob({
      status: 'succeeded',
      result: {
        metadataGenerated: true,
        results: [
          { platform: 'adobe', status: 'uploaded' },
          { platform: 'shutterstock', status: 'uploaded' },
          { platform: 'alamy', status: 'failed' },
        ],
      },
    });
    expect(jobSummaryText(job)).toBe('3개 플랫폼에 업로드됨 (성공 2, 실패 1)');
  });

  it('gives a gentle line for failed jobs', () => {
    const job = makeJob({ status: 'failed', error: 'boom' });
    expect(jobSummaryText(job)).toContain('다시 시도');
  });

  it('is defensive when result_json is missing or garbage', () => {
    expect(jobSummaryText(makeJob({ status: 'succeeded', result: null }))).toBe('완료되었어요.');
    expect(jobSummaryText(makeJob({ status: 'succeeded', result: { results: 'not-an-array' } as unknown as Record<string, unknown> }))).toBe('완료되었어요.');
  });
});
