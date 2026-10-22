import { useEffect, useRef, useState } from 'react';
import { X, Pencil, Trash2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { deleteStash, updateStash } from '../lib/api';
import { deleteStashFile } from '../lib/blossom';
import { useToast } from './useToast';
import type { SellerStashStats, UpdateStashRequest } from '../../../shared/types';

type Section = 'details' | 'selling' | 'delete';

interface ManageStashModalProps {
  stash: SellerStashStats;
  onClose: () => void;
  // Called once a change has landed, so the dashboard can refetch.
  onChanged: () => void;
}

const inputClass =
  'w-full px-4 py-3 bg-slate-800 border border-slate-600 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-orange-500';
const secondaryButtonClass =
  'flex shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50';

export function ManageStashModal({ stash, onClose, onChanged }: ManageStashModalProps) {
  const toast = useToast();
  const [title, setTitle] = useState(stash.title);
  const [description, setDescription] = useState(stash.description ?? '');
  const [price, setPrice] = useState(String(stash.priceSats));
  const [payWhatYouWant, setPayWhatYouWant] = useState(stash.payWhatYouWant);
  const [busy, setBusy] = useState<Section | null>(null);
  const [removingFile, setRemovingFile] = useState(false);
  const [error, setError] = useState<{ section: Section; message: string } | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.body.classList.add('modal-open');
    return () => document.body.classList.remove('modal-open');
  }, []);

  // The delete section sits below the fold on small screens.
  useEffect(() => {
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [error]);

  const priceSats = /^\d+$/.test(price.trim()) ? Number(price.trim()) : NaN;
  const priceValid = Number.isSafeInteger(priceSats) && priceSats > 0;
  const titleValid = title.trim().length > 0;

  // Only what differs is sent, so an unchanged price never touches payments.
  const changes: UpdateStashRequest = {};
  if (title.trim() !== stash.title) changes.title = title.trim();
  if (description.trim() !== (stash.description ?? '')) changes.description = description.trim();
  if (priceValid && priceSats !== stash.priceSats) changes.priceSats = priceSats;
  if (payWhatYouWant !== stash.payWhatYouWant) changes.payWhatYouWant = payWhatYouWant;
  const hasChanges = Object.keys(changes).length > 0;

  const run = async (section: Section, action: () => Promise<void>) => {
    setBusy(section);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError({
        section,
        message: err instanceof Error ? err.message : 'Something went wrong',
      });
    } finally {
      setBusy(null);
      setRemovingFile(false);
    }
  };

  const save = () =>
    run('details', async () => {
      await updateStash(stash.id, changes);
      toast.showToast('Changes saved', 'success');
      onChanged();
      onClose();
    });

  const togglePublished = () =>
    run('selling', async () => {
      const { published } = await updateStash(stash.id, { published: !stash.published });
      toast.showToast(
        published ? "Published. It's for sale again" : 'Unpublished. Nobody can buy it now',
        'success'
      );
      onChanged();
      onClose();
    });

  const remove = () =>
    run('delete', async () => {
      let location;
      try {
        location = await deleteStash(stash.id);
      } catch (err) {
        // A payment may still be in flight. Stop new ones now, so the wait
        // the server asked for can't keep growing.
        if ((err as Error & { status?: number }).status === 409 && stash.published) {
          await updateStash(stash.id, { published: false });
          onChanged();
          throw new Error(
            `${(err as Error).message} It's unpublished now, so nobody new can start paying.`
          );
        }
        throw err;
      }

      // The server has wiped the key. Deleting the file itself takes the
      // seller's own signature, so it happens here in the browser.
      setRemovingFile(true);
      const { failedHosts } = await deleteStashFile(location.blobUrl, location.blobSha256);
      toast.showToast(
        failedHosts.length === 0
          ? 'Stash deleted'
          : `Stash deleted. ${failedHosts.join(', ')} didn't confirm removing the file, but nobody can open it without the key.`,
        failedHosts.length === 0 ? 'success' : 'info'
      );
      onChanged();
      onClose();
    });

  const errorFor = (section: Section) =>
    error?.section === section && (
      <p
        ref={errorRef}
        className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300"
      >
        {error.message}
      </p>
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-slate-700/50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center">
              <Pencil className="w-5 h-5 text-slate-400" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Manage stash</h2>
              <p className="text-slate-400 text-xs">Edit it, stop selling it, or delete it</p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={busy !== null}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto overscroll-contain space-y-6">
          {/* Details */}
          <div className="space-y-4">
            <div>
              <label htmlFor="manage-title" className="block text-slate-300 mb-2">
                Title *
              </label>
              <input
                id="manage-title"
                type="text"
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="manage-description" className="block text-slate-300 mb-2">
                Description
              </label>
              <textarea
                id="manage-description"
                value={description}
                maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's in this file?"
                rows={3}
                className={`${inputClass} resize-none`}
              />
            </div>

            <div>
              <label htmlFor="manage-price" className="block text-slate-300 mb-2">
                {payWhatYouWant ? 'Minimum price (sats) *' : 'Price (sats) *'}
              </label>
              <input
                id="manage-price"
                type="number"
                min="1"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={inputClass}
              />
              {!priceValid && (
                <p className="mt-2 text-red-400 text-sm">Enter a whole number of sats above 0</p>
              )}
              <label className="mt-3 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={payWhatYouWant}
                  onChange={(e) => setPayWhatYouWant(e.target.checked)}
                  className="mt-1 h-4 w-4 shrink-0 accent-orange-500"
                />
                <span>
                  <span className="block text-sm text-slate-300">Let buyers pay more</span>
                  <span className="block text-xs text-slate-500">
                    Your price becomes the minimum. Buyers can choose to pay extra.
                  </span>
                </span>
              </label>
            </div>

            <p className="text-xs text-slate-500">
              A new price only applies to new payments. The file and its preview can't be changed.
            </p>

            <button
              onClick={save}
              disabled={!hasChanges || !titleValid || !priceValid || busy !== null}
              className="btn-primary w-full px-4 py-3"
            >
              {busy === 'details' && <Loader2 className="w-4 h-4 animate-spin" />}
              Save changes
            </button>
            {errorFor('details')}
          </div>

          {/* Selling */}
          <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-white">
                  {stash.published ? 'For sale' : 'Not for sale'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {stash.published
                    ? 'Anyone with the link can buy it. Unpublishing stops new sales, and buyers who already paid can still download it.'
                    : 'Nobody can buy it right now. Buyers who already paid can still download it until their window ends.'}
                </p>
              </div>
              <button
                onClick={togglePublished}
                disabled={busy !== null}
                className={secondaryButtonClass}
              >
                {busy === 'selling' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : stash.published ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                {stash.published ? 'Unpublish' : 'Publish'}
              </button>
            </div>
            {errorFor('selling')}
          </div>

          {/* Delete */}
          <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-4">
            {!confirmingDelete ? (
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">Delete stash</p>
                  <p className="mt-1 text-xs text-slate-400">Removes it for good, file included.</p>
                </div>
                <button
                  onClick={() => setConfirmingDelete(true)}
                  disabled={busy !== null}
                  className="flex shrink-0 items-center gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-semibold text-rose-300 transition-colors hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-rose-200">
                  Delete "{stash.title}" for good?
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-300">
                  <li>The link stops working, for everyone.</li>
                  {stash.unlockCount > 0 && (
                    <li>
                      {stash.unlockCount === 1
                        ? "The person who bought it can't download it again."
                        : `The ${stash.unlockCount} people who bought it can't download it again.`}
                    </li>
                  )}
                  <li>The encrypted file is deleted from its storage servers.</li>
                  {stash.totalEarned > 0 && (
                    <li>
                      The {stash.totalEarned.toLocaleString()} sats it earned stay in your balance.
                    </li>
                  )}
                </ul>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={remove}
                    disabled={busy !== null}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {busy === 'delete' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                    {busy !== 'delete'
                      ? 'Delete forever'
                      : removingFile
                        ? 'Removing the file...'
                        : 'Deleting...'}
                  </button>
                  <button
                    onClick={() => {
                      setConfirmingDelete(false);
                      setError(null);
                    }}
                    disabled={busy !== null}
                    className={`${secondaryButtonClass} flex-1`}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            )}
            {errorFor('delete')}
          </div>
        </div>
      </div>
    </div>
  );
}
