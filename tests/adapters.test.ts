import { describe, expect, it } from 'vitest';
import { buildPlatformPayload } from '../src/lib/adapters';
import type { AssetRecord } from '../src/lib/domain';

const baseAsset: AssetRecord = {
  id: 'asset-1',
  userId: 'user-1',
  originalFilename: 'sample.jpg',
  storageBackend: 'local',
  storagePath: '/tmp/sample.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'image',
  fileSize: 12345,
  width: 6000,
  height: 4000,
  durationSeconds: null,
  title: 'Children reading together in a bright library classroom',
  description: 'A documentary-style education photo showing children reading together in a bright Korean classroom.',
  keywords: ['children', 'education', 'library', 'reading', 'classroom', 'korea'],
  releaseStatus: 'none',
  createdAt: '2026-07-16T00:00:00.000Z',
  updatedAt: '2026-07-16T00:00:00.000Z',
};

describe('platform adapters', () => {
  it('keeps only 49 keywords for Adobe and preserves order', () => {
    const keywords = Array.from({ length: 60 }, (_, index) => `kw-${index + 1}`);
    const payload = buildPlatformPayload('adobe', { ...baseAsset, keywords });
    const adobeKeywords = payload.metadata.keywords as string[];
    expect(payload.platform).toBe('adobe');
    expect(adobeKeywords).toHaveLength(49);
    expect(adobeKeywords[0]).toBe('kw-1');
    expect(adobeKeywords.at(-1)).toBe('kw-49');
  });

  it('marks Shutterstock export as editorial when releases are missing', () => {
    const payload = buildPlatformPayload('shutterstock', baseAsset);
    expect(payload.platform).toBe('shutterstock');
    expect(payload.metadata.licenseMode).toBe('editorial');
  });

  it('marks Adobe export as commercial when a release is attached', () => {
    const payload = buildPlatformPayload('adobe', { ...baseAsset, releaseStatus: 'model_attached' });
    expect(payload.metadata.licenseMode).toBe('commercial');
  });

  // Regression: categoryHint used to be hardcoded to 'People / Education' for
  // every Adobe export regardless of content — confirmed live against real AI
  // output ("Caribou in shallow water…" and "Black PlayStation Controller…"),
  // neither of which is people or education.
  it('derives the Adobe categoryHint from actual content instead of a fixed guess', () => {
    const wildlife = buildPlatformPayload('adobe', {
      ...baseAsset,
      title: 'Caribou in shallow water near forested bank',
      keywords: ['caribou', 'antlers', 'wildlife', 'nature', 'forest', 'water'],
    });
    expect(wildlife.metadata.categoryHint).toBe('Animals / Wildlife');

    const product = buildPlatformPayload('adobe', {
      ...baseAsset,
      title: 'Black PlayStation Controller on Wooden Table',
      keywords: ['controller', 'playstation', 'gaming', 'console', 'technology'],
    });
    expect(product.metadata.categoryHint).toBe('Technology');

    const classroom = buildPlatformPayload('adobe', baseAsset); // children reading in a classroom
    expect(classroom.metadata.categoryHint).toBe('People / Portrait');

    const unmatched = buildPlatformPayload('adobe', { ...baseAsset, title: 'Untitled', keywords: ['xyz123'] });
    expect(unmatched.metadata.categoryHint).toBe('General — review category manually');
  });
});
