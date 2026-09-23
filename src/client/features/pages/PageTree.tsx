import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { NavLink } from 'react-router-dom';

import type { MovePageRequest, PageSummary } from '../../../shared/pages';
import { movePage as movePageRequest, pageErrorMessage } from './api';

const ROOT_PARENT = '__root__';

type DropPlacement = 'before' | 'into' | 'after';

function comparePages(first: PageSummary, second: PageSummary) {
  return (
    first.position - second.position ||
    first.title.localeCompare(second.title, undefined, { sensitivity: 'base' }) ||
    first.id.localeCompare(second.id)
  );
}

function parentKey(page: PageSummary, pageIds: Set<string>) {
  return page.parentId !== null && pageIds.has(page.parentId) ? page.parentId : ROOT_PARENT;
}

function createChildrenMap(pages: PageSummary[]) {
  const pageIds = new Set(pages.map((page) => page.id));
  const children = new Map<string, PageSummary[]>();

  for (const page of pages) {
    const key = parentKey(page, pageIds);
    const siblings = children.get(key) ?? [];
    siblings.push(page);
    children.set(key, siblings);
  }

  for (const siblings of children.values()) {
    siblings.sort(comparePages);
  }

  return children;
}

function descendantsOf(pageId: string, pages: PageSummary[]) {
  const descendants = new Set<string>();
  const pending = [pageId];

  while (pending.length > 0) {
    const parentId = pending.shift();
    if (parentId === undefined) {
      continue;
    }

    for (const page of pages) {
      if (page.parentId === parentId && !descendants.has(page.id)) {
        descendants.add(page.id);
        pending.push(page.id);
      }
    }
  }

  return descendants;
}

function dropPlacement(event: DragEvent<HTMLElement>): DropPlacement {
  const bounds = event.currentTarget.getBoundingClientRect();
  const offset = event.clientY - bounds.top;
  const ratio = bounds.height > 0 ? offset / bounds.height : 0.5;

  if (ratio < 0.3) {
    return 'before';
  }
  if (ratio > 0.7) {
    return 'after';
  }
  return 'into';
}

function moveRequestForDrop(page: PageSummary, placement: DropPlacement): MovePageRequest {
  if (placement === 'into') {
    return { parentId: page.id };
  }

  return placement === 'before'
    ? { beforeId: page.id, parentId: page.parentId }
    : { afterId: page.id, parentId: page.parentId };
}

interface PageTreeBranchProps {
  childrenMap: Map<string, PageSummary[]>;
  collapsedIds: Set<string>;
  draggingPageId: string | null;
  onCreateChild: (parentId: string) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, page: PageSummary) => void;
  onDrop: (event: DragEvent<HTMLElement>, page: PageSummary) => void;
  onDragOver: (event: DragEvent<HTMLElement>, page: PageSummary) => void;
  onDragLeave: (event: DragEvent<HTMLElement>) => void;
  onToggle: (pageId: string) => void;
  pendingMoveId: string | null;
  dropTarget: { pageId: string; placement: DropPlacement } | null;
  parentId: string;
  visited: Set<string>;
}

function PageTreeBranch({
  childrenMap,
  collapsedIds,
  draggingPageId,
  onCreateChild,
  onDragEnd,
  onDragStart,
  onDrop,
  onDragOver,
  onDragLeave,
  onToggle,
  pendingMoveId,
  dropTarget,
  parentId,
  visited,
}: PageTreeBranchProps) {
  const pageItems = childrenMap.get(parentId) ?? [];

  if (pageItems.length === 0) {
    return null;
  }

  return (
    <ul className="page-tree-list">
      {pageItems.map((page) => {
        if (visited.has(page.id)) {
          return null;
        }

        const nextVisited = new Set(visited).add(page.id);
        const children = childrenMap.get(page.id) ?? [];
        const isCollapsed = collapsedIds.has(page.id);
        const isDragging = draggingPageId === page.id;
        const isDropTarget = dropTarget?.pageId === page.id;

        return (
          <li className="page-tree-item" key={page.id}>
            <div
              aria-label={`Drag ${page.title} to move it`}
              className={`page-tree-row${isDragging ? ' is-dragging' : ''}${
                isDropTarget ? ` is-drop-${dropTarget.placement}` : ''
              }`}
              draggable={pendingMoveId === null}
              onDragEnd={onDragEnd}
              onDragLeave={onDragLeave}
              onDragOver={(event) => onDragOver(event, page)}
              onDragStart={(event) => onDragStart(event, page)}
              onDrop={(event) => onDrop(event, page)}
            >
              {children.length > 0 ? (
                <button
                  aria-expanded={!isCollapsed}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${page.title}`}
                  className="page-tree-toggle"
                  onClick={() => onToggle(page.id)}
                  type="button"
                >
                  {isCollapsed ? '▸' : '▾'}
                </button>
              ) : (
                <span aria-hidden="true" className="page-tree-toggle-spacer" />
              )}
              <NavLink
                className={({ isActive }) => `page-tree-link${isActive ? ' is-active' : ''}`}
                to={`/app/pages/${page.id}`}
              >
                <span className="page-tree-icon" aria-hidden="true">
                  {page.isFavorite ? (
                    <svg
                      aria-hidden="true"
                      className="page-tree-icon-svg is-favorite"
                      focusable="false"
                      viewBox="0 0 16 16"
                    >
                      <path d="m8 1.75 1.73 3.51 3.87.56-2.8 2.73.66 3.85L8 10.58l-3.46 1.82.66-3.85-2.8-2.73 3.87-.56L8 1.75Z" />
                    </svg>
                  ) : (
                    <svg
                      aria-hidden="true"
                      className="page-tree-icon-svg"
                      focusable="false"
                      viewBox="0 0 16 16"
                    >
                      <rect height="10.5" rx="1.25" width="9.5" x="3.25" y="2.75" />
                      <path d="M5.5 5.75h5M5.5 8.25h5M5.5 10.75h3" />
                    </svg>
                  )}
                </span>
                <span className="page-tree-title">{page.title}</span>
              </NavLink>
              <div className="page-tree-actions">
                <button
                  aria-label={`Create child of ${page.title}`}
                  className="page-tree-action"
                  disabled={pendingMoveId !== null}
                  onClick={() => onCreateChild(page.id)}
                  title={`Create child of ${page.title}`}
                  type="button"
                >
                  +
                </button>
              </div>
            </div>
            {!isCollapsed ? (
              <PageTreeBranch
                childrenMap={childrenMap}
                collapsedIds={collapsedIds}
                draggingPageId={draggingPageId}
                onCreateChild={onCreateChild}
                onDragEnd={onDragEnd}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onToggle={onToggle}
                pendingMoveId={pendingMoveId}
                dropTarget={dropTarget}
                parentId={page.id}
                visited={nextVisited}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export interface PageTreeProps {
  onCreateChild: (parentId: string) => void;
  onPageUpdated: (page: PageSummary) => void;
  onPagesChanged: () => Promise<void>;
  pages: PageSummary[];
}

export function PageTree({ onCreateChild, onPageUpdated, onPagesChanged, pages }: PageTreeProps) {
  const childrenMap = useMemo(() => createChildrenMap(pages), [pages]);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set());
  const [draggingPageId, setDraggingPageId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    pageId: string;
    placement: DropPlacement;
  } | null>(null);
  const [pendingMoveId, setPendingMoveId] = useState<string | null>(null);
  const [treeError, setTreeError] = useState<string | null>(null);

  useEffect(() => {
    const pageIds = new Set(pages.map((page) => page.id));
    setCollapsedIds((current) => {
      const next = new Set([...current].filter((id) => pageIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [pages]);

  async function handleMove(pageId: string, input: MovePageRequest) {
    setPendingMoveId(pageId);
    setTreeError(null);
    try {
      const response = await movePageRequest(pageId, input);
      onPageUpdated(response.page);
      await onPagesChanged();
      return true;
    } catch (requestError) {
      setTreeError(pageErrorMessage(requestError, 'The page could not be moved.'));
      return false;
    } finally {
      setPendingMoveId(null);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, page: PageSummary) {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('button, input, select')) {
      event.preventDefault();
      return;
    }

    setTreeError(null);
    setDraggingPageId(page.id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', page.id);
  }

  function handleDragOver(event: DragEvent<HTMLElement>, page: PageSummary) {
    const sourceId = draggingPageId ?? event.dataTransfer.getData('text/plain');
    if (!sourceId || sourceId === page.id) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ pageId: page.id, placement: dropPlacement(event) });
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) {
      return;
    }
    setDropTarget(null);
  }

  function handleDrop(event: DragEvent<HTMLElement>, page: PageSummary) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggingPageId ?? event.dataTransfer.getData('text/plain');
    const placement = dropTarget?.pageId === page.id ? dropTarget.placement : dropPlacement(event);
    setDropTarget(null);
    setDraggingPageId(null);

    if (!sourceId || sourceId === page.id) {
      return;
    }

    if (descendantsOf(sourceId, pages).has(page.id)) {
      setTreeError('A page cannot be moved into itself or one of its child pages.');
      return;
    }

    void handleMove(sourceId, moveRequestForDrop(page, placement));
  }

  function handleDragEnd() {
    setDraggingPageId(null);
    setDropTarget(null);
  }

  return (
    <nav aria-label="Pages" className="page-tree">
      {treeError && pendingMoveId === null ? (
        <p className="page-tree-error" role="alert">
          {treeError}
        </p>
      ) : null}
      <PageTreeBranch
        childrenMap={childrenMap}
        collapsedIds={collapsedIds}
        draggingPageId={draggingPageId}
        onCreateChild={onCreateChild}
        onDragEnd={handleDragEnd}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDragStart={handleDragStart}
        onDrop={handleDrop}
        onToggle={(pageId) => {
          setCollapsedIds((current) => {
            const next = new Set(current);
            if (next.has(pageId)) {
              next.delete(pageId);
            } else {
              next.add(pageId);
            }
            return next;
          });
        }}
        pendingMoveId={pendingMoveId}
        dropTarget={dropTarget}
        parentId={ROOT_PARENT}
        visited={new Set()}
      />
    </nav>
  );
}
