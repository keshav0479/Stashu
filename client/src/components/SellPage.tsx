import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import { Link } from 'react-router-dom';
import { FileText, PartyPopper, ShieldCheck, SlidersHorizontal, Squirrel } from 'lucide-react';
import { FileUploader } from './FileUploader';
import { RecoveryTokenModal } from './RecoveryTokenModal';
import { useToast } from './useToast';
import { useStash } from '../lib/useStash';
import { hasAcknowledgedRecovery, getOrCreateIdentity } from '../lib/identity';
import { copyToClipboard } from '../lib/clipboard';
import {
  DEFAULT_TEXT_LINE_LIMIT,
  DEFAULT_TEXT_MAX_BYTES,
  DEFAULT_TEXT_MAX_CHARS,
  DEFAULT_TEXT_PREVIEW_RATIO,
  MAX_TEXT_PREVIEW_CHARS,
  generatePreviewFromBytes,
  generatePreviewFromFile,
  isTextPreviewSupported,
  type GeneratedPreviewPayload,
  type TextLineLimit,
} from '../lib/generatedPreview';
import { decodeTextPreview } from '../lib/verifiedPreview';
import type { TextPreviewMetadata } from '../../../shared/types';

type PeekMode = 'none' | 'auto' | 'excerpt';
type PreviewPresetId = 'shorter' | 'standard' | 'larger';
type QuickExcerptPosition = 'start' | 'middle' | 'end';

interface PreviewPreset {
  label: string;
  body: string;
  lineLimit: TextLineLimit;
  maxChars: number;
  maxPreviewRatio: number;
}

const MAX_EXCERPT_EDITOR_BYTES = 1024 * 1024;
const QUICK_PEEK_MAX_BYTES = 4 * 1024;
const LARGE_REVEAL_PERCENT = 15;
const LARGE_REVEAL_BYTES = 4 * 1024;
const textEncoder = new TextEncoder();

const PREVIEW_PRESETS: Record<PreviewPresetId, PreviewPreset> = {
  shorter: {
    label: 'Shorter',
    body: 'Best for sensitive files.',
    lineLimit: 4,
    maxChars: 800,
    maxPreviewRatio: 0.05,
  },
  standard: {
    label: 'Standard',
    body: 'Good default for prompts, notes, and docs.',
    lineLimit: DEFAULT_TEXT_LINE_LIMIT,
    maxChars: DEFAULT_TEXT_MAX_CHARS,
    maxPreviewRatio: DEFAULT_TEXT_PREVIEW_RATIO,
  },
  larger: {
    label: 'Larger',
    body: 'Shows more before payment.',
    lineLimit: 20,
    maxChars: MAX_TEXT_PREVIEW_CHARS,
    maxPreviewRatio: 0.3,
  },
};

function utf8ByteLength(value: string): number {
  return textEncoder.encode(value).length;
}

function lineStartBefore(text: string, index: number): number {
  const newline = text.lastIndexOf('\n', Math.max(0, index - 1));
  return newline === -1 ? 0 : newline + 1;
}

function lineStartBeforeLastLines(text: string, lineCount: number): number {
  let index = text.length;
  for (let i = 0; i < lineCount; i += 1) {
    const newline = text.lastIndexOf('\n', Math.max(0, index - 2));
    if (newline === -1) return 0;
    index = newline + 1;
  }
  return index;
}

function lineEndAfter(text: string, start: number, lineCount: number): number {
  let end = start;
  for (let i = 0; i < lineCount; i += 1) {
    const newline = text.indexOf('\n', end);
    if (newline === -1) return text.length;

    if (i === lineCount - 1) {
      return text[newline - 1] === '\r' ? newline - 1 : newline;
    }

    end = newline + 1;
  }
  return end;
}

function limitTextByBytes(text: string, maxBytes: number): string {
  let bytes = 0;
  let output = '';

  for (const char of text) {
    const nextBytes = utf8ByteLength(char);
    if (bytes + nextBytes > maxBytes) break;
    bytes += nextBytes;
    output += char;
  }

  return output;
}

function limitTextByChars(text: string, maxChars: number): string {
  return Array.from(text).slice(0, maxChars).join('');
}

function buildQuickExcerpt(
  fileText: string,
  fileSize: number,
  position: QuickExcerptPosition,
  preset: PreviewPreset
): { offset: number; text: string } | null {
  const budget = Math.max(
    1,
    Math.min(QUICK_PEEK_MAX_BYTES, Math.floor(fileSize * preset.maxPreviewRatio))
  );
  const start =
    position === 'start'
      ? 0
      : position === 'middle'
        ? lineStartBefore(fileText, Math.floor(fileText.length / 2))
        : lineStartBeforeLastLines(fileText, preset.lineLimit);
  const end = lineEndAfter(fileText, start, preset.lineLimit);
  const text = limitTextByBytes(
    limitTextByChars(fileText.slice(start, end), preset.maxChars),
    budget
  );

  if (!text.trim()) return null;

  return {
    offset: utf8ByteLength(fileText.slice(0, start)),
    text,
  };
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round((bytes / 1024) * 10) / 10} KB`;
}

function compactCount(value: number): string {
  if (value < 10_000) return value.toLocaleString();
  return Intl.NumberFormat(undefined, {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function textStats(text: string): { bytes: number; chars: number; lines: number } {
  return {
    bytes: utf8ByteLength(text),
    chars: Array.from(text).length,
    lines: text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length,
  };
}

function getExcerptStats(
  excerpt: { text: string },
  fileSize: number,
  preset: PreviewPreset
): {
  bytes: number;
  chars: number;
  lines: number;
  percent: number;
  byteLimit: number;
  tooLarge: boolean;
} {
  const { bytes, chars, lines } = textStats(excerpt.text);
  const percent = fileSize > 0 ? Math.round((bytes / fileSize) * 1000) / 10 : 0;
  const byteLimit = Math.min(DEFAULT_TEXT_MAX_BYTES, Math.floor(fileSize * preset.maxPreviewRatio));
  const tooLarge =
    bytes > byteLimit || chars > preset.maxChars || lines > preset.lineLimit || bytes >= fileSize;

  return {
    bytes,
    chars,
    lines,
    percent,
    byteLimit,
    tooLarge,
  };
}

// Pre-computed confetti styles (module-level, generated once)
const CONFETTI_STYLES = Array.from({ length: 40 }, (_, i) => ({
  left: `${Math.random() * 100}%`,
  backgroundColor: ['#f97316', '#6366f1', '#22c55e', '#eab308', '#ec4899', '#06b6d4'][i % 6],
  animationDelay: `${Math.random() * 1.5}s`,
  animationDuration: `${2 + Math.random() * 2}s`,
  width: `${6 + Math.random() * 8}px`,
  height: `${6 + Math.random() * 8}px`,
}));

export function SellPage() {
  const stash = useStash();
  const toast = useToast();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [peekMode, setPeekMode] = useState<PeekMode>('none');
  const [previewPreset, setPreviewPreset] = useState<PreviewPresetId>('standard');
  const [showPreviewControls, setShowPreviewControls] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<GeneratedPreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [quickExcerptPosition, setQuickExcerptPosition] = useState<QuickExcerptPosition | null>(
    null
  );
  const [selectedExcerpt, setSelectedExcerpt] = useState<{ offset: number; text: string } | null>(
    null
  );
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [showRecoveryModal, setShowRecoveryModal] = useState(() => {
    getOrCreateIdentity();
    return !hasAcknowledgedRecovery();
  });

  const resetPreviewState = () => {
    setGeneratedPreview(null);
    setPreviewError(null);
    setFileText(null);
    setQuickExcerptPosition(null);
    setSelectedExcerpt(null);
    setPeekMode('none');
    setPreviewPreset('standard');
    setShowPreviewControls(false);
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    resetPreviewState();
  };

  const handleFileClear = () => {
    setSelectedFile(null);
    resetPreviewState();
  };

  const activePreviewPreset = PREVIEW_PRESETS[previewPreset];
  const textPreviewSupported = useMemo(
    () => (selectedFile ? isTextPreviewSupported(selectedFile.name, selectedFile.type) : false),
    [selectedFile]
  );

  useEffect(() => {
    if (!selectedFile) return;

    let cancelled = false;

    if (peekMode === 'excerpt') {
      if (selectedFile.size > MAX_EXCERPT_EDITOR_BYTES) {
        queueMicrotask(() => {
          if (cancelled) return;
          setGeneratedPreview(null);
          setFileText(null);
          setPreviewError('Choose text is available for files up to 1 MB');
        });
        return () => {
          cancelled = true;
        };
      }

      selectedFile
        .text()
        .then((text) => {
          if (cancelled) return;
          setFileText(text);
          setPreviewError(null);
        })
        .catch((error) => {
          if (cancelled) return;
          setFileText(null);
          setPreviewError(error instanceof Error ? error.message : 'Could not read file text');
        });

      return () => {
        cancelled = true;
      };
    }

    generatePreviewFromFile(selectedFile, {
      mode: peekMode,
      lineLimit: activePreviewPreset.lineLimit,
      maxChars: activePreviewPreset.maxChars,
      maxPreviewRatio: activePreviewPreset.maxPreviewRatio,
    })
      .then((preview) => {
        if (cancelled) return;
        setGeneratedPreview(preview);
        setPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setGeneratedPreview(null);
        setPreviewError(error instanceof Error ? error.message : 'Could not generate preview');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile, activePreviewPreset, peekMode]);

  const quickExcerpt = useMemo(() => {
    if (peekMode !== 'excerpt' || !quickExcerptPosition || !fileText || !selectedFile) return null;

    return buildQuickExcerpt(
      fileText,
      selectedFile.size,
      quickExcerptPosition,
      activePreviewPreset
    );
  }, [peekMode, quickExcerptPosition, fileText, selectedFile, activePreviewPreset]);

  const selectedExcerptStats = useMemo(() => {
    if (!selectedExcerpt || !selectedFile) return null;

    return getExcerptStats(selectedExcerpt, selectedFile.size, activePreviewPreset);
  }, [selectedExcerpt, selectedFile, activePreviewPreset]);

  const manualPeekTooLarge = Boolean(
    !quickExcerptPosition && selectedExcerpt && selectedExcerptStats?.tooLarge
  );
  const selectedExcerptTooLargeMessage =
    previewPreset === 'larger'
      ? "This selection is beyond Stashu's max public preview. Pick less text. The public preview stayed unchanged."
      : 'This selection reveals too much for the current setting. Pick less text or choose a larger setting in More control. The public preview stayed unchanged.';
  const activePeekExcerpt = quickExcerptPosition
    ? quickExcerpt
    : manualPeekTooLarge
      ? null
      : selectedExcerpt;

  useEffect(() => {
    if (!selectedFile || peekMode !== 'excerpt' || !activePeekExcerpt) {
      return;
    }

    let cancelled = false;

    selectedFile
      .arrayBuffer()
      .then((content) => {
        if (cancelled) return;
        const preview = generatePreviewFromBytes(
          {
            fileName: selectedFile.name,
            fileType: selectedFile.type,
            fileSize: selectedFile.size,
            content,
          },
          {
            mode: 'excerpt',
            lineLimit: activePreviewPreset.lineLimit,
            maxChars: activePreviewPreset.maxChars,
            maxPreviewRatio: activePreviewPreset.maxPreviewRatio,
            excerpt: activePeekExcerpt,
          }
        );
        setGeneratedPreview(preview);
        setPreviewError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setGeneratedPreview(null);
        setPreviewError(error instanceof Error ? error.message : 'Could not generate peek');
      });

    return () => {
      cancelled = true;
    };
  }, [selectedFile, peekMode, activePeekExcerpt, activePreviewPreset]);

  const previewText = useMemo(
    () => (generatedPreview ? decodeTextPreview(generatedPreview) : undefined),
    [generatedPreview]
  );

  const previewStats = useMemo(() => {
    if (!generatedPreview || generatedPreview.kind !== 'text-peek') return null;

    const metadata = generatedPreview.metadata as TextPreviewMetadata;
    const chars = previewText ? Array.from(previewText).length : 0;
    const percent =
      generatedPreview.fileSize > 0
        ? Math.round((metadata.previewBytes / generatedPreview.fileSize) * 1000) / 10
        : 0;

    return {
      bytes: metadata.previewBytes,
      chars,
      lines: metadata.linesIncluded,
      percent,
    };
  }, [generatedPreview, previewText]);

  const liveExcerptPreviewText =
    peekMode === 'excerpt' && activePeekExcerpt ? activePeekExcerpt.text : undefined;
  const liveExcerptPreviewStats = useMemo(() => {
    if (!liveExcerptPreviewText || !selectedFile) return null;

    const stats = textStats(liveExcerptPreviewText);

    return {
      bytes: stats.bytes,
      chars: stats.chars,
      lines: stats.lines,
      percent:
        selectedFile.size > 0 ? Math.round((stats.bytes / selectedFile.size) * 1000) / 10 : 0,
    };
  }, [liveExcerptPreviewText, selectedFile]);
  const displayPreviewText = manualPeekTooLarge
    ? previewText
    : (liveExcerptPreviewText ?? previewText);
  const displayPreviewStats = manualPeekTooLarge
    ? previewStats
    : (liveExcerptPreviewStats ?? previewStats);
  const largeReveal =
    displayPreviewStats &&
    (displayPreviewStats.percent >= LARGE_REVEAL_PERCENT ||
      displayPreviewStats.bytes > LARGE_REVEAL_BYTES);
  const previewCardTitle = manualPeekTooLarge
    ? 'Previous public preview'
    : peekMode === 'auto'
      ? 'Quick preview'
      : 'Public preview';
  const previewCardHint = manualPeekTooLarge
    ? 'Your latest selection was too large, so Stashu kept the last valid preview.'
    : peekMode === 'auto'
      ? 'For text files, Stashu uses the start of the file. Use the Choose text option for a different sample.'
      : quickExcerptPosition
        ? `This sample uses the ${quickExcerptPosition} of the file. Select text for exact control.`
        : 'This exact text will be public before payment.';
  const fileSummaryReason =
    generatedPreview?.kind === 'file-summary'
      ? (generatedPreview.metadata as { reason?: string }).reason
      : null;
  const fileSummaryText =
    fileSummaryReason === 'unsupported-type'
      ? {
          title: 'No text preview for this file.',
          body: 'The file will still get a commitment check after unlock.',
        }
      : fileSummaryReason === 'decode-failed'
        ? {
            title: 'Could not read this as text.',
            body: 'The file will still get a commitment check after unlock.',
          }
        : fileSummaryReason === 'preview-would-reveal-file'
          ? {
              title: 'Preview skipped for this file.',
              body: 'Showing a sample would reveal too much of the file.',
            }
          : null;

  const peekModeInfo = useMemo(() => {
    if (peekMode === 'auto') {
      return {
        title: 'Uses the start of the file',
        body: 'Quick option for text files. Use Choose text if the start gives away too much.',
        tone: 'public',
      };
    }

    if (peekMode === 'excerpt') {
      return {
        title: 'You choose the text',
        body: 'Only the chosen text becomes public. Stashu proves it is inside the file.',
        tone: 'public',
      };
    }

    return {
      title: 'Most private',
      body: 'Nothing from the file is shown before payment.',
      tone: 'private',
    };
  }, [peekMode]);

  const commitExcerptSelection = (input: HTMLTextAreaElement) => {
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;

    // Clicking controls can collapse the browser selection. Keep the last
    // valid public preview instead of clearing it.
    if (!fileText || end <= start) return;

    const excerpt = {
      offset: utf8ByteLength(fileText.slice(0, start)),
      text: fileText.slice(start, end),
    };
    const stats = selectedFile
      ? getExcerptStats(excerpt, selectedFile.size, activePreviewPreset)
      : null;

    setSelectedExcerpt(excerpt);
    setQuickExcerptPosition(null);

    if (stats?.tooLarge) {
      setPreviewError(null);
      return;
    }

    setGeneratedPreview(null);
    setPreviewError(null);
  };

  const handleExcerptSelectionCommit = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    commitExcerptSelection(event.currentTarget);
  };

  const applyQuickExcerpt = (position: QuickExcerptPosition) => {
    if (!fileText || !selectedFile) return;

    const excerpt = buildQuickExcerpt(fileText, selectedFile.size, position, activePreviewPreset);

    if (!excerpt) {
      setPreviewError('Could not find text for that quick peek');
      return;
    }

    setSelectedExcerpt(null);
    setQuickExcerptPosition(position);
    setGeneratedPreview(null);
    setPreviewError(null);
  };

  const handleSubmit = async () => {
    if (!selectedFile || !title || !price) return;

    const priceSats = parseInt(price, 10);
    if (isNaN(priceSats) || priceSats <= 0) {
      setPriceError('Please enter a valid price (must be greater than 0)');
      return;
    }
    setPriceError(null);

    if (manualPeekTooLarge) {
      setPreviewError('Pick less text or choose Larger before publishing');
      return;
    }

    if (peekMode === 'excerpt' && !activePeekExcerpt) {
      setPreviewError('Choose text or switch to Auto preview');
      return;
    }

    await stash.createStash(selectedFile, {
      title,
      description: description || undefined,
      priceSats,
      peekMode,
      previewLineLimit: activePreviewPreset.lineLimit,
      previewMaxChars: activePreviewPreset.maxChars,
      previewRatio: activePreviewPreset.maxPreviewRatio,
      peekExcerpt: activePeekExcerpt || undefined,
    });
  };

  if (showRecoveryModal) {
    return <RecoveryTokenModal onComplete={() => setShowRecoveryModal(false)} />;
  }

  // Success state
  if (stash.status === 'done' && stash.shareUrl) {
    return (
      <>
        <div className="confetti-container">
          {CONFETTI_STYLES.map((style, i) => (
            <div key={i} className="confetti-piece" style={style} />
          ))}
        </div>

        <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
          <div className="max-w-lg w-full text-center animate-scale-in">
            <div className="w-20 h-20 mx-auto mb-6 bg-amber-500/20 rounded-2xl flex items-center justify-center">
              <PartyPopper className="w-10 h-10 text-amber-400" />
            </div>
            <h1 className="text-3xl font-bold text-white mb-4">Stash Created!</h1>
            <p className="text-slate-400 mb-8">Share this link with buyers:</p>

            <div className="bg-slate-800 rounded-xl p-4 mb-6">
              <code className="text-orange-400 break-all">{stash.shareUrl}</code>
            </div>

            <button
              onClick={async () => {
                const success = await copyToClipboard(stash.shareUrl!);
                if (success) {
                  toast.showToast('Link copied!', 'success');
                } else {
                  toast.showToast('Failed to copy link', 'error');
                }
              }}
              className="btn-primary px-6 py-3"
            >
              Copy Link
            </button>

            <Link
              to="/dashboard"
              className="block w-full mt-6 py-3 px-6 bg-slate-800 border border-slate-600 
                       text-white font-semibold rounded-xl hover:bg-slate-700 transition-colors text-center"
            >
              Go to Dashboard
            </Link>

            <button
              onClick={() => stash.reset()}
              className="block w-full mt-3 py-3 px-6 text-slate-400 
                       hover:text-slate-200 transition-colors text-sm"
            >
              Create Another Stash
            </button>
          </div>
        </div>
      </>
    );
  }

  // Main upload form
  return (
    <div className="min-h-screen bg-slate-900 py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <Link
          to={hasAcknowledgedRecovery() ? '/dashboard' : '/'}
          className="text-slate-400 hover:text-white text-sm mb-2 inline-block transition-colors"
        >
          {hasAcknowledgedRecovery() ? '← Back to Dashboard' : '← Back to Home'}
        </Link>
        <h1 className="text-3xl font-bold text-white mb-2">Create a Stash</h1>
        <p className="text-slate-400 mb-8">
          Upload a file, set your price, and get a shareable link
        </p>

        {/* File Upload */}
        <div className="mb-8">
          <FileUploader
            onFileSelect={handleFileSelect}
            onFileClear={handleFileClear}
            disabled={stash.status !== 'idle'}
          />
        </div>

        {selectedFile && (
          <div className="soft-appear mb-8 bg-slate-800/50 border border-slate-700 rounded-2xl p-5">
            <div className="mb-4">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h2 className="text-white font-semibold">Preview for buyers</h2>
              </div>
              <p className="mt-1 text-sm text-slate-400">
                {textPreviewSupported
                  ? 'Choose whether buyers can see a verified sample before paying.'
                  : 'Text previews are not available for this file type yet.'}
              </p>
            </div>

            {!textPreviewSupported ? (
              <div className="soft-appear flex items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                <FileText className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                <div>
                  <p className="text-sm text-slate-300">No public preview will be shown.</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Stashu will verify the unlocked file after payment.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 grid gap-2 sm:grid-cols-3">
                  {[
                    {
                      label: 'No preview',
                      body: 'Most private',
                      value: 'none' as const,
                    },
                    {
                      label: 'Quick preview',
                      body: 'Start of file',
                      value: 'auto' as const,
                    },
                    {
                      label: 'Choose text',
                      body: 'You pick it',
                      value: 'excerpt' as const,
                    },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        if (option.value === peekMode) return;

                        setPeekMode(option.value);
                        setGeneratedPreview(null);
                        setPreviewError(null);
                        if (option.value !== 'excerpt') {
                          setFileText(null);
                          setQuickExcerptPosition(null);
                          setSelectedExcerpt(null);
                        }
                      }}
                      className={`rounded-xl border px-3 py-3 text-left transition-colors ${
                        peekMode === option.value
                          ? 'border-orange-500 bg-orange-500/10 text-white'
                          : 'border-slate-700 bg-slate-900/40 text-slate-400 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="mt-1 block text-xs opacity-75">{option.body}</span>
                    </button>
                  ))}
                </div>

                <div
                  className={`soft-surface mb-4 rounded-xl border p-3 ${
                    peekModeInfo.tone === 'public'
                      ? 'border-amber-500/30 bg-amber-500/10'
                      : 'border-slate-700 bg-slate-950/50'
                  }`}
                >
                  <p
                    className={`text-sm font-medium ${
                      peekModeInfo.tone === 'public' ? 'text-amber-200' : 'text-slate-200'
                    }`}
                  >
                    {peekModeInfo.title}
                  </p>
                  <p
                    className={`mt-1 text-xs ${
                      peekModeInfo.tone === 'public' ? 'text-amber-100/70' : 'text-slate-500'
                    }`}
                  >
                    {peekModeInfo.body}
                  </p>
                </div>

                <div>
                  {peekMode !== 'none' && (
                    <div className="mb-4">
                      <button
                        type="button"
                        onClick={() => setShowPreviewControls((value) => !value)}
                        className="inline-flex items-center gap-2 text-sm font-medium text-slate-400 transition-colors hover:text-white"
                      >
                        <SlidersHorizontal className="h-4 w-4" />
                        More control
                      </button>

                      {showPreviewControls && (
                        <div className="soft-appear mt-3 rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                          <div className="grid gap-2 sm:grid-cols-3">
                            {(Object.keys(PREVIEW_PRESETS) as PreviewPresetId[]).map((presetId) => {
                              const preset = PREVIEW_PRESETS[presetId];
                              return (
                                <button
                                  key={presetId}
                                  type="button"
                                  onClick={() => {
                                    if (presetId === previewPreset) return;

                                    setPreviewPreset(presetId);
                                    setPreviewError(null);
                                  }}
                                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                                    previewPreset === presetId
                                      ? 'border-orange-500 bg-orange-500/10 text-white'
                                      : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                                  }`}
                                >
                                  <span className="block text-sm font-semibold">
                                    {preset.label}
                                  </span>
                                  <span className="mt-1 block text-xs opacity-75">
                                    {preset.body}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                          <p className="mt-3 text-xs text-slate-500">
                            {activePreviewPreset.label}: up to {activePreviewPreset.lineLimit}{' '}
                            lines, {activePreviewPreset.maxChars.toLocaleString()} chars, or{' '}
                            {formatPercent(activePreviewPreset.maxPreviewRatio * 100)} of this file.
                            Safety cap: {formatBytes(DEFAULT_TEXT_MAX_BYTES)}.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {peekMode === 'excerpt' && fileText !== null && (
                    <div className="soft-appear">
                      <p className="mb-2 text-xs text-slate-500">
                        Pick a quick sample, or select text below. The public preview updates when
                        you finish selecting.
                      </p>
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Quick sample
                      </p>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {[
                          { label: 'Start', value: 'start' as const },
                          { label: 'Middle', value: 'middle' as const },
                          { label: 'End', value: 'end' as const },
                        ].map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => applyQuickExcerpt(option.value)}
                            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                              quickExcerptPosition === option.value
                                ? 'border-orange-500 bg-orange-500/10 text-white'
                                : 'border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={fileText}
                        onMouseUp={handleExcerptSelectionCommit}
                        onKeyUp={handleExcerptSelectionCommit}
                        onTouchEnd={handleExcerptSelectionCommit}
                        readOnly
                        rows={8}
                        className="mb-4 w-full resize-none rounded-xl border border-slate-700 bg-slate-950/70 p-4 text-sm text-slate-200 selection:bg-orange-500/30 selection:text-orange-50 focus:border-orange-500 focus:outline-none"
                        spellCheck={false}
                      />
                      {selectedExcerptStats?.tooLarge && (
                        <p className="soft-appear mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                          {selectedExcerptTooLargeMessage}
                        </p>
                      )}
                    </div>
                  )}

                  {previewError ? (
                    <p className="text-red-400 text-sm">{previewError}</p>
                  ) : displayPreviewText !== undefined ? (
                    <>
                      <div className="soft-appear rounded-lg border border-orange-500/25 bg-orange-500/10 p-3">
                        <div className="mb-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-orange-200/80">
                            {previewCardTitle}
                          </p>
                          <p className="mt-1 text-xs text-orange-50/60">{previewCardHint}</p>
                        </div>
                        <pre className="h-48 overflow-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-orange-50/90">
                          {displayPreviewText || 'Empty preview'}
                        </pre>
                      </div>
                      <div className="pt-3">
                        {displayPreviewStats ? (
                          <p className="grid grid-cols-[4rem_5.5rem_6rem] gap-2 text-xs text-slate-500">
                            <span className="tabular-nums">
                              {displayPreviewStats.lines} line
                              {displayPreviewStats.lines === 1 ? '' : 's'}
                            </span>
                            <span className="tabular-nums">
                              {compactCount(displayPreviewStats.chars)} chars
                            </span>
                            <span className="tabular-nums">
                              {formatPercent(displayPreviewStats.percent)} public
                            </span>
                          </p>
                        ) : null}
                        {largeReveal && (
                          <p className="soft-appear mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                            This is a larger public peek. Anyone with the stash link can read it
                            before paying.
                          </p>
                        )}
                      </div>
                    </>
                  ) : peekMode === 'auto' && fileSummaryText ? (
                    <div className="soft-appear flex items-start gap-3 rounded-xl bg-slate-950/50 p-4">
                      <FileText className="mt-0.5 w-5 h-5 shrink-0 text-slate-400" />
                      <div>
                        <p className="text-slate-300 text-sm">{fileSummaryText.title}</p>
                        <p className="text-slate-500 text-xs mt-1">{fileSummaryText.body}</p>
                      </div>
                    </div>
                  ) : peekMode === 'auto' ? null : peekMode === 'excerpt' ? (
                    <div className="soft-appear flex items-start gap-3 rounded-xl bg-slate-950/50 p-4">
                      <FileText className="mt-0.5 w-5 h-5 shrink-0 text-slate-400" />
                      <div>
                        <p className="text-slate-300 text-sm">Pick text to show buyers.</p>
                        <p className="text-slate-500 text-xs mt-1">
                          Use Start, Middle, End, or select text yourself.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="soft-appear flex items-start gap-3 rounded-xl bg-slate-950/50 p-4">
                      <FileText className="mt-0.5 w-5 h-5 shrink-0 text-slate-400" />
                      <div>
                        <p className="text-slate-300 text-sm">No public preview will be shown.</p>
                        <p className="text-slate-500 text-xs mt-1">
                          The file will still get a commitment check after unlock.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* Form Fields */}
        <div className="space-y-6 mb-8">
          <div>
            <label className="block text-slate-300 mb-2">Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My awesome file"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 
                       rounded-xl text-white placeholder-slate-500
                       focus:outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's in this file?"
              rows={3}
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 
                       rounded-xl text-white placeholder-slate-500
                       focus:outline-none focus:border-orange-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-2">Price (sats) *</label>
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="100"
              min="1"
              className="w-full px-4 py-3 bg-slate-800 border border-slate-600 
                       rounded-xl text-white placeholder-slate-500
                       focus:outline-none focus:border-orange-500"
            />
            {priceError && <p className="mt-2 text-red-400 text-sm">{priceError}</p>}
          </div>
        </div>

        {/* Progress Bar */}
        {stash.status !== 'idle' && stash.status !== 'error' && (
          <div className="mb-6">
            <div className="flex justify-between text-sm text-slate-400 mb-2">
              <span>{stash.status}</span>
              <span>{stash.progress}%</span>
            </div>
            <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-300"
                style={{ width: `${stash.progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Display */}
        {stash.error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
            <p className="text-red-400">{stash.error}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          onClick={handleSubmit}
          disabled={!selectedFile || !title || !price || stash.status !== 'idle'}
          className="btn-primary w-full px-6 py-4 text-lg"
        >
          {stash.status === 'idle' ? (
            <>
              <Squirrel className="w-5 h-5 inline-block mr-1" />
              Create Stash
            </>
          ) : (
            'Processing...'
          )}
        </button>
      </div>
    </div>
  );
}
