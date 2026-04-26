export const GENERATED_PREVIEW_VERSION = 'stashu-generated-preview-v1' as const;

export const TEXT_LINE_LIMITS = [10, 20, 50] as const;

export type TextLineLimit = (typeof TEXT_LINE_LIMITS)[number];
export type GeneratedPreviewKind = 'text-head' | 'file-summary';

export interface TextPreviewOptions {
  lineLimit: TextLineLimit;
  maxBytes: number;
  maxChars: number;
}

export type FileSummaryOptions = Record<string, never>;

export interface TextPreviewMetadata {
  lineLimit: TextLineLimit;
  linesIncluded: number;
  bytesRead: number;
  truncated: boolean;
}

export interface FileSummaryMetadata {
  reason: 'unsupported-type' | 'decode-failed';
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
  lineLimit?: TextLineLimit;
  maxBytes?: number;
  maxChars?: number;
}

const DEFAULT_FILE_TYPE = 'application/octet-stream';
const DEFAULT_TEXT_LINE_LIMIT: TextLineLimit = 20;
const DEFAULT_TEXT_MAX_BYTES = 64 * 1024;
const DEFAULT_TEXT_MAX_CHARS = 8_000;

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

function bytesToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
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
        return { text: utf8Decoder.decode(trimmed), bytesRead: trimmed.length };
      } catch {
        // Keep trimming only enough bytes to remove a partial UTF-8 suffix.
      }
    }

    throw error;
  }
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
  options: Required<GeneratePreviewOptions>
): GeneratedPreviewPayload {
  const content = toBytes(source.content);
  const requestedBytes = Math.min(content.length, options.maxBytes);
  const previewBytes = content.slice(0, requestedBytes);
  const { text, bytesRead } = decodeUtf8Prefix(previewBytes, source.fileSize > requestedBytes);
  const decoded = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  const lines = decoded.split('\n');
  const includedLines = lines.slice(0, options.lineLimit);

  let previewText = includedLines.join('\n');
  let truncated =
    source.fileSize > bytesRead ||
    lines.length > options.lineLimit ||
    decoded.length > previewText.length;

  if (previewText.length > options.maxChars) {
    previewText = previewText.slice(0, options.maxChars);
    truncated = true;
  }

  return {
    version: GENERATED_PREVIEW_VERSION,
    kind: 'text-head',
    fileName: source.fileName,
    fileType: normalizeFileType(source.fileType),
    fileSize: source.fileSize,
    contentType: 'text/plain; charset=utf-8',
    options: {
      lineLimit: options.lineLimit,
      maxBytes: options.maxBytes,
      maxChars: options.maxChars,
    },
    metadata: {
      lineLimit: options.lineLimit,
      linesIncluded: previewText.length === 0 ? 0 : previewText.split('\n').length,
      bytesRead,
      truncated,
    },
    bytes: bytesToBase64Url(encoder.encode(previewText)),
  };
}

function normalizeOptions(options: GeneratePreviewOptions): Required<GeneratePreviewOptions> {
  return {
    lineLimit: normalizeLineLimit(options.lineLimit),
    maxBytes: normalizePositiveInteger(options.maxBytes, DEFAULT_TEXT_MAX_BYTES, 'maxBytes'),
    maxChars: normalizePositiveInteger(options.maxChars, DEFAULT_TEXT_MAX_CHARS, 'maxChars'),
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

export function generatePreviewFromBytes(
  source: PreviewSource,
  options: GeneratePreviewOptions = {}
): GeneratedPreviewPayload {
  const fileType = normalizeFileType(source.fileType);

  if (!isTextLike(source.fileName, fileType)) {
    return createFileSummary(source, 'unsupported-type');
  }

  try {
    return createTextPreview(
      {
        ...source,
        fileType,
      },
      normalizeOptions(options)
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

  const normalizedOptions = normalizeOptions(options);
  const bytesToRead = Math.min(file.size, normalizedOptions.maxBytes);
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
