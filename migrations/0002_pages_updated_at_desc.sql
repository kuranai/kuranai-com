DROP INDEX `pages_updated_at`;--> statement-breakpoint
CREATE INDEX `pages_updated_at` ON `pages` ("updated_at" desc);
