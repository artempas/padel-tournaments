-- Existing tournaments and matches remain doubles by default.
ALTER TABLE tournaments ADD COLUMN singles_courts SMALLINT NOT NULL DEFAULT 0;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_singles_courts_range
  CHECK (singles_courts BETWEEN 0 AND courts);
ALTER TABLE matches ADD COLUMN team_size SMALLINT NOT NULL DEFAULT 2;
ALTER TABLE matches ADD CONSTRAINT matches_team_size_range CHECK (team_size IN (1, 2));

DROP TRIGGER matches_seats_filled ON matches;
DROP TRIGGER match_participants_seats_kept ON match_participants;

CREATE OR REPLACE FUNCTION assert_match_is_full() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  targets uuid[];
  target uuid;
  required_size int;
  expected_size int;
  match_court int;
  court_count int;
  seats_a int;
  seats_b int;
  max_slot int;
BEGIN
  IF TG_TABLE_NAME = 'matches' THEN
    targets := ARRAY[NEW.id];
  ELSIF TG_OP = 'DELETE' THEN
    targets := ARRAY[OLD.match_id];
  ELSIF TG_OP = 'UPDATE' THEN
    targets := ARRAY[OLD.match_id, NEW.match_id];
  ELSE
    targets := ARRAY[NEW.match_id];
  END IF;

  FOREACH target IN ARRAY targets LOOP
    SELECT m.team_size, m.court_no, t.courts,
           CASE WHEN m.court_no <= t.courts - t.singles_courts THEN 2 ELSE 1 END
      INTO required_size, match_court, court_count, expected_size
      FROM matches m JOIN tournaments t ON t.id = m.tournament_id WHERE m.id = target;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF match_court > court_count OR required_size <> expected_size THEN
      RAISE EXCEPTION 'Матч % не соответствует конфигурации корта', target;
    END IF;

    SELECT count(*) FILTER (WHERE side = 'a'), count(*) FILTER (WHERE side = 'b'), max(slot)
      INTO seats_a, seats_b, max_slot FROM match_participants WHERE match_id = target;
    IF seats_a <> required_size OR seats_b <> required_size OR max_slot > required_size THEN
      RAISE EXCEPTION 'В матче % должно быть по % участников на стороне', target, required_size;
    END IF;
  END LOOP;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER matches_seats_filled
  AFTER INSERT OR UPDATE ON matches DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_match_is_full();
CREATE CONSTRAINT TRIGGER match_participants_seats_kept
  AFTER INSERT OR UPDATE OR DELETE ON match_participants DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_match_is_full();

-- Court formats are chosen at creation and fixed once a schedule exists.
CREATE FUNCTION keep_tournament_courts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.courts, NEW.singles_courts) IS DISTINCT FROM (OLD.courts, OLD.singles_courts)
     AND EXISTS (SELECT 1 FROM matches WHERE tournament_id = OLD.id) THEN
    RAISE EXCEPTION 'Конфигурацию кортов нельзя менять после составления расписания';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tournament_courts_fixed BEFORE UPDATE OF courts, singles_courts ON tournaments
  FOR EACH ROW EXECUTE FUNCTION keep_tournament_courts();

DROP VIEW tournament_overview;
CREATE VIEW tournament_overview AS
SELECT t.*,
       (t.completed_at IS NOT NULL OR t.closed_at IS NOT NULL) AS is_finished,
       LEAST(t.completed_at, t.closed_at) AS finished_at,
       (t.closed_at IS NOT NULL AND t.completed_at IS NULL) AS closed_early,
       c.player_count, c.match_count, c.played_count
  FROM tournaments t
  CROSS JOIN LATERAL (
    SELECT (SELECT count(*) FROM tournament_players tp WHERE tp.tournament_id = t.id),
           (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id),
           (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id AND m.score_a IS NOT NULL)
  ) AS c(player_count, match_count, played_count);
