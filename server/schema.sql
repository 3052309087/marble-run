CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(24) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  skill_rating INTEGER NOT NULL DEFAULT 1000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS attempts (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 12),
  config JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','abandoned')),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, status);

CREATE TABLE IF NOT EXISTS game_results (
  id SERIAL PRIMARY KEY,
  attempt_id UUID UNIQUE NOT NULL REFERENCES attempts(id),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 12),
  time_ms INTEGER NOT NULL CHECK (time_ms > 0),
  moves INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_results_user ON game_results(user_id, level, time_ms);
