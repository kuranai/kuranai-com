import { mergeAttributes, Node } from '@tiptap/core';

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

function createAssetImageNodeView(node: AssetNodeLike) {
  const wrapper = document.createElement('span');
  wrapper.className = 'asset-image-node-container';
  wrapper.contentEditable = 'false';

  const image = document.createElement('img');
  image.className = 'asset-image-node';
  const fallback = document.createElement('span');
  fallback.className = 'asset-missing-fallback';
  fallback.hidden = true;
  fallback.setAttribute('role', 'status');
  let currentAssetId: string | null = null;
  let isMissing = false;

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
    if (typeof width === 'number') {
      image.width = width;
    } else {
      image.removeAttribute('width');
    }
    if (typeof height === 'number') {
      image.height = height;
    } else {
      image.removeAttribute('height');
    }
    fallback.textContent = missingAssetLabel('image', alt);
    if (assetChanged) {
      isMissing = false;
      image.hidden = false;
      fallback.hidden = true;
      setAssetStatus(wrapper, 'available');
      setAssetStatus(image, 'available');
    } else if (isMissing) {
      image.hidden = true;
      fallback.hidden = false;
      setAssetStatus(wrapper, 'missing');
      setAssetStatus(image, 'missing');
    }
  };

  const markMissing = () => {
    isMissing = true;
    image.hidden = true;
    fallback.hidden = false;
    setAssetStatus(wrapper, 'missing');
    setAssetStatus(image, 'missing');
  };

  image.addEventListener('error', markMissing);
  wrapper.appendChild(image);
  wrapper.appendChild(fallback);
  updateDom(node);

  return {
    dom: wrapper,
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
    return ({ node }) => createAssetImageNodeView(node);
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
