CREATE TABLE sales_account (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE sales_session (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES sales_account(id) ON DELETE CASCADE,
  expires INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sales_session_expires ON sales_session(expires);
--> statement-breakpoint
CREATE TABLE sales_throttle (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX sales_throttle_reset_at ON sales_throttle(reset_at);
