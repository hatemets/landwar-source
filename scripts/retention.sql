-- Retention report for the Monday dashboard (MARKET-STRATEGY.md section 9).
--
-- PostHog runs cookieless, so it cannot follow a player across days. This
-- reads the game archive instead. It counts signed-in players only: guests
-- are stored with a null user_id.
--
-- Definitions (BUSINESS-TEST-PLAN.md section 7):
--   activation  the start of a player's first stored game
--   D1          a game that starts 24-48 h after activation
--   D7          a game that starts 168-192 h after activation
-- A cohort row counts only players whose whole window has passed.
--
-- Run: psql "$DATABASE_URL" -f scripts/retention.sql

\echo 'Active signed-in players'
SELECT
  count(DISTINCT gp.user_id) FILTER (WHERE g.started_at > now() - interval '1 day') AS dau,
  count(DISTINCT gp.user_id) FILTER (WHERE g.started_at > now() - interval '7 days') AS wau,
  count(DISTINCT gp.user_id) FILTER (WHERE g.started_at > now() - interval '30 days') AS mau,
  count(DISTINCT g.id) FILTER (WHERE g.started_at > now() - interval '7 days') AS games_7d
FROM game_players gp
JOIN games g ON g.id = gp.game_id
WHERE gp.user_id IS NOT NULL;

\echo 'D1 and D7 by weekly activation cohort'
WITH play AS (
  SELECT DISTINCT gp.user_id, g.started_at
  FROM game_players gp
  JOIN games g ON g.id = gp.game_id
  WHERE gp.user_id IS NOT NULL
),
first_play AS (
  SELECT user_id, min(started_at) AS activated_at
  FROM play
  GROUP BY user_id
),
returns AS (
  SELECT
    f.user_id,
    f.activated_at,
    bool_or(p.started_at >= f.activated_at + interval '24 hours'
        AND p.started_at < f.activated_at + interval '48 hours') AS d1,
    bool_or(p.started_at >= f.activated_at + interval '168 hours'
        AND p.started_at < f.activated_at + interval '192 hours') AS d7
  FROM first_play f
  JOIN play p ON p.user_id = f.user_id
  GROUP BY f.user_id, f.activated_at
)
SELECT
  date_trunc('week', activated_at)::date AS cohort_week,
  count(*) AS activated,
  count(*) FILTER (WHERE activated_at < now() - interval '48 hours') AS d1_mature,
  round(100.0 * count(*) FILTER (WHERE d1 AND activated_at < now() - interval '48 hours')
    / nullif(count(*) FILTER (WHERE activated_at < now() - interval '48 hours'), 0), 1) AS d1_pct,
  count(*) FILTER (WHERE activated_at < now() - interval '192 hours') AS d7_mature,
  round(100.0 * count(*) FILTER (WHERE d7 AND activated_at < now() - interval '192 hours')
    / nullif(count(*) FILTER (WHERE activated_at < now() - interval '192 hours'), 0), 1) AS d7_pct
FROM returns
GROUP BY 1
ORDER BY 1 DESC;

\echo 'Games per day by type, last 14 days'
SELECT
  g.started_at::date AS day,
  count(*) FILTER (WHERE g.game_type = 'Singleplayer') AS solo,
  count(*) FILTER (WHERE g.game_type = 'Public' AND g.ranked_type IS NULL) AS public,
  count(*) FILTER (WHERE g.game_type = 'Private') AS private,
  count(*) FILTER (WHERE g.ranked_type IS NOT NULL) AS ranked
FROM games g
WHERE g.started_at > now() - interval '14 days'
GROUP BY 1
ORDER BY 1 DESC;
