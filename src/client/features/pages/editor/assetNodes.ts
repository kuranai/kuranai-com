import { mergeAttributes, Node } from '@tiptap/core';
import type { Editor } from '@tiptap/core';

import { assetIdSchema } from '../../../../shared/assets';

export function assetContentUrl(assetId: string) {
  return `/api/private/assets/${encodeURIComponent(assetId)}/content`;
}

function assetIdFromNode(value: unknown) {
  return assetIdSchema.safeParse(value).success && typeof value === 'string' ? value : '';
}

interface AssetNodeLike {
  attrs: Record<string, unknown>;
}

interface AssetNodeViewLike extends AssetNodeLike {
  type: { name: string };
}

interface AssetImageNodeEditor {
  commands: Editor['commands'];
  state: Editor['state'];
  view: Editor['view'];
}

function assetTextAttribute(node: AssetNodeLike, name: string, fallback = '') {
  return typeof node.attrs[name] === 'string' ? node.attrs[name] : fallback;
}

function setAssetStatus(element: HTMLElement, status: 'available' | 'missing') {
  element.dataset.dovariAssetStatus = status;
}

function missingAssetLabel(kind: 'image' | 'attachment', name: string) {
  if (kind === 'image') {
    return name ? `Image unavailable: ${name}` : 'Image unavailable.';
  }

  return name ? `Attachment unavailable: ${name}` : 'Attachment unavailable.';
}

function watchAttachmentAvailability(assetId: string, onMissing: () => void) {
  if (!assetId || typeof globalThis.fetch !== 'function') {
    return () => undefined;
  }

  const controller = new AbortController();
  void globalThis
    .fetch(assetContentUrl(assetId), {
      credentials: 'same-origin',
      method: 'HEAD',
      signal: controller.signal,
    })
    .then((response) => {
      if (!response.ok) {
        onMissing();
      }
    })
    .catch(() => {
      if (!controller.signal.aborted) {
        onMissing();
      }
    });

  return () => controller.abort();
}

const IMAGE_SIZE_MIN = 48;
const IMAGE_SIZE_MAX = 100_000;
const IMAGE_SIZE_PRESETS = [
  { label: 'Small', scale: 0.25 },
  { label: 'Medium', scale: 0.5 },
  { label: 'Large', scale: 0.75 },
] as const;

function positiveDimension(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function clampImageDimension(value: number, maximum = IMAGE_SIZE_MAX) {
  return Math.max(IMAGE_SIZE_MIN, Math.min(IMAGE_SIZE_MAX, Math.min(maximum, Math.round(value))));
}

function createImageSizeButton(label: string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'asset-image-size-preset';
  button.textContent = label;
  button.title = `Resize image to ${label}`;
  button.setAttribute('aria-label', label);
  return button;
}

function createAssetImageNodeView(
  node: AssetNodeLike,
  editor: AssetImageNodeEditor,
  getPos: () => number | undefined,
) {
  const wrapper = document.createElement('span');
  wrapper.className = 'asset-image-node-container';
  wrapper.contentEditable = 'false';
  wrapper.setAttribute('data-dovari-asset-selected', 'false');

  const image = document.createElement('img');
  image.className = 'asset-image-node';
  image.tabIndex = 0;
  const fallback = document.createElement('span');
  fallback.className = 'asset-missing-fallback';
  fallback.hidden = true;
  fallback.setAttribute('role', 'status');
  const controls = document.createElement('div');
  controls.className = 'asset-image-controls';
  controls.hidden = true;
  controls.setAttribute('aria-label', 'Image size controls');

  const presetGroup = document.createElement('div');
  presetGroup.className = 'asset-image-size-presets';
  presetGroup.setAttribute('aria-label', 'Preset image sizes');
  const presetButtons = IMAGE_SIZE_PRESETS.map((preset) => {
    const button = createImageSizeButton(preset.label);
    const handler = () => applyPreset(preset.scale);
    button.addEventListener('click', handler);
    presetGroup.appendChild(button);
    return { button, handler };
  });
  const originalButton = createImageSizeButton('Original');
  const originalHandler = () => applyPreset(null);
  originalButton.addEventListener('click', originalHandler);
  presetGroup.appendChild(originalButton);
  controls.appendChild(presetGroup);

  image.draggable = false;

  const resizeHandle = document.createElement('button');
  resizeHandle.type = 'button';
  resizeHandle.className = 'asset-image-resize-handle';
  resizeHandle.hidden = true;
  resizeHandle.setAttribute('aria-label', 'Resize image');
  resizeHandle.title = 'Resize image';

  let currentAssetId: string | null = null;
  let isMissing = false;
  let dragState: {
    aspectRatio: number;
    height: number;
    pointerId: number;
    startWidth: number;
    startX: number;
    width: number;
  } | null = null;

  const renderedImageSize = () => {
    const width = positiveDimension(image.width) ?? positiveDimension(image.naturalWidth);
    const height = positiveDimension(image.height) ?? positiveDimension(image.naturalHeight);
    const rect = image.getBoundingClientRect();
    return {
      height: height ?? positiveDimension(rect.height) ?? IMAGE_SIZE_MIN,
      width: width ?? positiveDimension(rect.width) ?? IMAGE_SIZE_MIN,
    };
  };

  const originalImageSize = () => {
    const width = positiveDimension(image.naturalWidth);
    const height = positiveDimension(image.naturalHeight);
    if (width && height) {
      return { height, width };
    }

    return renderedImageSize();
  };

  const setSelected = (selected: boolean) => {
    controls.hidden = !selected;
    resizeHandle.hidden = !selected;
    wrapper.dataset.dovariAssetSelected = selected ? 'true' : 'false';
  };

  const updateImageStatus = (available: boolean) => {
    isMissing = !available;
    image.hidden = !available;
    fallback.hidden = available;
    setAssetStatus(wrapper, available ? 'available' : 'missing');
    setAssetStatus(image, available ? 'available' : 'missing');
  };

  const dispatchImageAttributes = (width: number | null, height: number | null) => {
    const position = getPos();
    const currentNode = typeof position === 'number' ? editor.state.doc.nodeAt(position) : null;
    if (!currentNode || typeof position !== 'number' || currentNode.type.name !== 'assetImage') {
      return false;
    }

    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...currentNode.attrs,
        height,
        width,
      }),
    );
    editor.view.focus();
    setSelected(true);
    return true;
  };

  const clearPreviewSize = () => {
    image.style.removeProperty('width');
    image.style.removeProperty('height');
  };

  const applyPreset = (scale: number | null) => {
    if (scale === null) {
      clearPreviewSize();
      dispatchImageAttributes(null, null);
      return;
    }

    const original = originalImageSize();
    const width = clampImageDimension(original.width * scale);
    const height = clampImageDimension(original.height * scale);
    clearPreviewSize();
    dispatchImageAttributes(width, height);
  };

  const finishResize = () => {
    if (!dragState) {
      return;
    }

    const width = dragState.width;
    const height = dragState.height;
    clearPreviewSize();
    dispatchImageAttributes(width, height);
    resizeHandle.releasePointerCapture?.(dragState.pointerId);
    dragState = null;
    wrapper.classList.remove('is-resizing');
  };

  const cancelResize = () => {
    if (!dragState) {
      return;
    }
    clearPreviewSize();
    dragState = null;
    wrapper.classList.remove('is-resizing');
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    const size = renderedImageSize();
    dragState = {
      aspectRatio: size.width / Math.max(IMAGE_SIZE_MIN, size.height),
      height: size.height,
      pointerId: event.pointerId,
      startWidth: size.width,
      startX: event.clientX,
      width: size.width,
    };
    resizeHandle.setPointerCapture?.(event.pointerId);
    wrapper.classList.add('is-resizing');
    event.preventDefault();
    event.stopPropagation();
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    const maximum = wrapper.parentElement?.getBoundingClientRect().width ?? IMAGE_SIZE_MAX;
    const width = clampImageDimension(
      dragState.startWidth + event.clientX - dragState.startX,
      maximum,
    );
    const height = clampImageDimension(width / dragState.aspectRatio);
    dragState.width = width;
    dragState.height = height;
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    event.preventDefault();
  };

  const handleImageClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const position = getPos();
    if (typeof position === 'number') {
      editor.commands.setNodeSelection(position);
    }
    setSelected(true);
  };

  const handleImageKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    setSelected(true);
  };

  const updateDom = (nextNode: AssetNodeLike) => {
    const assetId = assetIdFromNode(nextNode.attrs.assetId);
    const assetChanged = assetId !== currentAssetId;
    currentAssetId = assetId;
    const alt = assetTextAttribute(nextNode, 'alt');
    const title = assetTextAttribute(nextNode, 'title', '');
    const width = nextNode.attrs.width;
    const height = nextNode.attrs.height;

    image.alt = alt;
    const contentUrl = assetContentUrl(assetId);
    if (image.getAttribute('src') !== contentUrl) {
      image.src = contentUrl;
    }
    if (title) {
      image.title = title;
    } else {
      image.removeAttribute('title');
    }
    if (typeof width === 'number' && Number.isFinite(width)) {
      image.width = width;
    } else {
      image.removeAttribute('width');
    }
    if (typeof height === 'number' && Number.isFinite(height)) {
      image.height = height;
    } else {
      image.removeAttribute('height');
    }
    clearPreviewSize();
    if (typeof width === 'number' && Number.isFinite(width)) {
      image.style.width = `${width}px`;
    }
    if (typeof height === 'number' && Number.isFinite(height)) {
      image.style.height = `${height}px`;
    }
    fallback.textContent = missingAssetLabel('image', alt);
    if (assetChanged) {
      updateImageStatus(true);
    } else if (isMissing) {
      updateImageStatus(false);
    }
  };

  const markMissing = () => {
    updateImageStatus(false);
  };

  const markAvailable = () => {
    updateImageStatus(true);
  };

  image.addEventListener('error', markMissing);
  image.addEventListener('load', markAvailable);
  image.addEventListener('click', handleImageClick);
  image.addEventListener('keydown', handleImageKeyDown);
  resizeHandle.addEventListener('pointerdown', handlePointerDown);
  resizeHandle.addEventListener('pointermove', handlePointerMove);
  resizeHandle.addEventListener('pointerup', finishResize);
  resizeHandle.addEventListener('pointercancel', cancelResize);
  controls.addEventListener('mousedown', (event) => event.stopPropagation());
  controls.addEventListener('click', (event) => event.stopPropagation());
  wrapper.appendChild(image);
  wrapper.appendChild(fallback);
  wrapper.appendChild(controls);
  wrapper.appendChild(resizeHandle);
  updateDom(node);

  return {
    dom: wrapper,
    selectNode() {
      setSelected(true);
    },
    deselectNode() {
      setSelected(false);
    },
    update(nextNode: AssetNodeViewLike) {
      if (nextNode.type.name !== 'assetImage') {
        return false;
      }
      updateDom(nextNode);
      return true;
    },
    ignoreMutation: () => true,
    destroy() {
      image.removeEventListener('error', markMissing);
      image.removeEventListener('load', markAvailable);
      image.removeEventListener('click', handleImageClick);
      image.removeEventListener('keydown', handleImageKeyDown);
      resizeHandle.removeEventListener('pointerdown', handlePointerDown);
      resizeHandle.removeEventListener('pointermove', handlePointerMove);
      resizeHandle.removeEventListener('pointerup', finishResize);
      resizeHandle.removeEventListener('pointercancel', cancelResize);
      for (const { button, handler } of presetButtons) {
        button.removeEventListener('click', handler);
      }
      originalButton.removeEventListener('click', originalHandler);
      cancelResize();
    },
  };
}

function createAttachmentNodeView(node: AssetNodeLike) {
  const anchor = document.createElement('a');
  anchor.className = 'asset-attachment-node';
  anchor.contentEditable = 'false';
  anchor.download = '';
  anchor.rel = 'noopener noreferrer';

  const icon = document.createElement('span');
  icon.className = 'asset-attachment-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '📎';
  const nameElement = document.createElement('span');
  nameElement.className = 'asset-attachment-name';
  const fallback = document.createElement('span');
  fallback.className = 'asset-missing-fallback';
  fallback.hidden = true;
  fallback.setAttribute('role', 'status');

  let stopAvailabilityWatch: () => void = () => undefined;
  let currentAssetId: string | null = null;
  let isMissing = false;
  const markMissing = () => {
    isMissing = true;
    const filename = nameElement.textContent ?? 'Attachment';
    fallback.textContent = missingAssetLabel('attachment', filename);
    fallback.hidden = false;
    anchor.setAttribute('aria-label', `Attachment unavailable: ${filename}`);
    setAssetStatus(anchor, 'missing');
  };

  const updateDom = (nextNode: AssetNodeLike) => {
    const assetId = assetIdFromNode(nextNode.attrs.assetId);
    const assetChanged = assetId !== currentAssetId;
    currentAssetId = assetId;
    const filename = assetTextAttribute(nextNode, 'filename', 'Attachment');
    const title = assetTextAttribute(nextNode, 'title', '');
    nameElement.textContent = filename;
    anchor.href = assetContentUrl(assetId);
    anchor.setAttribute('aria-label', `Download ${filename}`);
    if (title) {
      anchor.title = title;
    } else {
      anchor.removeAttribute('title');
    }
    fallback.hidden = !isMissing;
    if (assetChanged) {
      stopAvailabilityWatch();
      isMissing = false;
      fallback.hidden = true;
      setAssetStatus(anchor, 'available');
      stopAvailabilityWatch = watchAttachmentAvailability(assetId, markMissing);
    } else if (isMissing) {
      setAssetStatus(anchor, 'missing');
    }
  };

  anchor.appendChild(icon);
  anchor.appendChild(nameElement);
  anchor.appendChild(fallback);
  updateDom(node);

  return {
    dom: anchor,
    update(nextNode: AssetNodeViewLike) {
      if (nextNode.type.name !== 'attachment') {
        return false;
      }
      updateDom(nextNode);
      return true;
    },
    ignoreMutation: () => true,
    destroy() {
      stopAvailabilityWatch();
    },
  };
}

export const AssetImage = Node.create({
  name: 'assetImage',

  group: 'inline',

  inline: true,

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        rendered: false,
      },
      alt: {
        default: '',
      },
      title: {
        default: null,
      },
      width: {
        default: null,
      },
      height: {
        default: null,
      },
    };
  },

  addNodeView() {
    return ({ editor, getPos, node }) =>
      createAssetImageNodeView(node, editor, getPos as () => number | undefined);
  },

  renderHTML({ node, HTMLAttributes }) {
    const assetId = assetIdFromNode(node.attrs.assetId);
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-dovari-asset-id': assetId,
        src: assetContentUrl(assetId),
        class: 'asset-image-node',
      }),
    ];
  },
});

export const Attachment = Node.create({
  name: 'attachment',

  group: 'inline',

  inline: true,

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        rendered: false,
      },
      filename: {
        default: 'Attachment',
        rendered: false,
      },
      title: {
        default: null,
      },
    };
  },

  addNodeView() {
    return ({ node }) => createAttachmentNodeView(node);
  },

  renderHTML({ node, HTMLAttributes }) {
    const assetId = assetIdFromNode(node.attrs.assetId);
    const filename = typeof node.attrs.filename === 'string' ? node.attrs.filename : 'Attachment';
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'aria-label': `Download ${filename}`,
        'data-dovari-asset-id': assetId,
        class: 'asset-attachment-node',
        download: '',
        href: assetContentUrl(assetId),
        rel: 'noopener noreferrer',
      }),
      ['span', { 'aria-hidden': 'true', class: 'asset-attachment-icon' }, '📎'],
      ['span', { class: 'asset-attachment-name' }, filename],
    ];
  },
});
