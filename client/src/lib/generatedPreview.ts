export const GENERATED_PREVIEW_VERSION = 'stashu-generated-preview-v1' as const;

export const TEXT_LINE_LIMITS = [4, 10, 20, 50] as const;

export type TextLineLimit = (typeof TEXT_LINE_LIMITS)[number];
export type GeneratedPreviewKind = 'text-peek' | 'file-summary';
export type TextPeekMode = 'auto' | 'excerpt';

export interface TextPreviewOptions {
  mode: TextPeekMode;
  lineLimit: TextLineLimit;
  maxBytes: number;
  maxChars: number;
  maxPreviewRatio: number;
}

export type FileSummaryOptions = Record<string, never>;

export interface TextPreviewMetadata {
  offset: number;
  lineLimit: TextLineLimit;
  linesIncluded: number;
  bytesRead: number;
  previewBytes: number;
  truncated: boolean;
}

export interface FileSummaryMetadata {
  reason: 'unsupported-type' | 'decode-failed' | 'preview-disabled' | 'preview-would-reveal-file';
}

export interface GeneratedPreviewPayload {
  version: typeof GENERATED_PREVIEW_VERSION;
  kind: GeneratedPreviewKind;
  fileName: string;
  fileType: string;
  fileSize: number;
  contentType: string;
  options: TextPreviewOptions | FileSummaryOptions;
  metadata: TextPreviewMetadata | FileSummaryMetadata;
  bytes: string;
}

export interface PreviewSource {
  fileName: string;
  fileType?: string;
  fileSize: number;
  content: Uint8Array | ArrayBuffer;
}

export interface GeneratePreviewOptions {
  mode?: TextPeekMode | 'none';
  lineLimit?: TextLineLimit;
  maxBytes?: number;
  maxChars?: number;
  maxPreviewRatio?: number;
  excerpt?: {
    offset: number;
    text?: string;
    bytes?: Uint8Array | ArrayBuffer;
  };
}

interface NormalizedGeneratePreviewOptions {
  mode: TextPeekMode | 'none';
  lineLimit: TextLineLimit;
  maxBytes: number;
  maxChars: number;
  maxPreviewRatio: number;
  excerpt?: GeneratePreviewOptions['excerpt'];
}

const DEFAULT_FILE_TYPE = 'application/octet-stream';
export const DEFAULT_TEXT_LINE_LIMIT: TextLineLimit = 10;
export const DEFAULT_TEXT_MAX_BYTES = 16 * 1024;
export const DEFAULT_TEXT_MAX_CHARS = 2_000;
export const MAX_TEXT_PREVIEW_CHARS = 4_000;
export const DEFAULT_TEXT_PREVIEW_RATIO = 0.15;
export const MAX_TEXT_PREVIEW_RATIO = 0.5;

const textExtensions = new Set([
  'bash',
  'conf',
  'css',
  'csv',
  'env',
  'go',
  'html',
  'ini',
  'js',
  'json',
  'jsx',
  'log',
  'md',
  'markdown',
  'py',
  'rs',
  'sh',
  'toml',
  'ts',
  'tsx',
  'txt',
  'xml',
  'yaml',
  'yml',
]);

const textMimeTypes = new Set([
  'application/javascript',
  'application/json',
  'application/ld+json',
  'application/markdown',
  'application/toml',
  'application/typescript',
  'application/x-sh',
  'application/x-yaml',
  'application/xml',
  'application/yaml',
]);

const encoder = new TextEncoder();
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function normalizeFileType(fileType?: string): string {
  return fileType?.trim() || DEFAULT_FILE_TYPE;
}

function fileExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1 || lastDot === fileName.length - 1) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

function isTextLike(fileName: string, fileType: string): boolean {
  const normalizedType = fileType.toLowerCase().split(';')[0]?.trim() ?? '';
  return (
    normalizedType.startsWith('text/') ||
    textMimeTypes.has(normalizedType) ||
    textExtensions.has(fileExtension(fileName))
  );
}

function normalizeLineLimit(lineLimit?: TextLineLimit): TextLineLimit {
  if (lineLimit === undefined) return DEFAULT_TEXT_LINE_LIMIT;
  if (TEXT_LINE_LIMITS.includes(lineLimit)) return lineLimit;

  throw new Error(`lineLimit must be one of ${TEXT_LINE_LIMITS.join(', ')}`);
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function normalizePreviewRatio(value?: number): number {
  if (value === undefined) return DEFAULT_TEXT_PREVIEW_RATIO;
  if (!Number.isFinite(value) || value < 0 || value > MAX_TEXT_PREVIEW_RATIO) {
    throw new Error(`maxPreviewRatio must be between 0 and ${MAX_TEXT_PREVIEW_RATIO}`);
  }

  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const raw = atob(padded);
  const bytes = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i);
  }

  return bytes;
}

function decodeUtf8Prefix(
  bytes: Uint8Array,
  canTrimEnd: boolean
): { text: string; bytesRead: number } {
  try {
    return { text: utf8Decoder.decode(bytes), bytesRead: bytes.length };
  } catch (error) {
    if (!canTrimEnd) throw error;

    const maxTrim = Math.min(3, bytes.length);
    for (let trim = 1; trim <= maxTrim; trim += 1) {
      try {
        const trimmed = bytes.slice(0, bytes.length - trim);
        if (trimmed.length === 0 && bytes.length > 0) {
          throw error;
        }
        return { text: utf8Decoder.decode(trimmed), bytesRead: trimmed.length };
      } catch {
        // Keep trimming only enough bytes to remove a partial UTF-8 suffix.
      }
    }

    throw error;
  }
}

function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.split(/\r\n|\r|\n/).length;
}

function firstLinesPrefix(
  text: string,
  lineLimit: TextLineLimit
): {
  text: string;
  truncated: boolean;
} {
  let linesSeen = 1;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const isCrLf = char === '\r' && text[i + 1] === '\n';

    if (char === '\n' || char === '\r') {
      if (linesSeen >= lineLimit) {
        return {
          text: text.slice(0, i),
          truncated: i < text.length,
        };
      }

      linesSeen += 1;
      if (isCrLf) i += 1;
    }
  }

  return { text, truncated: false };
}

function sliceByCodePoints(text: string, maxChars: number): { text: string; truncated: boolean } {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return { text, truncated: false };

  return {
    text: chars.slice(0, maxChars).join(''),
    truncated: true,
  };
}

function trimTrailingPartialLine(text: string): { text: string; truncated: boolean } {
  if (text.length === 0 || text.endsWith('\n') || text.endsWith('\r')) {
    return { text, truncated: false };
  }

  const lineBreak = Math.max(text.lastIndexOf('\n'), text.lastIndexOf('\r'));
  if (lineBreak === -1) return { text, truncated: false };

  return {
    text: text.slice(0, lineBreak),
    truncated: true,
  };
}

function createFileSummary(
  source: Omit<PreviewSource, 'content'>,
  reason: FileSummaryMetadata['reason']
): GeneratedPreviewPayload {
  return {
    version: GENERATED_PREVIEW_VERSION,
    kind: 'file-summary',
    fileName: source.fileName,
    fileType: normalizeFileType(source.fileType),
    fileSize: source.fileSize,
    contentType: 'application/octet-stream',
    options: {},
    metadata: { reason },
    bytes: '',
  };
}

function createTextPreview(
  source: PreviewSource,
  options: NormalizedGeneratePreviewOptions
): GeneratedPreviewPayload {
  if (options.mode === 'none' || options.maxPreviewRatio === 0) {
    return createFileSummary(source, 'preview-disabled');
  }

  const content = toBytes(source.content);
  const ratioLimit = Math.floor(source.fileSize * options.maxPreviewRatio);
  if (ratioLimit < 1) {
    return createFileSummary(source, 'preview-would-reveal-file');
  }

  const requestedBytes = Math.min(content.length, options.maxBytes, ratioLimit);
  const previewBytes = content.slice(0, requestedBytes);
  const { text, bytesRead } = decodeUtf8Prefix(previewBytes, source.fileSize > requestedBytes);
  const readWasCut = source.fileSize > bytesRead;
  const lineLimited = firstLinesPrefix(text, options.lineLimit);
  const completeLineLimited =
    readWasCut && !lineLimited.truncated
      ? trimTrailingPartialLine(lineLimited.text)
      : { text: lineLimited.text, truncated: false };
  const charLimited = sliceByCodePoints(completeLineLimited.text, options.maxChars);
  const exactPreviewBytes = encoder.encode(charLimited.text);
  const truncated =
    readWasCut || lineLimited.truncated || completeLineLimited.truncated || charLimited.truncated;

  if (!truncated || exactPreviewBytes.length === 0) {
    return createFileSummary(source, 'preview-would-reveal-file');
  }

  return {
    version: GENERATED_PREVIEW_VERSION,
    kind: 'text-peek',
    fileName: source.fileName,
    fileType: normalizeFileType(source.fileType),
    fileSize: source.fileSize,
    contentType: 'text/plain; charset=utf-8',
    options: {
      mode: 'auto',
      lineLimit: options.lineLimit,
      maxBytes: options.maxBytes,
      maxChars: options.maxChars,
      maxPreviewRatio: options.maxPreviewRatio,
    },
    metadata: {
      offset: 0,
      lineLimit: options.lineLimit,
      linesIncluded: countLines(charLimited.text),
      bytesRead,
      previewBytes: exactPreviewBytes.length,
      truncated,
    },
    bytes: bytesToBase64Url(exactPreviewBytes),
  };
}

function createExcerptPreview(
  source: PreviewSource,
  options: NormalizedGeneratePreviewOptions
): GeneratedPreviewPayload {
  if (!options.excerpt) {
    throw new Error('Choose text or switch to Auto preview');
  }

  const content = toBytes(source.content);
  const excerptBytes = options.excerpt.bytes
    ? toBytes(options.excerpt.bytes)
    : encoder.encode(options.excerpt.text ?? '');

  if (
    !Number.isSafeInteger(options.excerpt.offset) ||
    options.excerpt.offset < 0 ||
    excerptBytes.length === 0 ||
    options.excerpt.offset + excerptBytes.length > source.fileSize
  ) {
    throw new Error('Peek excerpt is outside the file');
  }

  const ratioLimit = Math.floor(source.fileSize * options.maxPreviewRatio);
  if (
    excerptBytes.length > ratioLimit ||
    excerptBytes.length > options.maxBytes ||
    excerptBytes.length >= source.fileSize
  ) {
    throw new Error('Peek excerpt reveals too much of the file');
  }

  const fileBytesAtOffset = content.slice(
    options.excerpt.offset,
    options.excerpt.offset + excerptBytes.length
  );
  if (
    fileBytesAtOffset.length !== excerptBytes.length ||
    fileBytesAtOffset.some((value, index) => value !== excerptBytes[index])
  ) {
    throw new Error('Peek excerpt does not match the file bytes');
  }

  const text = decodeUtf8Prefix(excerptBytes, false).text;
  if (countLines(text) > options.lineLimit) {
    throw new Error('Peek excerpt has too many lines');
  }

  if (Array.from(text).length > options.maxChars) {
    throw new Error('Peek excerpt is too long');
  }

  return {
    version: GENERATED_PREVIEW_VERSION,
    kind: 'text-peek',
    fileName: source.fileName,
    fileType: normalizeFileType(source.fileType),
    fileSize: source.fileSize,
    contentType: 'text/plain; charset=utf-8',
    options: {
      mode: 'excerpt',
      lineLimit: options.lineLimit,
      maxBytes: options.maxBytes,
      maxChars: options.maxChars,
      maxPreviewRatio: options.maxPreviewRatio,
    },
    metadata: {
      offset: options.excerpt.offset,
      lineLimit: options.lineLimit,
      linesIncluded: countLines(text),
      bytesRead: excerptBytes.length,
      previewBytes: excerptBytes.length,
      truncated: true,
    },
    bytes: bytesToBase64Url(excerptBytes),
  };
}

function normalizeOptions(options: GeneratePreviewOptions): NormalizedGeneratePreviewOptions {
  return {
    mode: options.mode ?? 'none',
    lineLimit: normalizeLineLimit(options.lineLimit),
    maxBytes: normalizePositiveInteger(options.maxBytes, DEFAULT_TEXT_MAX_BYTES, 'maxBytes'),
    maxChars: normalizePositiveInteger(options.maxChars, DEFAULT_TEXT_MAX_CHARS, 'maxChars'),
    maxPreviewRatio: normalizePreviewRatio(options.maxPreviewRatio),
    excerpt: options.excerpt,
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  const record = value as Record<string, unknown>;
  const properties = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

  return `{${properties.join(',')}}`;
}

export function serializeGeneratedPreviewPayload(payload: GeneratedPreviewPayload): Uint8Array {
  return encoder.encode(stableStringify(payload));
}

export function decodeGeneratedPreviewBytes(payload: GeneratedPreviewPayload): Uint8Array {
  return base64UrlToBytes(payload.bytes);
}

export function generatePreviewFromBytes(
  source: PreviewSource,
  options: GeneratePreviewOptions = {}
): GeneratedPreviewPayload {
  const fileType = normalizeFileType(source.fileType);
  const normalizedOptions = normalizeOptions(options);

  if (normalizedOptions.mode === 'none' || normalizedOptions.maxPreviewRatio === 0) {
    return createFileSummary({ ...source, fileType }, 'preview-disabled');
  }

  if (!isTextLike(source.fileName, fileType)) {
    return createFileSummary(source, 'unsupported-type');
  }

  try {
    if (normalizedOptions.mode === 'excerpt') {
      return createExcerptPreview(
        {
          ...source,
          fileType,
        },
        normalizedOptions
      );
    }

    return createTextPreview(
      {
        ...source,
        fileType,
      },
      normalizedOptions
    );
  } catch (error) {
    if (error instanceof TypeError) {
      return createFileSummary({ ...source, fileType }, 'decode-failed');
    }
    throw error;
  }
}

export async function generatePreviewFromFile(
  file: File,
  options: GeneratePreviewOptions = {}
): Promise<GeneratedPreviewPayload> {
  const fileType = normalizeFileType(file.type);
  const normalizedOptions = normalizeOptions(options);

  if (normalizedOptions.mode === 'none' || normalizedOptions.maxPreviewRatio === 0) {
    return createFileSummary(
      {
        fileName: file.name,
        fileType,
        fileSize: file.size,
      },
      'preview-disabled'
    );
  }

  if (!isTextLike(file.name, fileType)) {
    return createFileSummary(
      {
        fileName: file.name,
        fileType,
        fileSize: file.size,
      },
      'unsupported-type'
    );
  }

  const bytesToRead =
    normalizedOptions.mode === 'excerpt'
      ? file.size
      : Math.min(file.size, normalizedOptions.maxBytes);
  const content = await file.slice(0, bytesToRead).arrayBuffer();

  return generatePreviewFromBytes(
    {
      fileName: file.name,
      fileType,
      fileSize: file.size,
      content,
    },
    normalizedOptions
  );
}
