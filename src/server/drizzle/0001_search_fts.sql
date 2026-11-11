-- Full-text search index (FTS5). One row per page or row: title plus the plain text of its
-- blocks. Maintained by the server in the same transaction as each change (C-002).
CREATE VIRTUAL TABLE `search_index` USING fts5(
	`entity_id` UNINDEXED,
	`kind` UNINDEXED,
	`title`,
	`body`,
	tokenize = 'unicode61 remove_diacritics 2'
);
