-- Search index v2 (C-002): one row per page or row title (block_id NULL) and one row per block
-- with text, so results can point at the matching block and title matches rank first.
-- The index is derived data; the server rebuilds it when it is empty.
DROP TABLE IF EXISTS `search_index`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `search_index` USING fts5(
	`page_id` UNINDEXED,
	`block_id` UNINDEXED,
	`kind` UNINDEXED,
	`database_id` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
