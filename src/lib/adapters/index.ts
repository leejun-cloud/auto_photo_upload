import type { AssetRecord, PlatformKey, PlatformPayload } from '../domain';
import { basenameWithoutExt, trimText, unique } from '../utils';

function normalizeKeywords(keywords: string[], max: number) {
  return unique(
    keywords
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  ).slice(0, max);
}

function resolveLicenseMode(asset: AssetRecord) {
  return asset.releaseStatus === 'none' ? 'editorial' : 'commercial';
}

// Ordered keyword -> category groups. First group with any keyword match wins,
// so more specific categories should be listed before broad ones.
const CATEGORY_KEYWORD_GROUPS: Array<{ category: string; keywords: string[] }> = [
  { category: 'People / Portrait', keywords: ['person', 'people', 'man', 'woman', 'child', 'children', 'family', 'portrait', 'face', 'student', 'teacher'] },
  { category: 'Education', keywords: ['classroom', 'school', 'education', 'library', 'reading', 'learning', 'study', 'university'] },
  { category: 'Animals / Wildlife', keywords: ['animal', 'wildlife', 'bird', 'dog', 'cat', 'wild', 'mammal', 'caribou', 'deer', 'forest animal'] },
  { category: 'Nature / Landscape', keywords: ['nature', 'landscape', 'forest', 'mountain', 'water', 'river', 'ocean', 'sky', 'outdoor', 'tree'] },
  { category: 'Technology', keywords: ['technology', 'computer', 'device', 'gadget', 'electronic', 'digital', 'gaming', 'controller', 'console'] },
  { category: 'Food / Drink', keywords: ['food', 'drink', 'meal', 'restaurant', 'cooking', 'kitchen', 'cuisine'] },
  { category: 'Business', keywords: ['business', 'office', 'meeting', 'work', 'corporate', 'finance'] },
  { category: 'Travel / Architecture', keywords: ['travel', 'architecture', 'building', 'city', 'urban', 'tourism', 'landmark'] },
];

// Adobe's own category field is picked by a human on the contributor portal
// (see the app's automation boundary: FTP/embed is automatic, final Submit and
// classification stay manual). This hint is only a convenience note in the
// exported package, but it must reflect the actual photo — a fixed guess for
// every asset is actively misleading (e.g. it previously labeled a wildlife
// photo and a product shot both "People / Education").
function deriveCategoryHint(asset: AssetRecord): string {
  const haystack = [asset.title, ...asset.keywords].join(' ').toLowerCase();
  for (const group of CATEGORY_KEYWORD_GROUPS) {
    if (group.keywords.some((kw) => haystack.includes(kw))) return group.category;
  }
  return 'General — review category manually';
}

export function buildPlatformPayload(platform: PlatformKey, asset: AssetRecord): PlatformPayload {
  const licenseMode = resolveLicenseMode(asset);
  const common = {
    assetId: asset.id,
    title: asset.title,
    description: asset.description,
    width: asset.width,
    height: asset.height,
    licenseMode,
    releaseStatus: asset.releaseStatus,
  };

  if (platform === 'adobe') {
    return {
      assetId: asset.id,
      platform,
      exportBaseName: `${basenameWithoutExt(asset.originalFilename)}-adobe`,
      instructions: ['Upload the JPEG in Adobe Stock contributor portal.', 'Paste ordered keywords exactly as provided.', 'Confirm release attachment before final submit.'],
      metadata: {
        ...common,
        title: trimText(asset.title, 200),
        keywords: normalizeKeywords(asset.keywords, 49),
        categoryHint: deriveCategoryHint(asset),
      },
    };
  }

  if (platform === 'shutterstock') {
    return {
      assetId: asset.id,
      platform,
      exportBaseName: `${basenameWithoutExt(asset.originalFilename)}-shutterstock`,
      instructions: ['Upload the file in Shutterstock Contributor.', 'If no releases exist, keep the item editorial-only.', 'Review keyword order and remove weak tail terms if needed.'],
      metadata: {
        ...common,
        caption: trimText(asset.description || asset.title, 200),
        keywords: normalizeKeywords(asset.keywords, 50),
        licenseMode,
      },
    };
  }

  if (platform === 'alamy') {
    return {
      assetId: asset.id,
      platform,
      exportBaseName: `${basenameWithoutExt(asset.originalFilename)}-alamy`,
      instructions: ['Upload JPEG to Alamy.', 'Use the caption and keyword set in the package.', 'Review discoverability fields before submission.'],
      metadata: {
        ...common,
        caption: trimText(asset.description || asset.title, 150),
        keywords: normalizeKeywords(asset.keywords, 50),
        discoverabilityNotes: 'Add location and contextual tags if available.',
      },
    };
  }

  return {
    assetId: asset.id,
    platform,
    exportBaseName: `${basenameWithoutExt(asset.originalFilename)}-getty`,
    instructions: ['Prepare this package for Getty/iStock submission flow.', 'Review commercial/editorial classification manually before final submit.'],
    metadata: {
      ...common,
      headline: trimText(asset.title, 80),
      caption: trimText(asset.description, 200),
      keywords: normalizeKeywords(asset.keywords, 50),
      collectionHint: 'Creative / Education',
    },
  };
}
