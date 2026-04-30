-- Admin RPC: list rated chat messages across all users.
--
-- Powers the /admin/ratings page. Returns paginated rows joining
-- chat_message_ratings → chat_messages → profiles (LEFT JOIN on profiles
-- so a missing profile doesn't hide the rating row). Authorization is gated
-- on is_current_user_admin(); each fetch is logged once to admin_access_log.
--
-- Filter: 'all' | 'up' | 'down'.
-- Sort: 'created_at' | 'rating' | 'user' (default created_at desc).

CREATE OR REPLACE FUNCTION public.admin_list_rated_messages(
  p_filter text DEFAULT 'all',
  p_sort text DEFAULT 'created_at',
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  rating_filter int;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    auth.uid(),
    'ratings',
    jsonb_build_object('filter', p_filter, 'sort', p_sort, 'limit', p_limit, 'offset', p_offset)
  );

  rating_filter := CASE
    WHEN p_filter = 'up' THEN 1
    WHEN p_filter = 'down' THEN -1
    ELSE NULL
  END;

  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'total', COUNT(*),
        'up', COUNT(*) FILTER (WHERE rating = 1),
        'down', COUNT(*) FILTER (WHERE rating = -1)
      )
      FROM chat_message_ratings
    ),
    'total_filtered', (
      SELECT COUNT(*) FROM chat_message_ratings r
      WHERE rating_filter IS NULL OR r.rating = rating_filter
    ),
    'ratings', COALESCE((
      SELECT jsonb_agg(row_to_jsonb(x))
      FROM (
        SELECT
          r.id              AS rating_id,
          r.rating          AS rating,
          r.created_at      AS rated_at,
          r.updated_at      AS rated_updated_at,
          r.user_id         AS user_id,
          p.email           AS user_email,
          p.full_name       AS user_full_name,
          m.id              AS message_id,
          m.question        AS question,
          m.answer          AS answer,
          m.context_type    AS context_type,
          m.context_id      AS context_id,
          m.created_at      AS message_created_at
        FROM chat_message_ratings r
        JOIN chat_messages m ON m.id = r.message_id
        LEFT JOIN profiles p ON p.id = r.user_id
        WHERE rating_filter IS NULL OR r.rating = rating_filter
        ORDER BY
          CASE WHEN p_sort = 'rating' THEN r.rating END ASC,
          CASE WHEN p_sort = 'user' THEN p.email END ASC,
          r.created_at DESC
        LIMIT p_limit OFFSET p_offset
      ) x
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_rated_messages(text, text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_rated_messages(text, text, int, int) TO authenticated;
