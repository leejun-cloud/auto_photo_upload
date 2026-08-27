import { describe, expect, it } from 'vitest';
import { isOwnedUploadPath } from '../src/lib/storage';

// The direct-to-storage upload flow (added because Vercel Functions cap request
// bodies at 4.5MB, well under a real camera photo) means /api/assets/finalize
// trusts a client-supplied storagePath. isOwnedUploadPath is the only guard
// standing between that and letting user A register user B's uploaded object,
// or an arbitrary bucket path, as their own asset.
describe('isOwnedUploadPath', () => {
  it('accepts a path under the caller\'s own upload prefix', () => {
    expect(isOwnedUploadPath('stockflow/uploads/user-1/abc-photo.jpg', 'user-1')).toBe(true);
  });

  it('rejects another user\'s upload prefix', () => {
    expect(isOwnedUploadPath('stockflow/uploads/user-2/abc-photo.jpg', 'user-1')).toBe(false);
  });

  it('rejects paths outside the uploads/ tree entirely (e.g. exports, other users\' data)', () => {
    expect(isOwnedUploadPath('stockflow/exports/user-1/adobe/photo.zip', 'user-1')).toBe(false);
    expect(isOwnedUploadPath('some-other-apps-collection/secret.json', 'user-1')).toBe(false);
  });

  it('rejects a bare prefix match without the trailing separator (no user-10 matching user-1)', () => {
    expect(isOwnedUploadPath('stockflow/uploads/user-10/photo.jpg', 'user-1')).toBe(false);
  });

  it('rejects empty or malformed paths', () => {
    expect(isOwnedUploadPath('', 'user-1')).toBe(false);
    expect(isOwnedUploadPath('stockflow/uploads/', 'user-1')).toBe(false);
  });
});
