# Publish pages as public subtrees

Sharing a page publishes that page and every active descendant as independent snapshot records in one atomic D1 batch. Republish keeps each existing public ID stable, while unpublish or moving the category root to Trash removes the inherited descendant publications together; a child can still be published on its own as a separate public root. This keeps the public API snapshot-only and models public/private categories without adding a live-visibility column or exposing private page relationships.
