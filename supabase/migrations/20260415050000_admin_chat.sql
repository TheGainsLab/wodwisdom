-- Admin drill-down #2: chat transcripts.
--
-- RPC for /admin/users/:id/chat. Returns paginated Q&A messages plus header
-- aggregates. Each message carries its raw context (context_type, context_id,
-- sources) so admins can expand and see what the AI was grounded on.
--
-- Authorization: gated on is_current_user_admin(). log_admin_access is called
-- once per fetch (with filter metadata) rather than per message.

CREATE OR REPLACE FUNCTION public.admin_list_chat_messages(
  target_user_id uuid,
  p_limit int DEFAULT 20,
  p_offset int DEFAULT 0,
  p_search text DEFAULT NULL,
  p_since timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  search_like text;
  result jsonb;
BEGIN
  IF NOT is_current_user_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  PERFORM log_admin_access(
    target_user_id,
    'chat',
    jsonb_build_object('limit', p_limit, 'offset', p_offset, 'search', p_search, 'since', p_since)
  );

  IF p_search IS NOT NULL AND length(trim(p_search)) > 0 THEN
    search_like := '%' || replace(replace(trim(p_search), '%', '\%'), '_', '\_') || '%';
  ELSE
    search_like := NULL;
  END IF;

  SELECT jsonb_build_object(
    'totals', (
      SELECT jsonb_build_object(
        'total_messages', COUNT(*),
        'messages_7d',  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days'),
        'messages_30d', COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')
      )
      FROM chat_messages
      WHERE user_id = target_user_id
    ),
    'total_filtered', (
      SELECT COUNT(*) FROM chat_messages
      WHERE user_id = target_user_id
        AND (search_like IS NULL OR question ILIKE search_like OR answer ILIKE search_like)
        AND (p_since IS NULL OR created_at >= p_since)
    ),
    'messages', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.created_at DESC)
      FROM (
        SELECT * FROM chat_messages
        WHERE user_id = target_user_id
          AND (search_like IS NULL OR question ILIKE search_like OR answer ILIKE search_like)
          AND (p_since IS NULL OR created_at >= p_since)
        ORDER BY created_at DESC
        LIMIT p_limit OFFSET p_offset
      ) m
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_chat_messages(uuid, int, int, text, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_list_chat_messages(uuid, int, int, text, timestamptz) TO authenticated;
