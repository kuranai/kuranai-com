import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import type { AssetResponse } from '../../../../shared/assets';
import {
  assetUploadErrorMessage,
  isAbortError,
  type UploadAsset,
  uploadAsset,
} from '../../assets/api';

export const MAX_PARALLEL_ASSET_UPLOADS = 3;

const CLIPBOARD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export type AssetUploadNodeType = 'assetImage' | 'attachment';
export type AssetUploadDecorationStatus = 'queued' | 'uploading' | 'failed';

export interface AssetUploadQueueTask {
  id: string;
  run: () => Promise<void>;
}

export class AssetUploadQueue {
  private readonly pending: AssetUploadQueueTask[] = [];
  private readonly cancelled = new Set<string>();
  private active = 0;
  private disposed = false;

  constructor(private readonly maxConcurrent = MAX_PARALLEL_ASSET_UPLOADS) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('The upload queue requires at least one concurrent slot.');
    }
  }

  get activeCount() {
    return this.active;
  }

  get pendingCount() {
    return this.pending.length;
  }

  enqueue(task: AssetUploadQueueTask) {
    if (this.disposed) {
      return;
    }

    this.cancelled.delete(task.id);
    this.pending.push(task);
    this.pump();
  }

  cancel(id: string) {
    this.cancelled.add(id);
    for (let index = this.pending.length - 1; index >= 0; index -= 1) {
      if (this.pending[index]?.id === id) {
        this.pending.splice(index, 1);
      }
    }
  }

  dispose() {
    this.disposed = true;
    this.pending.length = 0;
    this.cancelled.clear();
  }

  private pump() {
    while (!this.disposed && this.active < this.maxConcurrent && this.pending.length > 0) {
      const task = this.pending.shift();
      if (!task) {
        return;
      }

      if (this.cancelled.has(task.id)) {
        this.cancelled.delete(task.id);
        continue;
      }

      this.active += 1;
      let taskPromise: Promise<void>;
      try {
        taskPromise = task.run();
      } catch {
        taskPromise = Promise.resolve();
      }
      void taskPromise
        .catch(() => undefined)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}

interface UploadItem {
  id: string;
  file: File;
  nodeType: AssetUploadNodeType;
  previewUrl: string | null;
  status: AssetUploadDecorationStatus;
  progress: number;
  error: string | null;
}

type AssetUploadMeta =
  | { type: 'add'; item: UploadItem; position: number }
  | { type: 'update'; item: UploadItem }
  | { type: 'remove'; id: string };

interface AssetUploadPluginState {
  decorations: DecorationSet;
  items: Map<string, UploadItem>;
}

export const assetUploadPluginKey = new PluginKey<AssetUploadPluginState>('dovariAssetUploads');

function createUploadId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function isInlineImage(file: File) {
  const mimeType = file.type.split(';', 1)[0]?.trim().toLowerCase();
  return ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(mimeType);
}

function uploadFilename(file: File) {
  return file.name.trim() || 'attachment';
}

function createPreviewUrl(file: File, nodeType: AssetUploadNodeType) {
  if (
    nodeType !== 'assetImage' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return null;
  }

  return URL.createObjectURL(file);
}

export function filesFromClipboard(clipboardData: DataTransfer | null | undefined) {
  if (!clipboardData) {
    return [];
  }

  const files = Array.from(clipboardData.files ?? []);
  if (files.length > 0) {
    return files;
  }

  return Array.from(clipboardData.items ?? [])
    .filter((item) => item.kind === 'file' && typeof item.getAsFile === 'function')
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}

function clipboardImageFilename(mimeType: string) {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
  return `clipboard-image.${extension}`;
}

export function clipboardMayContainImage(clipboardData: DataTransfer | null | undefined) {
  if (!clipboardData) {
    return false;
  }

  const types = Array.from(clipboardData.types ?? []);
  if (types.some((type) => type === 'Files' || type.startsWith('image/'))) {
    return true;
  }

  try {
    return /<img\b/i.test(clipboardData.getData('text/html'));
  } catch {
    return false;
  }
}

export async function readClipboardImageFiles(
  clipboardData?: DataTransfer | null,
): Promise<File[]> {
  if (clipboardData && !clipboardMayContainImage(clipboardData)) {
    return [];
  }

  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
  if (clipboard && typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read();
      const files = (
        await Promise.all(
          items.map(async (item) => {
            const mimeType = CLIPBOARD_IMAGE_TYPES.find((type) => item.types.includes(type));
            if (!mimeType) {
              return null;
            }

            try {
              const blob = await item.getType(mimeType);
              return new File([blob], clipboardImageFilename(mimeType), { type: mimeType });
            } catch {
              return null;
            }
          }),
        )
      ).filter((file): file is File => file !== null);
      if (files.length > 0) {
        return files;
      }
    } catch {
      // Some browsers expose image paste data only through the event payload.
    }
  }

  if (!clipboardData || !clipboardMayContainImage(clipboardData)) {
    return [];
  }

  let html: string;
  try {
    html = clipboardData.getData('text/html');
  } catch {
    return [];
  }
  const dataUrl =
    /<img\b[^>]*\bsrc=["'](data:image\/(?:png|jpeg|webp|gif);base64,[^"']+)["']/i.exec(html)?.[1];
  if (!dataUrl) {
    return [];
  }

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const mimeType = CLIPBOARD_IMAGE_TYPES.find((type) => type === blob.type);
    return mimeType ? [new File([blob], clipboardImageFilename(mimeType), { type: mimeType })] : [];
  } catch {
    return [];
  }
}

function releasePreviewUrl(item: UploadItem) {
  if (item.previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    URL.revokeObjectURL(item.previewUrl);
  }
}

function button(label: string, onClick: () => void, className: string, parent: HTMLElement) {
  const control = document.createElement('button');
  control.className = className;
  control.type = 'button';
  control.setAttribute('aria-label', label);
  control.textContent = className.includes('retry') ? 'Retry' : 'Remove';
  control.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  control.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  parent.appendChild(control);
}

function createUploadWidget(
  item: UploadItem,
  handlers: { retry: (id: string) => void; remove: (id: string) => void },
) {
  const root = document.createElement('span');
  root.className = `asset-upload-decoration is-${item.status}`;
  root.contentEditable = 'false';
  root.dataset.assetUploadId = item.id;
  root.setAttribute('role', item.status === 'failed' ? 'alert' : 'status');

  if (item.previewUrl) {
    const preview = document.createElement('img');
    preview.alt = `Preview of ${uploadFilename(item.file)}`;
    preview.className = 'asset-upload-preview';
    preview.src = item.previewUrl;
    root.appendChild(preview);
  }

  const details = document.createElement('span');
  details.className = 'asset-upload-details';
  const label = document.createElement('span');
  label.className = 'asset-upload-label';
  label.textContent =
    item.status === 'failed'
      ? `Couldn’t upload ${uploadFilename(item.file)}.`
      : item.status === 'queued'
        ? `Waiting to upload ${uploadFilename(item.file)}…`
        : `Uploading ${uploadFilename(item.file)}…`;
  details.appendChild(label);

  if (item.status === 'uploading' || item.status === 'queued') {
    const progress = document.createElement('progress');
    progress.max = 100;
    progress.value = item.progress;
    progress.setAttribute('aria-label', `Upload progress for ${uploadFilename(item.file)}`);
    details.appendChild(progress);
    const percentage = document.createElement('span');
    percentage.className = 'asset-upload-progress';
    percentage.textContent = `${item.progress}%`;
    details.appendChild(percentage);
  }

  if (item.error) {
    const error = document.createElement('span');
    error.className = 'asset-upload-error';
    error.textContent = item.error;
    details.appendChild(error);
  }

  root.appendChild(details);

  if (item.status === 'failed') {
    const actions = document.createElement('span');
    actions.className = 'asset-upload-actions';
    button(
      `Retry upload ${uploadFilename(item.file)}`,
      () => handlers.retry(item.id),
      'retry',
      actions,
    );
    button(
      `Remove failed upload ${uploadFilename(item.file)}`,
      () => handlers.remove(item.id),
      'remove',
      actions,
    );
    root.appendChild(actions);
  }

  return root;
}

function uploadDecorations(
  decorations: DecorationSet,
  doc: Parameters<DecorationSet['map']>[1],
  item: UploadItem,
  handlers: { retry: (id: string) => void; remove: (id: string) => void },
) {
  const current = decorations.find(undefined, undefined, (spec) => spec.assetUploadId === item.id);
  if (current.length === 0) {
    return decorations;
  }

  const position = current[0]!.from;
  return decorations.remove(current).add(doc, [
    Decoration.widget(position, createUploadWidget(item, handlers), {
      assetUploadId: item.id,
      side: 1,
    }),
  ]);
}

function removeUploadDecorations(decorations: DecorationSet, id: string): DecorationSet {
  const current = decorations.find(undefined, undefined, (spec) => spec.assetUploadId === id);
  return current.length > 0 ? decorations.remove(current) : decorations;
}

function createAssetUploadPlugin(controller: AssetUploadController) {
  const emptyState: AssetUploadPluginState = {
    decorations: DecorationSet.empty,
    items: new Map(),
  };

  return new Plugin<AssetUploadPluginState>({
    key: assetUploadPluginKey,
    state: {
      init: () => emptyState,
      apply: (transaction, previous) => {
        let next: AssetUploadPluginState = {
          decorations: previous.decorations.map(transaction.mapping, transaction.doc),
          items: previous.items,
        };
        const meta = transaction.getMeta(assetUploadPluginKey) as AssetUploadMeta | undefined;
        if (!meta) {
          return next;
        }

        if (meta.type === 'add') {
          next = {
            decorations: next.decorations.add(transaction.doc, [
              Decoration.widget(
                Math.max(0, Math.min(meta.position, transaction.doc.content.size)),
                createUploadWidget(meta.item, controller),
                { assetUploadId: meta.item.id, side: 1 },
              ),
            ]),
            items: new Map(next.items).set(meta.item.id, meta.item),
          };
        } else if (meta.type === 'update') {
          next = {
            decorations: uploadDecorations(
              next.decorations,
              transaction.doc,
              meta.item,
              controller,
            ),
            items: new Map(next.items).set(meta.item.id, meta.item),
          };
        } else {
          const items = new Map(next.items);
          items.delete(meta.id);
          next = {
            decorations: removeUploadDecorations(next.decorations, meta.id),
            items,
          };
        }

        return next;
      },
    },
    props: {
      decorations: (state) =>
        assetUploadPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  });
}

export interface AssetUploadControllerOptions {
  pageId?: string;
  upload?: UploadAsset;
  maxConcurrent?: number;
}

export class AssetUploadController {
  private readonly queue: AssetUploadQueue;
  private readonly uploader: UploadAsset;
  private readonly pageId: string | undefined;
  private readonly items = new Map<string, UploadItem>();
  private readonly abortControllers = new Map<string, AbortController>();
  private editor: Editor | null = null;
  private disposed = false;

  constructor(options: AssetUploadControllerOptions = {}) {
    this.pageId = options.pageId;
    this.uploader = options.upload ?? uploadAsset;
    this.queue = new AssetUploadQueue(options.maxConcurrent);
  }

  handlePaste(editor: Editor, files: File[]) {
    this.handleFiles(editor, files, editor.state.selection.from);
  }

  handleDrop(editor: Editor, files: File[], position: number) {
    this.handleFiles(editor, files, position);
  }

  handleFiles(editor: Editor, files: File[], position: number) {
    this.enqueue(editor, files, position);
  }

  retry(id: string) {
    const item = this.items.get(id);
    if (!item || item.status !== 'failed' || this.disposed) {
      return;
    }

    const nextItem: UploadItem = { ...item, error: null, progress: 0, status: 'queued' };
    this.items.set(id, nextItem);
    this.dispatch({ type: 'update', item: nextItem });
    this.queue.enqueue({ id, run: () => this.run(nextItem) });
  }

  remove(id: string) {
    const item = this.items.get(id);
    if (!item) {
      return;
    }

    this.queue.cancel(id);
    this.abortControllers.get(id)?.abort();
    this.items.delete(id);
    this.dispatch({ type: 'remove', id });
    releasePreviewUrl(item);
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.queue.dispose();
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    for (const item of this.items.values()) {
      releasePreviewUrl(item);
    }
    this.abortControllers.clear();
    this.items.clear();
    this.editor = null;
  }

  private enqueue(editor: Editor, files: File[], position: number) {
    if (this.disposed) {
      return;
    }

    this.editor = editor;
    const safePosition = Math.max(0, Math.min(position, editor.state.doc.content.size));
    for (const file of files) {
      const id = createUploadId();
      const nodeType: AssetUploadNodeType = isInlineImage(file) ? 'assetImage' : 'attachment';
      const item: UploadItem = {
        error: null,
        file,
        id,
        nodeType,
        previewUrl: createPreviewUrl(file, nodeType),
        progress: 0,
        status: 'queued',
      };
      this.items.set(id, item);
      this.dispatch({ item, position: safePosition, type: 'add' });
      this.queue.enqueue({ id, run: () => this.run(item) });
    }
  }

  private dispatch(meta: AssetUploadMeta) {
    if (this.disposed || !this.editor || this.editor.isDestroyed) {
      return;
    }

    this.editor.view.dispatch(this.editor.state.tr.setMeta(assetUploadPluginKey, meta));
  }

  private updateItem(id: string, update: Partial<UploadItem>) {
    const item = this.items.get(id);
    if (!item) {
      return null;
    }

    const nextItem = { ...item, ...update };
    this.items.set(id, nextItem);
    this.dispatch({ item: nextItem, type: 'update' });
    return nextItem;
  }

  private async run(item: UploadItem) {
    if (this.disposed || this.items.get(item.id) !== item) {
      return;
    }

    const controller = new AbortController();
    this.abortControllers.set(item.id, controller);
    this.updateItem(item.id, { error: null, progress: 0, status: 'uploading' });

    try {
      const asset = await this.uploader(item.file, {
        onProgress: (progress) => {
          this.updateItem(item.id, {
            progress: Math.min(100, Math.max(0, Math.round(progress))),
          });
        },
        pageId: this.pageId,
        signal: controller.signal,
      });
      if (this.disposed || this.items.get(item.id) === undefined) {
        return;
      }

      this.insertUploadedAsset(item.id, asset);
    } catch (error) {
      if (
        controller.signal.aborted ||
        isAbortError(error) ||
        this.disposed ||
        this.items.get(item.id) === undefined
      ) {
        return;
      }

      this.updateItem(item.id, {
        error: assetUploadErrorMessage(error),
        status: 'failed',
      });
    } finally {
      if (this.abortControllers.get(item.id) === controller) {
        this.abortControllers.delete(item.id);
      }
    }
  }

  private insertUploadedAsset(id: string, asset: AssetResponse) {
    const item = this.items.get(id);
    const editor = this.editor;
    if (!item || !editor || editor.isDestroyed) {
      return;
    }

    const pluginState = assetUploadPluginKey.getState(editor.state);
    const decoration = pluginState?.decorations.find(
      undefined,
      undefined,
      (spec) => spec.assetUploadId === id,
    )[0];
    if (!decoration) {
      this.remove(id);
      return;
    }

    const attrs =
      item.nodeType === 'assetImage'
        ? { alt: '', assetId: asset.id, height: null, title: null, width: null }
        : { assetId: asset.id, filename: asset.filename, title: null };

    let inserted: boolean;
    try {
      inserted = editor.commands.insertContentAt(
        decoration.from,
        { attrs, type: item.nodeType },
        { updateSelection: false },
      );
    } catch {
      inserted = false;
    }

    if (!inserted) {
      this.updateItem(id, {
        error: 'The upload finished, but the file could not be inserted here.',
        status: 'failed',
      });
      return;
    }

    this.dispatch({ id, type: 'remove' });
    this.items.delete(id);
    releasePreviewUrl(item);
  }
}

export function createAssetUploadExtension(controller: AssetUploadController) {
  return Extension.create({
    name: 'assetUploadDecorations',

    onDestroy() {
      // Match Tiptap's lifetime: React StrictMode replays effect cleanup while
      // keeping the editor alive, so component cleanup must not dispose uploads.
      controller.dispose();
    },

    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          props: {
            handlePaste: (_view, event) => {
              const files = filesFromClipboard(event.clipboardData);
              if (files.length === 0) {
                return false;
              }

              event.preventDefault();
              event.stopPropagation();
              controller.handlePaste(editor, files);
              return true;
            },
          },
        }),
        createAssetUploadPlugin(controller),
      ];
    },
  });
}
