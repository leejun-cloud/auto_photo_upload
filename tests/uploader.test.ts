import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgencyCredentialRecord, AssetRecord, FtpProtocol, PlatformKey } from '../src/lib/domain';
import { encryptSecret } from '../src/lib/crypto';
import { uploadToAgencies, type UploadClient } from '../src/lib/ftp/uploader';

beforeAll(() => {
  process.env.CREDENTIALS_KEY = randomBytes(32).toString('base64');
});

const asset: AssetRecord = {
  id: 'asset-1',
  userId: 'user-1',
  originalFilename: 'photo.jpg',
  storageBackend: 'local',
  storagePath: '/tmp/photo.jpg',
  mimeType: 'image/jpeg',
  mediaType: 'image',
  fileSize: 1234,
  width: 100,
  height: 100,
  durationSeconds: null,
  title: 'Sunset',
  description: 'A sunset over the sea.',
  keywords: ['sunset', 'sea'],
  releaseStatus: 'none',
  createdAt: 'now',
  updatedAt: 'now',
};

function makeCredential(platform: PlatformKey): AgencyCredentialRecord {
  return {
    id: `cred-${platform}`,
    userId: 'user-1',
    platform,
    protocol: 'ftp' as FtpProtocol,
    host: 'example.com',
    port: 21,
    username: 'user',
    encryptedPassword: encryptSecret('pw'),
    createdAt: 'now',
    updatedAt: 'now',
  };
}

const EMBEDDED = Buffer.from('EMBEDDED-BYTES');

describe('uploadToAgencies', () => {
  it('fans out to all platforms in parallel, isolates failures, retries, and uploads embedded bytes', async () => {
    let concurrent = 0;
    let peakConcurrent = 0;
    const uploadedBytes: Record<string, Buffer> = {};
    const connectCounts: Record<string, number> = {};
    // shutterstock always fails; adobe fails once then succeeds (retry); alamy succeeds.
    let adobeAttempts = 0;

    const embed = vi.fn(async () => EMBEDDED);

    const createClient = vi.fn((_protocol: FtpProtocol): UploadClient => {
      let platform = '';
      return {
        async connect(endpoint, _username, _password) {
          // endpoint.host identifies the platform for our assertions.
          platform = endpoint.host;
          connectCounts[platform] = (connectCounts[platform] ?? 0) + 1;
          concurrent += 1;
          peakConcurrent = Math.max(peakConcurrent, concurrent);
          await new Promise((r) => setTimeout(r, 20));
          concurrent -= 1;
        },
        async uploadFrom(bytes, _remotePath) {
          if (platform === 'ftps.shutterstock.com') throw new Error('shutterstock down');
          if (platform === 'sftp.contributor.adobestock.com') {
            adobeAttempts += 1;
            if (adobeAttempts === 1) throw new Error('transient adobe error');
          }
          uploadedBytes[platform] = bytes;
        },
        async close() {},
      };
    });

    const loadCredential = vi.fn(async (_userId: string, platform: PlatformKey) => makeCredential(platform));

    const results = await uploadToAgencies(
      { userId: 'user-1', asset, fileBytes: Buffer.from('RAW'), platforms: ['alamy', 'adobe', 'shutterstock'] },
      { createClient, embed, loadCredential, retries: 2 },
    );

    // Metadata embedded exactly once, before upload.
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed).toHaveBeenCalledWith(Buffer.from('RAW'), {
      title: asset.title,
      description: asset.description,
      keywords: asset.keywords,
    });

    // Parallel fan-out: all three connected concurrently.
    expect(peakConcurrent).toBeGreaterThan(1);

    const byPlatform = Object.fromEntries(results.map((r) => [r.platform, r]));
    expect(byPlatform.alamy.status).toBe('uploaded');
    expect(byPlatform.adobe.status).toBe('uploaded');
    expect(byPlatform.shutterstock.status).toBe('failed');
    // Raw error is masked; only a generic safe message is exposed to the client field.
    expect(byPlatform.shutterstock.error).toBe('업로드 실패 (연결 또는 인증 오류)');

    // A failing platform did not block the others.
    expect(uploadedBytes['upload.alamy.com']).toEqual(EMBEDDED);
    expect(uploadedBytes['sftp.contributor.adobestock.com']).toEqual(EMBEDDED);

    // Retry happened for adobe (connected twice), shutterstock exhausted retries (3 attempts).
    expect(connectCounts['sftp.contributor.adobestock.com']).toBe(2);
    expect(connectCounts['ftps.shutterstock.com']).toBe(3);
  });

  it('sanitizes a path-traversal filename into a safe basename remotePath', async () => {
    const usedRemotePaths: string[] = [];
    const createClient = vi.fn((_protocol: FtpProtocol): UploadClient => ({
      async connect() {},
      async uploadFrom(_bytes, remotePath) {
        usedRemotePaths.push(remotePath);
      },
      async close() {},
    }));
    const embed = vi.fn(async () => EMBEDDED);
    const loadCredential = vi.fn(async (_userId: string, platform: PlatformKey) => makeCredential(platform));

    const evilAsset: AssetRecord = { ...asset, originalFilename: '../../evil.jpg' };
    const results = await uploadToAgencies(
      { userId: 'user-1', asset: evilAsset, fileBytes: Buffer.from('RAW'), platforms: ['alamy'] },
      { createClient, embed, loadCredential, retries: 0 },
    );

    expect(results[0].status).toBe('uploaded');
    expect(results[0].remotePath).toBe('..-..-evil.jpg');
    expect(results[0].remotePath).not.toContain('/');
    expect(usedRemotePaths[0]).toBe('..-..-evil.jpg');
  });
});
