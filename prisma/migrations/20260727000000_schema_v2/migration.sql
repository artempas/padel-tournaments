-- ############################################################################
-- Схема v2 + перенос данных из v1.
--
-- Стратегия: старые таблицы уезжают в схему v1 (данные не копируются, это
-- переименование), рядом создаётся чистая v2, данные переливаются INSERT-SELECT,
-- схема v1 удаляется. Так имена индексов и ограничений получаются ровно те,
-- которых ждёт Prisma, — переименование таблиц на месте их бы не изменило.
--
-- Postgres выполняет DDL транзакционно, и Prisma гоняет файл миграции одной
-- транзакцией: при любой ошибке база останется в состоянии v1.
--
-- На проде, где v1 уже стоит, baseline-миграцию надо отметить применённой,
-- не выполняя её:
--   npx prisma migrate resolve --applied 20260726000000_baseline_v1
--   npx prisma migrate deploy
-- ############################################################################

-- ---- Убираем v1 с дороги ---------------------------------------------------

CREATE SCHEMA v1;

ALTER TABLE users               SET SCHEMA v1;
ALTER TABLE credentials         SET SCHEMA v1;
ALTER TABLE webauthn_challenges SET SCHEMA v1;
ALTER TABLE sessions            SET SCHEMA v1;
ALTER TABLE roster_players      SET SCHEMA v1;
ALTER TABLE tournaments         SET SCHEMA v1;
ALTER TABLE players             SET SCHEMA v1;
ALTER TABLE matches             SET SCHEMA v1;

-- Нормализация имён должна совпадать с normalizeKey() из src/lib/normalize.ts:
-- обрезать края, схлопнуть пробелы, привести к нижнему регистру.
CREATE FUNCTION v1_norm(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
$$;

-- ---- Проверки до переноса --------------------------------------------------
-- v2 добавляет ограничения, которых в v1 не было. Данные, накопленные без них,
-- могут их не пройти. Лучше упасть здесь с внятным текстом, чем на середине
-- переливки с сообщением про нарушение constraint.

DO $$
DECLARE
  bad   int;
  detail text;
BEGIN
  -- 1. Имена пользователей, которые новая нормализация схлопывает в одно.
  SELECT count(*) INTO bad FROM (
    SELECT v1_norm(username) FROM v1.users GROUP BY 1 HAVING count(*) > 1
  ) AS dup;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос невозможен: % имён пользователей совпадают после нормализации. Переименуйте их в v1.users и повторите.', bad;
  END IF;

  -- 2. То же внутри ростера одного организатора.
  SELECT count(*) INTO bad FROM (
    SELECT owner_id, v1_norm(name) FROM v1.roster_players GROUP BY 1, 2 HAVING count(*) > 1
  ) AS dup;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос невозможен: % имён в ростерах совпадают после нормализации. Объедините дубли в v1.roster_players и повторите.', bad;
  END IF;

  -- 3. Два участника одного турнира, схлопывающиеся в одного человека:
  --    в v2 это запрещено UNIQUE (tournament_id, person_id).
  SELECT count(*) INTO bad FROM (
    SELECT p.tournament_id, coalesce(p.roster_player_id::text, v1_norm(p.name))
      FROM v1.players p GROUP BY 1, 2 HAVING count(*) > 1
  ) AS dup;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос невозможен: в % турнирах один человек занимает два места.', bad;
  END IF;

  -- 4. Сумма очков расходится с нормой турнира — в v2 это CHECK matches_score_sum.
  SELECT count(*) INTO bad
    FROM v1.matches m JOIN v1.tournaments t ON t.id = m.tournament_id
   WHERE m.score1 IS NOT NULL AND m.score1 + m.score2 <> t.points_per_match;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос невозможен: у % матчей сумма очков не равна норме турнира.', bad;
  END IF;

  -- 5. Игрок на двух кортах в одном раунде — в v2 это UNIQUE по раунду.
  SELECT count(*) INTO bad FROM (
    SELECT m.tournament_id, m.round_no, v.player_id
      FROM v1.matches m
      CROSS JOIN LATERAL (VALUES (m.team1_p1), (m.team1_p2), (m.team2_p1), (m.team2_p2))
        AS v(player_id)
     GROUP BY 1, 2, 3 HAVING count(*) > 1
  ) AS dup;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос невозможен: % раз игрок занят на двух кортах в одном раунде.', bad;
  END IF;

  SELECT format('%s пользователей, %s турниров, %s матчей',
                (SELECT count(*) FROM v1.users),
                (SELECT count(*) FROM v1.tournaments),
                (SELECT count(*) FROM v1.matches))
    INTO detail;
  RAISE NOTICE 'Проверки пройдены, переношу: %', detail;
END $$;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tournament_format" AS ENUM ('americano', 'mexicano', 'team_americano');

-- CreateEnum
CREATE TYPE "match_side" AS ENUM ('a', 'b');

-- CreateEnum
CREATE TYPE "challenge_kind" AS ENUM ('registration', 'authentication');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" TEXT NOT NULL,
    "username_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credentials" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_challenges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "challenge" TEXT NOT NULL,
    "kind" "challenge_kind" NOT NULL,
    "user_id" UUID,
    "username" TEXT,
    "user_handle" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "token_hash" BYTEA NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "user_id" UUID,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "format" "tournament_format" NOT NULL DEFAULT 'americano',
    "courts" SMALLINT NOT NULL,
    "points_per_match" SMALLINT NOT NULL,
    "completed_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_players" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tournament_id" UUID NOT NULL,
    "person_id" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,

    CONSTRAINT "tournament_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tournament_id" UUID NOT NULL,
    "round_no" SMALLINT NOT NULL,
    "court_no" SMALLINT NOT NULL,
    "points_sum" SMALLINT,
    "score_a" SMALLINT,
    "score_b" SMALLINT,
    "played_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "match_id" UUID NOT NULL,
    "round_no" SMALLINT NOT NULL,
    "tournament_id" UUID NOT NULL,
    "tournament_player_id" UUID NOT NULL,
    "side" "match_side" NOT NULL,
    "slot" SMALLINT NOT NULL,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("match_id","tournament_player_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key_key" ON "users"("username_key");

-- CreateIndex
CREATE INDEX "credentials_user_id_idx" ON "credentials"("user_id");

-- CreateIndex
CREATE INDEX "webauthn_challenges_expires_at_idx" ON "webauthn_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "webauthn_challenges_user_id_idx" ON "webauthn_challenges"("user_id");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "people_owner_id_name_idx" ON "people"("owner_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "people_owner_id_name_key_key" ON "people"("owner_id", "name_key");

-- CreateIndex
CREATE INDEX "tournaments_owner_id_created_at_idx" ON "tournaments"("owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "tournament_players_person_id_idx" ON "tournament_players"("person_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_players_tournament_id_seat_key" ON "tournament_players"("tournament_id", "seat");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_players_tournament_id_person_id_key" ON "tournament_players"("tournament_id", "person_id");

-- CreateIndex
CREATE UNIQUE INDEX "tournament_players_id_tournament_id_key" ON "tournament_players"("id", "tournament_id");

-- CreateIndex
CREATE UNIQUE INDEX "matches_tournament_id_round_no_court_no_key" ON "matches"("tournament_id", "round_no", "court_no");

-- CreateIndex
CREATE UNIQUE INDEX "matches_id_tournament_id_round_no_key" ON "matches"("id", "tournament_id", "round_no");

-- CreateIndex
CREATE INDEX "match_participants_tournament_player_id_idx" ON "match_participants"("tournament_player_id");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_match_id_side_slot_key" ON "match_participants"("match_id", "side", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_tournament_id_round_no_tournament_player_key" ON "match_participants"("tournament_id", "round_no", "tournament_player_id");

-- AddForeignKey
ALTER TABLE "credentials" ADD CONSTRAINT "credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_players" ADD CONSTRAINT "tournament_players_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_tournament_id_fkey" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_match_id_tournament_id_round_no_fkey" FOREIGN KEY ("match_id", "tournament_id", "round_no") REFERENCES "matches"("id", "tournament_id", "round_no") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_tournament_player_id_tournament_id_fkey" FOREIGN KEY ("tournament_player_id", "tournament_id") REFERENCES "tournament_players"("id", "tournament_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ############################################################################
-- Всё ниже написано руками: Prisma не моделирует CHECK-ограничения, триггеры
-- и вью, поэтому не создаст их и не попытается удалить как дрейф.
-- ############################################################################

-- ---- CHECK-ограничения -----------------------------------------------------

ALTER TABLE "users"
  ADD CONSTRAINT users_username_len     CHECK (length(username) BETWEEN 2 AND 32),
  ADD CONSTRAINT users_username_key_len CHECK (length(username_key) BETWEEN 2 AND 32),
  ADD CONSTRAINT users_display_name_len CHECK (length(btrim(display_name)) BETWEEN 1 AND 80);

ALTER TABLE "credentials"
  ADD CONSTRAINT credentials_counter_positive CHECK (counter >= 0),
  ADD CONSTRAINT credentials_device_type_known
    CHECK (device_type IS NULL OR device_type IN ('singleDevice', 'multiDevice'));

ALTER TABLE "people"
  ADD CONSTRAINT people_name_len     CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  ADD CONSTRAINT people_name_key_len CHECK (length(name_key) BETWEEN 1 AND 40);

ALTER TABLE "tournaments"
  ADD CONSTRAINT tournaments_name_len CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  ADD CONSTRAINT tournaments_courts_range CHECK (courts BETWEEN 1 AND 16),
  ADD CONSTRAINT tournaments_points_range CHECK (points_per_match BETWEEN 1 AND 200);

ALTER TABLE "matches"
  ADD CONSTRAINT matches_round_positive CHECK (round_no >= 1),
  ADD CONSTRAINT matches_court_positive CHECK (court_no >= 1),
  ADD CONSTRAINT matches_points_sum_positive CHECK (points_sum IS NULL OR points_sum > 0),
  ADD CONSTRAINT matches_scores_non_negative
    CHECK ((score_a IS NULL OR score_a >= 0) AND (score_b IS NULL OR score_b >= 0)),
  -- Матч либо не сыгран целиком, либо записан целиком.
  ADD CONSTRAINT matches_score_pair    CHECK ((score_a IS NULL) = (score_b IS NULL)),
  ADD CONSTRAINT matches_played_at_set CHECK ((score_a IS NULL) = (played_at IS NULL)),
  -- Инвариант «сумма очков равна норме матча». В v1 он жил только в коде,
  -- потому что норма лежит в другой таблице; копия в matches.points_sum
  -- делает его проверяемым здесь.
  ADD CONSTRAINT matches_score_sum
    CHECK (score_a IS NULL OR points_sum IS NULL OR score_a + score_b = points_sum);

ALTER TABLE "match_participants"
  ADD CONSTRAINT match_participants_slot_range CHECK (slot IN (1, 2));

-- ---- updated_at ------------------------------------------------------------
-- Владелец колонки — база, а не Prisma: так метка обновляется и при записи
-- сырым SQL, мимо клиента.

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER users_touch       BEFORE UPDATE ON "users"       FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER people_touch      BEFORE UPDATE ON "people"      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER tournaments_touch BEFORE UPDATE ON "tournaments" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- «В матче ровно четверо» -----------------------------------------------
-- Единственный инвариант формата, который нельзя выразить ограничением: он про
-- количество строк. Отложенный триггер проверяет его на COMMIT, поэтому матч
-- и его участники вставляются одной транзакцией.

CREATE FUNCTION assert_match_is_full() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  seats  int;
BEGIN
  -- Ветвление, а не CASE: в INSERT-триггере OLD не назначен, и обращение к его
  -- полю внутри выражения падает независимо от выбранной ветки.
  IF TG_OP = 'DELETE' THEN
    target := OLD.match_id;
  ELSE
    target := NEW.id;
  END IF;

  -- Матч удалили целиком — проверять нечего.
  IF NOT EXISTS (SELECT 1 FROM matches WHERE id = target) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO seats FROM match_participants WHERE match_id = target;
  IF seats <> 4 THEN
    RAISE EXCEPTION 'В матче % должно быть ровно 4 участника, найдено %', target, seats;
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER matches_seats_filled
  AFTER INSERT ON "matches"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_match_is_full();

CREATE CONSTRAINT TRIGGER match_participants_seats_kept
  AFTER DELETE ON "match_participants"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_match_is_full();

-- ---- Производные представления ---------------------------------------------
-- Ничего вычислимого не хранится: статус турнира, таблица и сводка по людям —
-- вью над общей match_results. Рассинхронизироваться нечему.

-- Результат матча глазами одного участника: база для любой статистики.
CREATE VIEW match_results AS
SELECT mp.tournament_player_id,
       mp.tournament_id,
       mp.match_id,
       m.played_at,
       CASE mp.side WHEN 'a' THEN m.score_a ELSE m.score_b END AS scored,
       CASE mp.side WHEN 'a' THEN m.score_b ELSE m.score_a END AS conceded
  FROM match_participants mp
  JOIN matches m ON m.id = mp.match_id
 WHERE m.score_a IS NOT NULL;

-- Турнир со всем производным состоянием.
--   finished_at  — LEAST игнорирует NULL, поэтому это «когда завершился впервые»
--   closed_early — метка «досрочно» видна, только пока есть недоигранное
CREATE VIEW tournament_overview AS
SELECT t.*,
       (t.completed_at IS NOT NULL OR t.closed_at IS NOT NULL)  AS is_finished,
       LEAST(t.completed_at, t.closed_at)                       AS finished_at,
       (t.closed_at IS NOT NULL AND t.completed_at IS NULL)     AS closed_early,
       c.player_count,
       c.match_count,
       c.played_count
  FROM tournaments t
  CROSS JOIN LATERAL (
    SELECT (SELECT count(*) FROM tournament_players tp WHERE tp.tournament_id = t.id),
           (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id),
           (SELECT count(*) FROM matches m WHERE m.tournament_id = t.id AND m.score_a IS NOT NULL)
  ) AS c(player_count, match_count, played_count);

-- Итоговая таблица турнира.
CREATE VIEW tournament_standings AS
SELECT tp.tournament_id,
       tp.id                                                    AS tournament_player_id,
       tp.person_id,
       p.name,
       tp.seat,
       count(r.match_id)                                        AS played,
       count(r.match_id) FILTER (WHERE r.scored >  r.conceded)  AS wins,
       count(r.match_id) FILTER (WHERE r.scored =  r.conceded)  AS draws,
       count(r.match_id) FILTER (WHERE r.scored <  r.conceded)  AS losses,
       coalesce(sum(r.scored),   0)::bigint                     AS points_for,
       coalesce(sum(r.conceded), 0)::bigint                     AS points_against,
       coalesce(sum(r.scored) - sum(r.conceded), 0)::bigint     AS diff
  FROM tournament_players tp
  JOIN people p ON p.id = tp.person_id
  LEFT JOIN match_results r ON r.tournament_player_id = tp.id
 GROUP BY tp.tournament_id, tp.id, tp.person_id, p.name, tp.seat;

-- Сводка по человеку за всё время.
CREATE VIEW person_career AS
SELECT p.id                                                     AS person_id,
       p.owner_id,
       p.name,
       p.archived_at,
       count(r.match_id)                                        AS matches,
       count(r.match_id) FILTER (WHERE r.scored >  r.conceded)  AS wins,
       count(r.match_id) FILTER (WHERE r.scored =  r.conceded)  AS draws,
       coalesce(sum(r.scored),   0)::bigint                     AS points_for,
       coalesce(sum(r.conceded), 0)::bigint                     AS points_against,
       coalesce(sum(r.scored) - sum(r.conceded), 0)::bigint     AS diff,
       count(DISTINCT r.tournament_id)                          AS tournaments,
       max(r.played_at)                                         AS last_played_at
  FROM people p
  LEFT JOIN tournament_players tp ON tp.person_id = p.id
  LEFT JOIN match_results r ON r.tournament_player_id = tp.id
 GROUP BY p.id, p.owner_id, p.name, p.archived_at;

-- ############################################################################
-- Перенос данных v1 → v2
--
-- Порядок продиктован внешними ключами. Все id сохраняются: на них ссылаются
-- уже выданные ссылки и, главное, участники матчей.
-- ############################################################################

INSERT INTO users (id, username, username_key, display_name, created_at, updated_at)
SELECT id, username, v1_norm(username), display_name, created_at, created_at
  FROM v1.users;

INSERT INTO credentials (id, user_id, public_key, counter, transports, device_type,
                         backed_up, created_at, last_used_at)
SELECT id, user_id, public_key, counter, transports, device_type,
       backed_up, created_at, last_used_at
  FROM v1.credentials;

-- Челленджи живут пять минут — переносить их бессмысленно, начатые церемонии
-- всё равно оборвутся на рестарте приложения.

-- Сессии переживают переезд: hex-строка превращается в bytea, поэтому
-- перелогинивать никого не придётся. Протухшие не тащим.
INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at)
SELECT decode(token_hash, 'hex'), user_id, created_at, created_at, expires_at
  FROM v1.sessions
 WHERE expires_at > now();

-- Ростер как он есть.
INSERT INTO people (id, owner_id, name, name_key, created_at, updated_at)
SELECT id, owner_id, name, v1_norm(name), created_at, created_at
  FROM v1.roster_players;

-- Участники, потерявшие связь с ростером: в v1 roster_player_id обнулялся при
-- удалении человека, а v2 требует person_id. Восстанавливаем людей из
-- сохранённого players.name и сразу помечаем архивными — ровно то состояние,
-- в котором они и были: в истории есть, в подсказках нет.
INSERT INTO people (owner_id, name, name_key, archived_at, created_at, updated_at)
SELECT t.owner_id,
       min(p.name),                       -- детерминированное написание
       v1_norm(p.name),
       now(), now(), now()
  FROM v1.players p
  JOIN v1.tournaments t ON t.id = p.tournament_id
 WHERE p.roster_player_id IS NULL
 GROUP BY t.owner_id, v1_norm(p.name)
    ON CONFLICT (owner_id, name_key) DO NOTHING;

INSERT INTO tournaments (id, owner_id, name, format, courts, points_per_match,
                         completed_at, closed_at, created_at, updated_at)
SELECT t.id, t.owner_id, t.name, t.format::tournament_format, t.courts, t.points_per_match,
       -- completed_at — только если счёт есть у всех матчей. finished_at из v1
       -- сохраняет исходный момент завершения, чтобы он не сдвинулся.
       CASE WHEN NOT EXISTS (
              SELECT 1 FROM v1.matches m WHERE m.tournament_id = t.id AND m.score1 IS NULL
            ) THEN coalesce(t.finished_at, t.created_at) END,
       CASE WHEN t.closed_manually THEN coalesce(t.finished_at, t.created_at) END,
       t.created_at, t.created_at
  FROM v1.tournaments t;

-- person_id берём из связи, а для сирот — по нормализованному имени в рамках
-- того же владельца. LEFT JOIN, а не подзапрос: так NOT NULL сам поймает
-- случай, когда человек почему-то не нашёлся.
INSERT INTO tournament_players (id, tournament_id, person_id, seat)
SELECT p.id, p.tournament_id, coalesce(p.roster_player_id, orphan.id), p.seat
  FROM v1.players p
  JOIN v1.tournaments t ON t.id = p.tournament_id
  LEFT JOIN people orphan
    ON orphan.owner_id = t.owner_id AND orphan.name_key = v1_norm(p.name);

INSERT INTO matches (id, tournament_id, round_no, court_no, points_sum,
                     score_a, score_b, played_at, created_at)
SELECT m.id, m.tournament_id, m.round_no, m.court_no, t.points_per_match,
       m.score1, m.score2,
       -- CHECK matches_played_at_set требует, чтобы метка и счёт появлялись
       -- вместе; в старых строках played_at мог остаться пустым.
       CASE WHEN m.score1 IS NOT NULL THEN coalesce(m.played_at, t.created_at) END,
       t.created_at
  FROM v1.matches m
  JOIN v1.tournaments t ON t.id = m.tournament_id;

-- Четыре колонки превращаются в четыре строки. Отложенный триггер «ровно
-- четверо» проверится на COMMIT, когда все они уже на месте.
INSERT INTO match_participants (match_id, tournament_id, round_no,
                                tournament_player_id, side, slot)
SELECT m.id, m.tournament_id, m.round_no, v.player_id, v.side, v.slot
  FROM v1.matches m
  CROSS JOIN LATERAL (VALUES
    (m.team1_p1, 'a'::match_side, 1::smallint),
    (m.team1_p2, 'a'::match_side, 2::smallint),
    (m.team2_p1, 'b'::match_side, 1::smallint),
    (m.team2_p2, 'b'::match_side, 2::smallint)
  ) AS v(player_id, side, slot);

DROP SCHEMA v1 CASCADE;
DROP FUNCTION v1_norm(text);
