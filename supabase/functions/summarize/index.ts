import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUMMARY_PROMPT = `You are a concise fitness and coaching assistant. Summarize the following answer into 2-3 bullet points that capture the most important takeaways. Use plain language a coach can scan in seconds. Return ONLY the bullet points, nothing else. Format each bullet starting with "• ".`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { message_id } = await req.json()
    if (!message_id) {
      return new Response(JSON.stringify({ error: 'Missing message_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Fetch the message and verify ownership
    const { data: msg, error: msgError } = await supabase
      .from('chat_messages')
      .select('id, answer, summary, user_id')
      .eq('id', message_id)
      .single()

    if (msgError || !msg) {
      return new Response(JSON.stringify({ error: 'Message not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (msg.user_id !== user.id) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If already summarized, return existing summary
    if (msg.summary) {
      return new Response(JSON.stringify({ summary: msg.summary }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Call LLM to generate summary
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: SUMMARY_PROMPT },
          { role: 'user', content: msg.answer },
        ],
        max_tokens: 300,
        temperature: 0.3,
      }),
    })

    if (!llmRes.ok) {
      const err = await llmRes.json()
      console.error('OpenAI error:', err)
      return new Response(JSON.stringify({ error: 'Failed to generate summary' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const llmData = await llmRes.json()
    const summary = llmData.choices?.[0]?.message?.content?.trim() || ''

    if (!summary) {
      return new Response(JSON.stringify({ error: 'Empty summary returned' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Persist summary to database (one-time write)
    const adminClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await adminClient
      .from('chat_messages')
      .update({ summary })
      .eq('id', message_id)

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('summarize error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
