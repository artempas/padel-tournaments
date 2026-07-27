-- ############################################################################
-- Mexicano: длина турнира в раундах.
--
-- Американо знает своё расписание заранее — «каждый с каждым» задаёт и число
-- матчей, и число раундов. У mexicano такого условия нет: следующий раунд
-- собирается по текущей таблице, поэтому конец турнира должен назначить
-- организатор. Отсюда колонка, которая осмысленна ровно для одного формата.
-- ############################################################################

-- AlterTable
ALTER TABLE "tournaments" ADD COLUMN "rounds_planned" SMALLINT;

-- Турниров mexicano приложение до сих пор не создавало, но значение enum
-- существовало с самого начала, и строка с ним могла приехать из v1. Такой
-- строке длина берётся из уже сыгранного, иначе следующий CHECK её не пропустит.
UPDATE "tournaments" t
   SET "rounds_planned" = least(30, greatest(1, coalesce(
         (SELECT max(m.round_no) FROM "matches" m WHERE m.tournament_id = t.id), 1)))
 WHERE t.format = 'mexicano' AND t.rounds_planned IS NULL;

ALTER TABLE "tournaments"
  ADD CONSTRAINT tournaments_rounds_planned_range
    CHECK (rounds_planned IS NULL OR rounds_planned BETWEEN 1 AND 30),
  -- Ровно у mexicano и ровно у него одного: американо с назначенной длиной
  -- или mexicano без неё одинаково бессмысленны.
  ADD CONSTRAINT tournaments_rounds_planned_format
    CHECK ((format = 'mexicano') = (rounds_planned IS NOT NULL));

-- ---- Вью пересоздаётся ради t.* --------------------------------------------
-- Звёздочка в определении вью разворачивается в список колонок один раз, при
-- создании. Без пересоздания rounds_planned в tournament_overview не появится,
-- и список турниров не сможет показать прогресс mexicano.

DROP VIEW tournament_overview;

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
