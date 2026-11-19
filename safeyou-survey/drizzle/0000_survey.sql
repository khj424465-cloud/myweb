CREATE TABLE survey (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  revision TEXT NOT NULL,
  updated TEXT NOT NULL,
  sent_at TEXT
);
--> statement-breakpoint
CREATE INDEX survey_owner_updated ON survey(owner, updated);
--> statement-breakpoint
CREATE TABLE evidence (
  survey_id TEXT NOT NULL REFERENCES survey(id) ON DELETE CASCADE,
  slot TEXT NOT NULL,
  idx INTEGER NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(survey_id, slot, idx)
);
