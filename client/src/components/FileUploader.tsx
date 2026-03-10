import { useState, useCallback, useMemo, useEffect, type DragEvent, type ChangeEvent } from 'react';
import {
  CloudUpload,
  FileText,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  FileCode,
  File as FileIcon,
  CheckCircle2,
  X,
} from 'lucide-react';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  maxSizeMB?: number;
}

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return <FileImage className="w-6 h-6 text-purple-400" />;
  if (type.startsWith('video/')) return <FileVideo className="w-6 h-6 text-blue-400" />;
  if (type.startsWith('audio/')) return <FileAudio className="w-6 h-6 text-pink-400" />;
  if (type === 'application/pdf') return <FileText className="w-6 h-6 text-red-400" />;
  if (type.includes('zip') || type.includes('tar') || type.includes('rar') || type.includes('7z'))
    return <FileArchive className="w-6 h-6 text-yellow-400" />;
  if (
    type.includes('json') ||
    type.includes('xml') ||
    type.includes('javascript') ||
    type.includes('html')
  )
    return <FileCode className="w-6 h-6 text-green-400" />;
  return <FileIcon className="w-6 h-6 text-slate-400" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileUploader({
  onFileSelect,
  disabled = false,
  maxSizeMB = 50,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Generate image preview URL (memoized, cleaned up via effect)
  const preview = useMemo(() => {
    if (!selectedFile || !selectedFile.type.startsWith('image/')) return null;
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const validateFile = useCallback(
    (file: File): boolean => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size > maxBytes) {
        setError(`File too large. Max size: ${maxSizeMB}MB`);
        return false;
      }
      setError(null);
      return true;
    },
    [maxSizeMB]
  );

  const handleFile = useCallback(
    (file: File) => {
      if (validateFile(file)) {
        setSelectedFile(file);
        onFileSelect(file);
      }
    },
    [validateFile, onFileSelect]
  );

  const clearFile = () => {
    setSelectedFile(null);
    setError(null);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  };

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  };

  // File selected — show rich preview
  if (selectedFile && !disabled) {
    const fileType = selectedFile.type || 'application/octet-stream';
    return (
      <div className="w-full">
        <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-5 relative group">
          <button
            onClick={clearFile}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-slate-700/50 hover:bg-slate-600 text-slate-400 hover:text-white transition-colors opacity-0 group-hover:opacity-100"
            title="Remove file"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-4">
            {/* Thumbnail or icon */}
            {preview ? (
              <div className="w-16 h-16 rounded-xl overflow-hidden border border-slate-600 shrink-0">
                <img src={preview} alt="Preview" className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-xl bg-slate-900/50 border border-slate-600 flex items-center justify-center shrink-0">
                {getFileIcon(fileType)}
              </div>
            )}

            {/* File info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <p className="text-white font-medium truncate">{selectedFile.name}</p>
              </div>
              <p className="text-slate-400 text-sm">
                {formatSize(selectedFile.size)} • {fileType.split('/')[1]?.toUpperCase() || 'FILE'}
              </p>
            </div>
          </div>
        </div>
        {error && <p className="mt-3 text-red-400 text-sm text-center">{error}</p>}
      </div>
    );
  }

  // Drop zone
  return (
    <div className="w-full">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`
          relative border-2 border-dashed rounded-2xl p-12
          transition-all duration-300 cursor-pointer
          ${
            isDragging
              ? 'border-orange-500 bg-orange-500/10'
              : 'border-slate-600 hover:border-orange-400 bg-slate-800/50'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        <input
          type="file"
          onChange={handleInputChange}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />

        <div className="text-center">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center">
            <CloudUpload
              className={`w-7 h-7 transition-colors ${isDragging ? 'text-orange-400' : 'text-orange-400/60'}`}
            />
          </div>
          <p className="text-lg text-slate-300 mb-2">
            {isDragging ? 'Drop your file here!' : 'Drag & drop a file here'}
          </p>
          <p className="text-sm text-slate-500">or click to browse • Max {maxSizeMB}MB</p>
        </div>
      </div>

      {error && <p className="mt-3 text-red-400 text-sm text-center">{error}</p>}
    </div>
  );
}
