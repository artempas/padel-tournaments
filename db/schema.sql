-- Padel Tournaments — schema
-- Idempotent: safe to run repeatedly (`npm run db:migrate`).

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username      text NOT NULL,
  display_name  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Usernames are compared case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));

-- One row per registered passkey. A user may register several (phone, laptop, ...).
CREATE TABLE IF NOT EXISTS credentials (
  id             text PRIMARY KEY,               -- base64url credential ID
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key     bytea NOT NULL,
  counter        bigint NOT NULL DEFAULT 0,
  transports     text[] NOT NULL DEFAULT '{}',
  device_type    text,                           -- 'singleDevice' | 'multiDevice'
  backed_up      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);

CREATE INDEX IF NOT EXISTS credentials_user_id_idx ON credentials (user_id);

-- Server-issued WebAuthn challenges. Stored server-side (not in a cookie) so a
-- captured assertion can never be replayed against a client-chosen challenge.
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('registration', 'authentication')),
  user_id      uuid REFERENCES users(id) ON DELETE CASCADE,
  username     text,
  -- WebAuthn user handle reserved during registration; becomes users.id once
  -- the ceremony succeeds, so the authenticator's handle matches our user id.
  user_handle  uuid,
  expires_at   timestamptz NOT NULL
);

ALTER TABLE webauthn_challenges ADD COLUMN IF NOT EXISTS user_handle uuid;

CREATE INDEX IF NOT EXISTS webauthn_challenges_expires_at_idx ON webauthn_challenges (expires_at);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,                  -- sha256 of the cookie value
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS tournaments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  courts           int NOT NULL CHECK (courts BETWEEN 1 AND 16),
  format           text NOT NULL DEFAULT 'americano' CHECK (format IN ('americano')),
  points_per_match int NOT NULL DEFAULT 16 CHECK (points_per_match BETWEEN 1 AND 200),
  status           text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'finished')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz
);

CREATE INDEX IF NOT EXISTS tournaments_owner_id_idx ON tournaments (owner_id, created_at DESC);

-- Set when the organiser stops a tournament before every match is played.
-- Without it, editing a score would recompute status back to 'running'.
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS closed_manually boolean NOT NULL DEFAULT false;

-- The organiser's persistent roster. Tournament participants link back here so
-- results can be totalled across every tournament a person took part in.
CREATE TABLE IF NOT EXISTS roster_players (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Names are matched case-insensitively, so "Артём" and "артём" are one person.
CREATE UNIQUE INDEX IF NOT EXISTS roster_players_owner_name_key
  ON roster_players (owner_id, lower(name));

CREATE TABLE IF NOT EXISTS players (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           text NOT NULL,
  seat           int NOT NULL,                   -- stable 0-based entry order
  UNIQUE (tournament_id, seat)
);

CREATE INDEX IF NOT EXISTS players_tournament_id_idx ON players (tournament_id);

-- Nullable and SET NULL on delete: removing someone from the roster must not
-- erase the tournaments they already played.
ALTER TABLE players ADD COLUMN IF NOT EXISTS roster_player_id uuid
  REFERENCES roster_players(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS players_roster_player_id_idx ON players (roster_player_id);

CREATE TABLE IF NOT EXISTS matches (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round_no       int NOT NULL,                   -- 1-based
  court_no       int NOT NULL,                   -- 1-based
  team1_p1       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team1_p2       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team2_p1       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  team2_p2       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score1         int CHECK (score1 >= 0),
  score2         int CHECK (score2 >= 0),
  played_at      timestamptz,
  UNIQUE (tournament_id, round_no, court_no),
  -- a match is either fully unplayed or fully scored
  CHECK ((score1 IS NULL) = (score2 IS NULL)),
  CHECK (team1_p1 <> team1_p2 AND team1_p1 <> team2_p1 AND team1_p1 <> team2_p2
     AND team1_p2 <> team2_p1 AND team1_p2 <> team2_p2 AND team2_p1 <> team2_p2)
);

CREATE INDEX IF NOT EXISTS matches_tournament_idx ON matches (tournament_id, round_no, court_no);
