# Automatically synchronize existing public snapshots

An initial publish is still explicit, but every successful private title, content, or revision
restore mutation for an already published page synchronously refreshes its sanitized public
snapshot while preserving the existing `public_id`. This keeps private data isolated behind the
snapshot boundary while matching the editor’s expectation that public pages stay current without a
second publish action; unpublish remains explicit and restoring a deleted page does not republish it.
