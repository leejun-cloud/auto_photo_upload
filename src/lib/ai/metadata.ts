import { mediaTypeFromMime, trimText, unique } from '../utils';

const GEMINI_MODEL = process.env.AI_VISION_MODEL || 'gemini-2.5-flash';
const TEXT_MODEL = process.env.AI_TEXT_MODEL || 'deepseek/deepseek-chat';
const REQUEST_TIMEOUT_MS = 30_000;
const TITLE_MAX = 70;
const KEYWORDS_MAX = 50;

export type GeneratedMetadata = {
  title: string;
  description: string;
  keywords: string[];
};

export type GenerateMetadataOptions = {
  // Optional free-text hint (required path for video, since we cannot send frames).
  hint?: string;
};

class MetadataError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'MetadataError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

function normalizeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const cleaned = keywords
    .map((keyword) => (typeof keyword === 'string' ? keyword.trim() : ''))
    .filter(Boolean);
  return unique(cleaned.map((keyword) => keyword.toLowerCase())).slice(0, KEYWORDS_MAX);
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('no JSON object in model output');
  }
  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
}

// Step 1: Gemini vision — image -> caption + candidate keywords.
async function geminiVision(imageBytes: Buffer, mimeType: string): Promise<{ caption: string; keywords: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MetadataError('GEMINI_API_KEY is not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const prompt =
    'You are describing a stock photo. Respond ONLY with JSON of the form ' +
    '{"caption": string, "keywords": string[]}. The caption is one factual sentence. ' +
    'Provide 20-40 relevant, single- or two-word keywords ordered by relevance.';

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBytes.toString('base64') } },
        ],
      },
    ],
  };

  const data = (await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  const parsed = extractJsonObject(text);
  return {
    caption: typeof parsed.caption === 'string' ? parsed.caption.trim() : '',
    keywords: normalizeKeywords(parsed.keywords),
  };
}

// Text completion via OpenRouter (DeepSeek). Returns raw assistant text.
async function openRouterText(system: string, userMessage: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new MetadataError('OPENROUTER_API_KEY is not configured');

  const data = (await fetchJson('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: TEXT_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMessage },
      ],
    }),
  })) as { choices?: { message?: { content?: string } }[] };

  return data.choices?.[0]?.message?.content ?? '';
}

// Text completion via Gemini (fallback text provider — Gemini can also do text).
async function geminiText(system: string, userMessage: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new MetadataError('GEMINI_API_KEY is not configured');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const data = (await fetchJson(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${userMessage}` }] }],
    }),
  })) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
}

// Step 2: refine caption + candidate keywords into stock title/description/keywords.
// Primary provider DeepSeek (OpenRouter); falls back to Gemini text.
async function refineText(caption: string, candidateKeywords: string[]): Promise<GeneratedMetadata | null> {
  const system =
    'You refine raw image understanding into clean stock-photo metadata. ' +
    'Respond ONLY with JSON of the form {"title": string, "description": string, "keywords": string[]}. ' +
    `Title: concise, descriptive, <=${TITLE_MAX} characters, no trailing punctuation. ` +
    'Description: one or two factual sentences. ' +
    `Keywords: lowercase, deduped, ordered by relevance, at most ${KEYWORDS_MAX}.`;
  const userMessage = `Caption: ${caption}\nCandidate keywords: ${candidateKeywords.join(', ')}`;

  let raw: string;
  try {
    raw = await openRouterText(system, userMessage);
  } catch {
    try {
      raw = await geminiText(system, userMessage);
    } catch {
      return null;
    }
  }

  try {
    const parsed = extractJsonObject(raw);
    return {
      title: trimText(typeof parsed.title === 'string' ? parsed.title.trim() : '', TITLE_MAX),
      description: typeof parsed.description === 'string' ? parsed.description.trim() : '',
      keywords: normalizeKeywords(parsed.keywords),
    };
  } catch {
    return null;
  }
}

export async function generateMetadata(
  imageBytes: Buffer,
  mimeType: string,
  opts?: GenerateMetadataOptions,
): Promise<GeneratedMetadata> {
  // Video: no frame extraction — refine from the caller-supplied hint or signal manual entry.
  if (mediaTypeFromMime(mimeType) === 'video') {
    const hint = opts?.hint?.trim();
    if (!hint) {
      return { title: '', description: 'needs manual metadata', keywords: [] };
    }
    const refined = await refineText(hint, []);
    return refined ?? { title: trimText(hint, TITLE_MAX), description: hint, keywords: [] };
  }

  // Step 1 — vision (no fallback provider; DeepSeek cannot do vision).
  let vision: { caption: string; keywords: string[] };
  try {
    vision = await geminiVision(imageBytes, mimeType);
  } catch (error) {
    throw new MetadataError('vision step failed (no vision fallback available)', { cause: error });
  }

  const caption = opts?.hint ? `${vision.caption} ${opts.hint}`.trim() : vision.caption;

  // Step 2 — text refinement; on failure fall back to raw Gemini output.
  const refined = await refineText(caption, vision.keywords);
  if (refined) return refined;

  return {
    title: trimText(vision.caption, TITLE_MAX),
    description: vision.caption,
    keywords: vision.keywords,
  };
}
