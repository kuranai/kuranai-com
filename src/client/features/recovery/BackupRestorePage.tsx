import { useRef, useState, type ChangeEvent } from 'react';
import { Link, useOutletContext } from 'react-router-dom';

import {
  canonicalJson,
  sha256Hex,
  type BackupPageRecord,
  type BackupPublicationRecord,
  type BackupRevisionRecord,
  type BackupTagRecord,
  type BackupTemplateRecord,
  type BackupDailyNoteRecord,
  type RestoreSessionStatus,
} from '../../../shared/backup';
import type { WorkspaceOutletContext } from '../../app/App';
import { pageErrorMessage } from '../pages/api';
import {
  abortRestoreSession,
  createRestoreSession,
  downloadDovariBackup,
  fetchRestoreSession,
  finalizeRestoreSession,
  uploadRestoreAsset,
  uploadRestoreRecordWithChecksum,
} from './backupApi';
import {
  BackupArchiveError,
  validateBackupArchive,
  type ValidatedBackupArchive,
} from './backupArchive';

const RESTORE_SESSION_STORAGE_KEY = 'dovari-restore-session';

interface StoredRestoreSession {
  fileName: string;
  fileSize: number;
  lastModified: number;
  manifestSha256: string;
  sessionId: string;
}

type RestorePhase = 'idle' | 'validating' | 'ready' | 'uploading' | 'success' | 'aborted' | 'error';

function fileMatchesStoredSession(
  file: File,
  stored: StoredRestoreSession,
  manifestSha256: string,
) {
  return (
    stored.fileName === file.name &&
    stored.fileSize === file.size &&
    stored.lastModified === file.lastModified &&
    stored.manifestSha256 === manifestSha256
  );
}

function readStoredSession() {
  try {
    const value = JSON.parse(
      localStorage.getItem(RESTORE_SESSION_STORAGE_KEY) ?? 'null',
    ) as unknown;
    if (typeof value !== 'object' || value === null) {
      return null;
    }
    const record = value as Partial<StoredRestoreSession>;
    return typeof record.sessionId === 'string' &&
      typeof record.fileName === 'string' &&
      typeof record.fileSize === 'number' &&
      typeof record.lastModified === 'number' &&
      typeof record.manifestSha256 === 'string'
      ? (record as StoredRestoreSession)
      : null;
  } catch {
    return null;
  }
}

function storeSession(file: File, manifestSha256: string, sessionId: string) {
  const value: StoredRestoreSession = {
    fileName: file.name,
    fileSize: file.size,
    lastModified: file.lastModified,
    manifestSha256,
    sessionId,
  };
  localStorage.setItem(RESTORE_SESSION_STORAGE_KEY, JSON.stringify(value));
}

function clearStoredSession() {
  localStorage.removeItem(RESTORE_SESSION_STORAGE_KEY);
}

function recordWorkBytes(archive: ValidatedBackupArchive) {
  const encoder = new TextEncoder();
  const publications = archive.manifest.version === 2 ? archive.manifest.publications : [];
  return [
    ...archive.manifest.tags,
    ...archive.manifest.pages,
    ...archive.manifest.revisions,
    ...publications,
    ...(archive.manifest.version === 2 ? archive.manifest.templates : []),
    ...(archive.manifest.version === 2 ? archive.manifest.dailyNotes : []),
  ].reduce((sum, record) => sum + encoder.encode(canonicalJson(record)).byteLength, 0);
}

function recordIdSet(
  status: RestoreSessionStatus | null,
  type: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote',
) {
  if (type === 'page') return new Set(status?.pageIds ?? []);
  if (type === 'revision') return new Set(status?.revisionIds ?? []);
  if (type === 'publication') return new Set(status?.publicationIds ?? []);
  if (type === 'tag') return new Set(status?.tagIds ?? []);
  if (type === 'template') return new Set(status?.templateIds ?? []);
  return new Set(status?.dailyNoteIds ?? []);
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

export function BackupRestorePage() {
  const { refreshPages } = useOutletContext<WorkspaceOutletContext>();
  const [phase, setPhase] = useState<RestorePhase>('idle');
  const [archive, setArchive] = useState<ValidatedBackupArchive | null>(null);
  const [session, setSession] = useState<RestoreSessionStatus | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progressBytes, setProgressBytes] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const selectedFileRef = useRef<File | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    selectedFileRef.current = file;
    setPhase('validating');
    setArchive(null);
    setSession(null);
    setSessionId(null);
    setError(null);
    setSuccess(null);
    try {
      const validated = await validateBackupArchive(file);
      setArchive(validated);
      const stored = readStoredSession();
      if (stored && fileMatchesStoredSession(file, stored, validated.manifestSha256)) {
        try {
          const response = await fetchRestoreSession(stored.sessionId);
          setSessionId(stored.sessionId);
          setSession(response.session);
        } catch {
          clearStoredSession();
        }
      }
      setPhase('ready');
    } catch (cause) {
      setPhase('error');
      setError(
        cause instanceof BackupArchiveError
          ? cause.message
          : pageErrorMessage(cause, 'The backup could not be validated.'),
      );
    }
  }

  async function handleDownload() {
    if (isDownloading) return;
    setIsDownloading(true);
    setError(null);
    try {
      await downloadDovariBackup();
    } catch (cause) {
      setError(pageErrorMessage(cause, 'The backup could not be downloaded.'));
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleRestore() {
    const file = selectedFileRef.current;
    if (!archive || !file || phase === 'uploading') return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPhase('uploading');
    setError(null);
    setSuccess(null);
    const total = recordWorkBytes(archive) + archive.totalAssetBytes;
    setProgressTotal(total);
    let completed = 0;

    try {
      let currentSession = session;
      let currentSessionId = sessionId;
      if (!currentSession || !currentSessionId) {
        const response = await createRestoreSession({
          backupVersion: archive.manifest.version,
          expectedAssets: archive.manifest.assets.length,
          expectedBytes: archive.totalAssetBytes,
          expectedPages: archive.manifest.pages.length,
          expectedRevisions: archive.manifest.revisions.length,
          expectedTags: archive.manifest.tags.length,
          expectedPublications:
            archive.manifest.version === 2 ? archive.manifest.publications.length : 0,
          expectedTemplates: archive.manifest.version === 2 ? archive.manifest.templates.length : 0,
          expectedDailyNotes:
            archive.manifest.version === 2 ? archive.manifest.dailyNotes.length : 0,
        });
        currentSession = response.session;
        currentSessionId = response.session.id;
        setSession(currentSession);
        setSessionId(currentSessionId);
        storeSession(file, archive.manifestSha256, currentSessionId);
      }

      const uploadedPages = recordIdSet(currentSession, 'page');
      const uploadedRevisions = recordIdSet(currentSession, 'revision');
      const uploadedPublications = recordIdSet(currentSession, 'publication');
      const uploadedTags = recordIdSet(currentSession, 'tag');
      const uploadedTemplates = recordIdSet(currentSession, 'template');
      const uploadedDailyNotes = recordIdSet(currentSession, 'dailyNote');
      const uploadedAssets = new Set(currentSession.assetIds);
      const encoder = new TextEncoder();

      const uploadRecord = async (
        type: 'page' | 'revision' | 'publication' | 'tag' | 'template' | 'dailyNote',
        record:
          | BackupPageRecord
          | BackupRevisionRecord
          | BackupPublicationRecord
          | BackupTagRecord
          | BackupTemplateRecord
          | BackupDailyNoteRecord,
      ) => {
        const payload = canonicalJson(record);
        const bytes = encoder.encode(payload).byteLength;
        const ids =
          type === 'page'
            ? uploadedPages
            : type === 'revision'
              ? uploadedRevisions
              : type === 'publication'
                ? uploadedPublications
                : type === 'tag'
                  ? uploadedTags
                  : type === 'template'
                    ? uploadedTemplates
                    : uploadedDailyNotes;
        if (ids.has(record.id)) {
          completed += bytes;
          setProgressBytes(completed);
          return;
        }
        const checksum = await sha256Hex(payload);
        await uploadRestoreRecordWithChecksum(
          currentSessionId!,
          type,
          record,
          checksum,
          controller.signal,
        );
        ids.add(record.id);
        completed += bytes;
        setProgressBytes(completed);
      };

      for (const tag of archive.manifest.tags) {
        await uploadRecord('tag', tag);
      }
      for (const page of archive.manifest.pages) {
        await uploadRecord('page', page);
      }
      for (const revision of archive.manifest.revisions) {
        await uploadRecord('revision', revision);
      }
      if (archive.manifest.version === 2) {
        for (const publication of archive.manifest.publications) {
          await uploadRecord('publication', publication);
        }
        for (const template of archive.manifest.templates) {
          await uploadRecord('template', template);
        }
        for (const dailyNote of archive.manifest.dailyNotes) {
          await uploadRecord('dailyNote', dailyNote);
        }
      }

      for (const asset of archive.manifest.assets) {
        if (uploadedAssets.has(asset.id)) {
          completed += asset.sizeBytes;
          setProgressBytes(completed);
          continue;
        }
        const bytes = archive.entries.get(asset.path);
        if (!bytes) {
          throw new BackupArchiveError(`Asset ${asset.id} is missing from the validated archive.`);
        }
        const base = completed;
        await uploadRestoreAsset(
          currentSessionId!,
          asset,
          bytes,
          (loaded) => setProgressBytes(base + loaded),
          controller.signal,
        );
        uploadedAssets.add(asset.id);
        completed += asset.sizeBytes;
        setProgressBytes(completed);
      }

      const result = await finalizeRestoreSession(currentSessionId, controller.signal);
      clearStoredSession();
      setSession(null);
      setSessionId(null);
      setProgressBytes(total);
      setSuccess(
        `Restored ${result.pageCount} pages, ${result.revisionCount} versions, ${result.assetCount} assets, ${result.tagCount} tags, ${result.templateCount} templates, ${result.dailyNoteCount} daily notes, and ${result.publicationCount} publications.`,
      );
      setPhase('success');
      await refreshPages();
    } catch (cause) {
      if (controller.signal.aborted) {
        setPhase('aborted');
      } else {
        setPhase('error');
        setError(pageErrorMessage(cause, 'The restore could not be completed.'));
      }
    } finally {
      abortControllerRef.current = null;
    }
  }

  async function handleCancel() {
    if (isCancelling) return;
    setIsCancelling(true);
    abortControllerRef.current?.abort();
    if (sessionId) {
      try {
        await abortRestoreSession(sessionId);
      } catch (cause) {
        setError(pageErrorMessage(cause, 'The restore session could not be cancelled.'));
        setIsCancelling(false);
        return;
      }
    }
    clearStoredSession();
    setSession(null);
    setSessionId(null);
    setPhase('aborted');
    setIsCancelling(false);
  }

  const canStart =
    archive !== null && (phase === 'ready' || phase === 'error' || phase === 'aborted');
  const progressPercent =
    progressTotal === 0 ? 0 : Math.min(100, (progressBytes / progressTotal) * 100);

  return (
    <section aria-labelledby="backup-title" className="settings-page backup-page">
      <header className="settings-header">
        <div>
          <span className="state-kicker">Settings</span>
          <h1 id="backup-title">Backup &amp; restore</h1>
          <p>Take a complete Dovari backup or restore one into an empty workspace.</p>
        </div>
        <div className="settings-header-actions">
          <Link className="button button-secondary" to="/app/settings/trash">
            Trash
          </Link>
          <Link className="button button-secondary" to="/app">
            Back to pages
          </Link>
        </div>
      </header>

      <div className="backup-actions">
        <div className="backup-card">
          <h2>Create a lossless backup</h2>
          <p>
            Includes active and deleted pages, version history, hierarchy, links, and every asset.
          </p>
          <button
            className="button button-primary"
            disabled={isDownloading}
            onClick={() => void handleDownload()}
            type="button"
          >
            {isDownloading ? 'Preparing backup…' : 'Download Dovari backup'}
          </button>
        </div>
        <div className="backup-card">
          <h2>Restore into this workspace</h2>
          <p>
            Only an empty workspace can receive a backup. The archive is checked before anything is
            uploaded.
          </p>
          <label className="backup-file-picker">
            <span>Select a Dovari backup ZIP (v1 or v2)</span>
            <input
              accept=".zip,application/zip"
              onChange={(event) => void handleFileChange(event)}
              type="file"
            />
          </label>
        </div>
      </div>

      {phase === 'validating' ? (
        <p aria-live="polite" className="settings-state">
          Validating the backup locally…
        </p>
      ) : null}
      {error ? (
        <p className="page-action-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p aria-live="polite" className="backup-success" role="status">
          {success}
        </p>
      ) : null}
      {archive ? (
        <div className="backup-summary" aria-live="polite">
          <h2>Validated backup</h2>
          <dl>
            <div>
              <dt>Pages</dt>
              <dd>{archive.manifest.pages.length}</dd>
            </div>
            <div>
              <dt>Versions</dt>
              <dd>{archive.manifest.revisions.length}</dd>
            </div>
            <div>
              <dt>Assets</dt>
              <dd>{archive.manifest.assets.length}</dd>
            </div>
            <div>
              <dt>Publications</dt>
              <dd>{archive.manifest.version === 2 ? archive.manifest.publications.length : 0}</dd>
            </div>
            <div>
              <dt>Templates</dt>
              <dd>{archive.manifest.version === 2 ? archive.manifest.templates.length : 0}</dd>
            </div>
            <div>
              <dt>Daily notes</dt>
              <dd>{archive.manifest.version === 2 ? archive.manifest.dailyNotes.length : 0}</dd>
            </div>
            <div>
              <dt>Asset data</dt>
              <dd>{formatBytes(archive.totalAssetBytes)}</dd>
            </div>
          </dl>
          {session ? (
            <p className="backup-resume-note">
              An interrupted restore session was found and can continue from its received records
              and assets.
            </p>
          ) : null}
          {phase === 'uploading' ? (
            <div className="backup-progress">
              <div className="backup-progress-label">
                <span>Restoring…</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <progress aria-label="Restore progress" max={100} value={progressPercent} />
            </div>
          ) : null}
          <div className="backup-restore-actions">
            <button
              className="button button-primary"
              disabled={!canStart || isCancelling}
              onClick={() => void handleRestore()}
              type="button"
            >
              {session ? 'Resume restore' : 'Start restore'}
            </button>
            {phase === 'uploading' || session ? (
              <button
                className="button button-danger"
                disabled={isCancelling}
                onClick={() => void handleCancel()}
                type="button"
              >
                {isCancelling ? 'Cancelling…' : 'Cancel restore'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {phase === 'aborted' ? (
        <p className="settings-state">
          The restore session was cancelled. No productive data was changed.
        </p>
      ) : null}
    </section>
  );
}
