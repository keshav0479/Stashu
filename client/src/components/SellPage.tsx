import { useState } from 'react';
import { FileUploader } from './FileUploader';
import { useStash } from '../lib/useStash';

interface FileInfo {
  name: string;
  size: number;
  type: string;
}

export function SellPage() {
  const stash = useStash();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setFileInfo({
      name: file.name,
      size: file.size,
      type: file.type || 'application/octet-stream',
    });
  };

  const handleSubmit = async () => {
    if (!selectedFile || !title || !price) return;

    const priceSats = parseInt(price, 10);
    if (isNaN(priceSats) || priceSats <= 0) {
      setPriceError('Please enter a valid price (must be greater than 0)');
      return;
    }
    setPriceError(null);

    await stash.createStash(selectedFile, {
      title,
      description: description || undefined,
      priceSats,
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Not connected state
  if (!stash.isConnected) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-3xl font-bold text-white mb-4">Connect Wallet</h1>
          <p className="text-slate-400 mb-8">Connect your Nostr wallet to start selling files</p>

          {!stash.hasExtension ? (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 mb-6">
              <p className="text-red-400">
                No Nostr extension found. Install{' '}
                <a href="https://getalby.com" className="underline">
                  Alby
                </a>{' '}
                or{' '}
                <a href="https://github.com/nickmattis/nos2x" className="underline">
                  nos2x
                </a>
              </p>
            </div>
          ) : (
            <button
              onClick={() => stash.connect()}
              disabled={stash.status === 'connecting'}
              className="w-full py-4 px-6 bg-orange-500 hover:bg-orange-600 
                       text-white font-semibold rounded-xl transition-colors
                       disabled:opacity-50"
            >
              {stash.status === 'connecting' ? 'Connecting...' : 'Connect Wallet'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Success state
  if (stash.status === 'done' && stash.shareUrl) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
        <div className="max-w-lg w-full text-center">
          <div className="text-6xl mb-6">🎉</div>
          <h1 className="text-3xl font-bold text-white mb-4">Stash Created!</h1>
          <p className="text-slate-400 mb-8">Share this link with buyers:</p>

          <div className="bg-slate-800 rounded-xl p-4 mb-6">
            <code className="text-orange-400 break-all">{stash.shareUrl}</code>
          </div>

          <button
            onClick={() => {
              navigator.clipboard.writeText(stash.shareUrl!);
              alert('Link copied!');
            }}
            className="py-3 px-6 bg-orange-500 hover:bg-orange-600 
                     text-white font-semibold rounded-xl transition-colors"
          >
            Copy Link
          </button>

          <button
            onClick={() => stash.reset()}
            className="block w-full mt-4 py-3 px-6 border border-slate-600 
                     text-slate-300 rounded-xl hover:bg-slate-800 transition-colors"
          >
            Create Another Stash
          </button>
        </div>
      </div>
    );
  }

  // Main upload form
  return (
    <div className="min-h-screen bg-slate-900 py-12 px-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-white mb-2">Create a Stash</h1>
        <p className="text-slate-400 mb-8">
          Upload a file, set your price, and get a shareable link
        </p>

        {/* File Upload */}
        <div className="mb-8">
          <FileUploader onFileSelect={handleFileSelect} disabled={stash.status !== 'idle'} />

          {fileInfo && (
            <div className="mt-4 bg-slate-800 rounded-xl p-4">
              <p className="text-white font-medium">{fileInfo.name}</p>
              <p className="text-slate-400 text-sm">
                {formatFileSize(fileInfo.size)} • {fileInfo.type}
              </p>
            </div>
          )}
        </div>

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
          className="w-full py-4 px-6 bg-orange-500 hover:bg-orange-600 
                   text-white font-bold text-lg rounded-xl transition-colors
                   disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {stash.status === 'idle' ? 'Create Stash 🐿️' : 'Processing...'}
        </button>
      </div>
    </div>
  );
}
