import { useState, useCallback, type DragEvent, type ChangeEvent } from 'react';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  maxSizeMB?: number;
}

export function FileUploader({
  onFileSelect,
  disabled = false,
  maxSizeMB = 50,
}: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        onFileSelect(file);
      }
    },
    [validateFile, onFileSelect]
  );

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
          <div className="text-5xl mb-4">📁</div>
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
