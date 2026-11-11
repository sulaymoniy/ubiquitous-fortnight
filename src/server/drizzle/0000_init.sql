CREATE TABLE `agent_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`profile_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_items` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_items_conversation_idx` ON `agent_items` (`conversation_id`,`seq`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL,
	`stop_reason` text,
	`usage` text,
	`created_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_runs_conversation_idx` ON `agent_runs` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`parent_id` text,
	`type` text NOT NULL,
	`position` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `blocks_page_idx` ON `blocks` (`page_id`,`parent_id`,`position`);--> statement-breakpoint
CREATE TABLE `changesets` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`label` text NOT NULL,
	`agent_run_id` text,
	`tool_use_id` text,
	`ops` text NOT NULL,
	`inverse` text NOT NULL,
	`created_at` text NOT NULL,
	`undone_at` text
);
--> statement-breakpoint
CREATE INDEX `changesets_created_idx` ON `changesets` (`created_at`);--> statement-breakpoint
CREATE INDEX `changesets_run_idx` ON `changesets` (`agent_run_id`);--> statement-breakpoint
CREATE TABLE `databases` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`title_property_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`database_id` text,
	`title` text DEFAULT '' NOT NULL,
	`icon` text,
	`cover` text,
	`position` text NOT NULL,
	`properties` text,
	`archived_at` text,
	`version` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `pages_parent_idx` ON `pages` (`parent_id`,`position`);--> statement-breakpoint
CREATE INDEX `pages_database_idx` ON `pages` (`database_id`,`kind`,`position`);--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`position` text NOT NULL,
	`config` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `databases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `properties_database_idx` ON `properties` (`database_id`,`position`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`database_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`position` text NOT NULL,
	`config` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`database_id`) REFERENCES `databases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `views_database_idx` ON `views` (`database_id`,`position`);--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`settings` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
