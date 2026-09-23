import type { ReactNode } from 'react';

import type { PublicTiptapNode, PublicTiptapDocument } from '../../../shared/publications';

function safeHref(value: unknown) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048) {
    return null;
  }
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return null;
    return value;
  } catch {
    return null;
  }
}

function textValue(node: PublicTiptapNode) {
  return typeof node.text === 'string' ? node.text : '';
}

function renderInline(node: PublicTiptapNode, publicationId: string): ReactNode {
  if (node.type === 'text') {
    let value: ReactNode = textValue(node);
    for (const mark of node.marks ?? []) {
      switch (mark.type) {
        case 'bold':
          value = <strong>{value}</strong>;
          break;
        case 'italic':
          value = <em>{value}</em>;
          break;
        case 'strike':
          value = <s>{value}</s>;
          break;
        case 'code':
          value = <code>{value}</code>;
          break;
        case 'link': {
          const href = safeHref(mark.attrs?.href);
          if (href !== null) {
            const external = /^https?:/iu.test(href);
            value = (
              <a
                href={href}
                rel={external ? 'noopener noreferrer' : undefined}
                target={external ? '_blank' : undefined}
              >
                {value}
              </a>
            );
          }
          break;
        }
        default:
          break;
      }
    }
    return value;
  }

  if (node.type === 'hardBreak') return <br />;

  if (node.type === 'publicWikiLink') {
    const targetPublicId = node.attrs?.targetPublicId;
    if (typeof targetPublicId !== 'string') return null;
    return (
      <a href={`/p/${encodeURIComponent(targetPublicId)}`}>
        {typeof node.attrs?.targetTitle === 'string' ? node.attrs.targetTitle : 'Public page'}
      </a>
    );
  }

  return renderChildren(node, publicationId);
}

function renderChildren(node: PublicTiptapNode, publicationId: string) {
  return (node.content ?? []).map((child, index) => (
    <PublicNode key={`${child.type}-${index}`} node={child} publicationId={publicationId} />
  ));
}

function assetUrl(publicationId: string, assetId: unknown) {
  return typeof assetId === 'string'
    ? `/api/public/publications/${encodeURIComponent(publicationId)}/assets/${encodeURIComponent(assetId)}/content`
    : null;
}

function PublicNode({ node, publicationId }: { node: PublicTiptapNode; publicationId: string }) {
  switch (node.type) {
    case 'doc':
      return <>{renderChildren(node, publicationId)}</>;
    case 'paragraph':
      return <p>{renderChildren(node, publicationId)}</p>;
    case 'heading': {
      const level = node.attrs?.level;
      const children = renderChildren(node, publicationId);
      if (level === 1) return <h1>{children}</h1>;
      if (level === 2) return <h2>{children}</h2>;
      return <h3>{children}</h3>;
    }
    case 'bulletList':
      return <ul>{renderChildren(node, publicationId)}</ul>;
    case 'orderedList': {
      const start = node.attrs?.start;
      return (
        <ol start={typeof start === 'number' && Number.isInteger(start) ? start : undefined}>
          {renderChildren(node, publicationId)}
        </ol>
      );
    }
    case 'listItem':
      return <li>{renderChildren(node, publicationId)}</li>;
    case 'taskList':
      return <ul className="public-task-list">{renderChildren(node, publicationId)}</ul>;
    case 'taskItem':
      return (
        <li className="public-task-item">
          <input
            aria-label="Completed task"
            checked={node.attrs?.checked === true}
            disabled
            readOnly
            type="checkbox"
          />
          <div>{renderChildren(node, publicationId)}</div>
        </li>
      );
    case 'blockquote':
      return <blockquote>{renderChildren(node, publicationId)}</blockquote>;
    case 'horizontalRule':
      return <hr />;
    case 'hardBreak':
      return <br />;
    case 'codeBlock':
      return (
        <pre>
          <code>{renderChildren(node, publicationId)}</code>
        </pre>
      );
    case 'assetImage': {
      const src = assetUrl(publicationId, node.attrs?.assetId);
      if (src === null) return null;
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      const width = typeof node.attrs?.width === 'number' ? node.attrs.width : undefined;
      const height = typeof node.attrs?.height === 'number' ? node.attrs.height : undefined;
      return (
        <figure className="public-asset-image">
          <img alt={alt} height={height} loading="lazy" src={src} width={width} />
        </figure>
      );
    }
    case 'attachment': {
      const href = assetUrl(publicationId, node.attrs?.assetId);
      if (href === null) return null;
      const filename = typeof node.attrs?.filename === 'string' ? node.attrs.filename : 'Download';
      return <a href={href}>{filename}</a>;
    }
    case 'text':
    case 'publicWikiLink':
      return renderInline(node, publicationId);
    default:
      return null;
  }
}

export function PublicDocument({
  document,
  publicationId,
}: {
  document: PublicTiptapDocument;
  publicationId: string;
}) {
  return (
    <div className="page-editor-content public-document">
      <PublicNode node={document} publicationId={publicationId} />
    </div>
  );
}
