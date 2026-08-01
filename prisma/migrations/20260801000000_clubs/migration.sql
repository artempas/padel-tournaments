-- ############################################################################
-- Клубы.
--
-- Меняется ось, по которой разложены данные: не «чей это аккаунт», а «какого
-- клуба это ростер». `people.owner_id` и `tournaments.owner_id` заменяются на
-- `club_id`, а права переезжают в отдельную таблицу `club_members`.
--
-- Перенос без потерь: каждому существующему пользователю заводится личный
-- клуб, он же его владелец, и туда уезжают все его игроки и турниры. Состояния
-- «у пользователя нет клуба» после этой миграции не бывает — при регистрации
-- клуб создаётся тем же кодом, что и здесь (см. lib/clubs.ts).
--
-- Postgres выполняет DDL транзакционно, и Prisma гоняет файл одной
-- транзакцией: при любой ошибке база останется в прежнем состоянии.
-- ############################################################################

-- Нормализация имён — та же, что в normalizeKey() из src/lib/normalize.ts.
-- Нужна, чтобы найти владельца среди уже заведённых игроков его ростера.
CREATE FUNCTION v2_norm(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(btrim(value), '\s+', ' ', 'g'))
$$;

-- ---- Вью уезжают с дороги --------------------------------------------------
-- Обе читают колонки, которых после переноса не станет: person_career берёт
-- people.owner_id, tournament_overview развернула t.* ещё при создании.
-- Пересоздаются в конце файла.

DROP VIEW person_career;
DROP VIEW tournament_overview;

-- CreateEnum
CREATE TYPE "club_role" AS ENUM ('member', 'admin', 'owner');

-- CreateTable
CREATE TABLE "clubs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clubs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "club_members" (
    "club_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "club_role" NOT NULL DEFAULT 'member',
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_members_pkey" PRIMARY KEY ("club_id","user_id")
);

-- CreateTable
CREATE TABLE "club_invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "club_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "created_by_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "club_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "club_members_user_id_idx" ON "club_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "club_invites_token_hash_key" ON "club_invites"("token_hash");

-- CreateIndex
CREATE INDEX "club_invites_club_id_idx" ON "club_invites"("club_id");

-- CreateIndex
CREATE INDEX "club_invites_expires_at_idx" ON "club_invites"("expires_at");

-- AddForeignKey
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_members" ADD CONSTRAINT "club_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_invites" ADD CONSTRAINT "club_invites_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "club_invites" ADD CONSTRAINT "club_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
-- Колонки добавляются пустыми: заполнить их можно только после того, как
-- клубы появятся, а NOT NULL и индексы навешиваются в конце файла.
ALTER TABLE "people" ADD COLUMN "club_id" UUID;
ALTER TABLE "tournaments" ADD COLUMN "club_id" UUID,
                          ADD COLUMN "created_by_id" UUID;

-- ---- CHECK-ограничения -----------------------------------------------------

ALTER TABLE "clubs"
  ADD CONSTRAINT clubs_name_len CHECK (length(btrim(name)) BETWEEN 1 AND 40),
  -- Не один символ: эмодзи вроде 👨‍👩‍👧 склеено из нескольких кодовых точек,
  -- и length() считает именно их. Набор допустимых значков держит TS.
  ADD CONSTRAINT clubs_icon_len CHECK (length(icon) BETWEEN 1 AND 16),
  -- Список повторён в CLUB_COLORS из src/lib/clubs.ts и в @theme globals.css:
  -- цвет — это имя css-переменной, и выдумать его на стороне нельзя.
  ADD CONSTRAINT clubs_color_known
    CHECK (color IN ('lime', 'sky', 'violet', 'amber', 'rose', 'teal'));

ALTER TABLE "club_invites"
  ADD CONSTRAINT club_invites_expires_after_created CHECK (expires_at > created_at);

-- ---- updated_at ------------------------------------------------------------

CREATE TRIGGER clubs_touch BEFORE UPDATE ON "clubs"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---- «Участник клуба — это всегда игрок клуба» -----------------------------
--
-- Связь одна и лежит в people.user_id; здесь проверяется, что она и членство
-- существуют вместе. Оба направления настоящие:
--
--   участник без игрока  — некому вести статистику и нечего показать
--                          в «моём профиле»;
--   игрок с аккаунтом, но без членства — клуб видел бы аккаунт человека,
--                          который из клуба вышел.
--
-- Это утверждение про строки соседней таблицы, ограничением его не выразить.
-- Триггер отложен до COMMIT, поэтому вступление в клуб (строка членства плюс
-- привязка игрока) проходит одной транзакцией в любом порядке.

CREATE FUNCTION assert_membership_pair(club uuid, account uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  is_member  boolean;
  has_player boolean;
BEGIN
  IF club IS NULL OR account IS NULL THEN
    RETURN;
  END IF;

  -- Клуб или аккаунт снесли целиком — обе стороны связи уехали каскадом,
  -- проверять нечего.
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = club)
     OR NOT EXISTS (SELECT 1 FROM users WHERE id = account) THEN
    RETURN;
  END IF;

  SELECT EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = club AND m.user_id = account),
         EXISTS (SELECT 1 FROM people p WHERE p.club_id = club AND p.user_id = account)
    INTO is_member, has_player;

  IF is_member AND NOT has_player THEN
    RAISE EXCEPTION 'Участник % клуба % не связан с игроком', account, club;
  END IF;

  IF has_player AND NOT is_member THEN
    RAISE EXCEPTION 'Игрок клуба % связан с аккаунтом %, который в клубе не состоит', club, account;
  END IF;
END $$;

-- Одна функция на оба триггера: в club_members и people интересующая пара
-- колонок называется одинаково.
CREATE FUNCTION assert_membership_matches_player() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    PERFORM assert_membership_pair(OLD.club_id, OLD.user_id);
  END IF;
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_membership_pair(NEW.club_id, NEW.user_id);
  END IF;
  RETURN NULL;
END $$;

-- ---- «В клубе ровно один владелец» -----------------------------------------
-- Владение — это роль в club_members, отдельной колонки у клуба нет: иначе
-- было бы два источника правды об одном и том же. Отложенность нужна для
-- передачи владения — она меняет две строки, и между ними владельцев двое.

CREATE FUNCTION assert_club_has_one_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  owners int;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target := OLD.club_id;
  ELSE
    target := NEW.club_id;
  END IF;

  -- Клуб удалили целиком — участников не осталось намеренно.
  IF NOT EXISTS (SELECT 1 FROM clubs WHERE id = target) THEN
    RETURN NULL;
  END IF;

  SELECT count(*) INTO owners
    FROM club_members WHERE club_id = target AND role = 'owner';

  IF owners <> 1 THEN
    RAISE EXCEPTION 'В клубе % должен быть ровно один владелец, найдено %', target, owners;
  END IF;
  RETURN NULL;
END $$;

-- Сами триггеры вешаются в конце файла, после переноса: отложенное событие на
-- people не даёт выполнить ALTER TABLE этой же таблицы («pending trigger
-- events»), а перенос как раз меняет ей колонки. Перенесённые данные вместо
-- триггеров проверяет явный блок — там же, где триггеры и появляются.

-- ############################################################################
-- Перенос данных
-- ############################################################################

-- id клуба нужен раньше, чем клуб вставлен: по нему связываются ростер,
-- турниры и членство. INSERT ... SELECT с RETURNING не сказал бы, какая
-- строка чьему пользователю досталась.
CREATE TEMP TABLE club_seed AS
SELECT u.id                AS user_id,
       gen_random_uuid()   AS club_id,
       -- Имя игрока для владельца: display_name допускает 80 символов, а
       -- people.name — сорок. Пробелы схлопываются, потому что дальше это имя
       -- показывается как есть, а v2_norm всё равно схлопнет их в ключе.
       left(regexp_replace(btrim(u.display_name), '\s+', ' ', 'g'), 40) AS player_name,
       -- «Клуб Артём» — не идеальная грамматика, зато однозначно и не требует
       -- склонения. Переименовать клуб владелец может в любой момент.
       left('Клуб ' || regexp_replace(btrim(u.display_name), '\s+', ' ', 'g'), 40) AS club_name
  FROM users u;

INSERT INTO clubs (id, name, icon, color)
SELECT club_id, club_name, '🎾', 'lime' FROM club_seed;

INSERT INTO club_members (club_id, user_id, role)
SELECT club_id, user_id, 'owner' FROM club_seed;

UPDATE people p
   SET club_id = s.club_id
  FROM club_seed s
 WHERE s.user_id = p.owner_id;

-- created_by_id — прежний владелец: он и завёл эти турниры.
UPDATE tournaments t
   SET club_id = s.club_id, created_by_id = t.owner_id
  FROM club_seed s
 WHERE s.user_id = t.owner_id;

-- Владелец клуба обязан быть игроком своего клуба. Обычно он уже там —
-- организатор вводит себя в состав первым же турниром, — и тогда достаточно
-- узнать его по имени.
--
-- archived_at снимается заодно: участник клуба, спрятанный из собственного
-- ростера, — то самое состояние, которое запрещает archivePerson().
UPDATE people p
   SET user_id = s.user_id, archived_at = NULL
  FROM club_seed s
 WHERE p.club_id = s.club_id
   AND p.name_key = v2_norm(s.player_name)
   AND p.user_id IS NULL;

-- ############################################################################
-- Старая ось убирается
--
-- DROP COLUMN уносит с собой всё, что на колонку опиралось: внешние ключи
-- people_owner_id_fkey и tournaments_owner_id_fkey, уникальность
-- people_owner_id_name_key_key и индексы по owner_id.
-- ############################################################################

ALTER TABLE "people"      ALTER COLUMN "club_id" SET NOT NULL;
ALTER TABLE "tournaments" ALTER COLUMN "club_id" SET NOT NULL;

ALTER TABLE "people"      DROP COLUMN "owner_id";
ALTER TABLE "tournaments" DROP COLUMN "owner_id";

-- Владельцы, которых в ростере не нашлось, — так бывает у того, кто турниры
-- только организовывал. Заводим им игрока.
--
-- Идёт после DROP COLUMN намеренно: пока owner_id на месте, он NOT NULL, и
-- вставке пришлось бы заполнять колонку, которую эта же миграция уносит.
-- Конфликта по (club_id, name_key) быть не может: существуй игрок с таким
-- ключом, его бы забрал предыдущий UPDATE.
INSERT INTO people (club_id, name, name_key, user_id)
SELECT s.club_id, s.player_name, v2_norm(s.player_name), s.user_id
  FROM club_seed s
 WHERE NOT EXISTS (
   SELECT 1 FROM people p WHERE p.club_id = s.club_id AND p.user_id = s.user_id
 );

-- CreateIndex
CREATE INDEX "people_club_id_name_idx" ON "people"("club_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "people_club_id_name_key_key" ON "people"("club_id", "name_key");

-- CreateIndex
-- NULL в Postgres по умолчанию различны, поэтому анонимных игроков в клубе
-- сколько угодно, а назвать себя дважды нельзя.
CREATE UNIQUE INDEX "people_club_id_user_id_key" ON "people"("club_id", "user_id");

-- CreateIndex
CREATE INDEX "tournaments_club_id_created_at_idx" ON "tournaments"("club_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_club_id_fkey" FOREIGN KEY ("club_id") REFERENCES "clubs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Проверка перенесённого и включение триггеров ---------------------------
-- Триггеры не сторожили перенос (см. выше), поэтому то же самое проверяется
-- здесь — до того, как они встанут на охрану. Упасть с внятным текстом лучше,
-- чем оставить клуб без владельца или участника без игрока.

DO $$
DECLARE
  bad int;
BEGIN
  SELECT count(*) INTO bad FROM (
    SELECT club_id FROM club_members WHERE role = 'owner' GROUP BY club_id HAVING count(*) <> 1
  ) AS wrong;
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос сломан: у % клубов не один владелец', bad;
  END IF;

  SELECT count(*) INTO bad FROM clubs c
   WHERE NOT EXISTS (SELECT 1 FROM club_members m WHERE m.club_id = c.id AND m.role = 'owner');
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос сломан: % клубов остались без владельца', bad;
  END IF;

  SELECT count(*) INTO bad FROM club_members m
   WHERE NOT EXISTS (
     SELECT 1 FROM people p WHERE p.club_id = m.club_id AND p.user_id = m.user_id
   );
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос сломан: % участников не связаны с игроком', bad;
  END IF;

  SELECT count(*) INTO bad FROM people p
   WHERE p.user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM club_members m WHERE m.club_id = p.club_id AND m.user_id = p.user_id
     );
  IF bad > 0 THEN
    RAISE EXCEPTION 'Перенос сломан: % игроков связаны с не-участниками', bad;
  END IF;

  RAISE NOTICE 'Клубы: %, участников: %', (SELECT count(*) FROM clubs),
                                          (SELECT count(*) FROM club_members);
END $$;

CREATE CONSTRAINT TRIGGER club_members_have_player
  AFTER INSERT OR UPDATE OR DELETE ON "club_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_membership_matches_player();

-- Срабатывает на каждой строке people, но у анонимного игрока user_id пуст,
-- и функция выходит первой же проверкой — создание турнира этого не заметит.
CREATE CONSTRAINT TRIGGER people_link_is_member
  AFTER INSERT OR UPDATE OR DELETE ON "people"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_membership_matches_player();

CREATE CONSTRAINT TRIGGER club_members_single_owner
  AFTER INSERT OR UPDATE OR DELETE ON "club_members"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_club_has_one_owner();

-- ---- Вью возвращаются ------------------------------------------------------

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

-- Сводка по человеку за всё время. user_id здесь затем, чтобы «мой профиль в
-- клубе» доставался одним запросом, без второго похода за своим игроком.
CREATE VIEW person_career AS
SELECT p.id                                                     AS person_id,
       p.club_id,
       p.user_id,
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
 GROUP BY p.id, p.club_id, p.user_id, p.name, p.archived_at;

DROP TABLE club_seed;
DROP FUNCTION v2_norm(text);
