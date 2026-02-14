import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

    // Client scoped to the calling user (respects RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )

    // Admin client for sending the invite email (needs service_role)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Verify caller
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { email, gym_id } = await req.json()
    if (!email || !gym_id) {
      return new Response(JSON.stringify({ error: 'Missing email or gym_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Verify caller owns this gym
    const { data: gym, error: gymError } = await supabase
      .from('gyms')
      .select('id, name, max_seats')
      .eq('id', gym_id)
      .eq('owner_id', user.id)
      .single()

    if (gymError || !gym) {
      return new Response(JSON.stringify({ error: 'Gym not found or you are not the owner' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check seat limits
    const { count } = await supabase
      .from('gym_members')
      .select('*', { count: 'exact', head: true })
      .eq('gym_id', gym_id)
      .in('status', ['active', 'invited'])

    if ((count || 0) >= gym.max_seats) {
      return new Response(JSON.stringify({ error: `All ${gym.max_seats} coach seats are filled` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Check for duplicate invite
    const { data: existing } = await supabase
      .from('gym_members')
      .select('id')
      .eq('gym_id', gym_id)
      .eq('invited_email', normalizedEmail)
      .in('status', ['active', 'invited'])
      .limit(1)

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ error: 'This email has already been invited' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Insert the gym_members row
    const { error: insertError } = await supabase
      .from('gym_members')
      .insert({
        gym_id,
        invited_email: normalizedEmail,
        invited_by: user.id,
        status: 'invited',
      })

    if (insertError) {
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Send the invite email via Supabase Auth
    // This creates the user if they don't exist and sends a magic link
    // If they already have an account, it still sends a link (no error)
    const siteUrl = Deno.env.get('SITE_URL') || req.headers.get('origin') || ''
    const { error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      normalizedEmail,
      {
        redirectTo: siteUrl,
        data: { invited_to_gym: gym.name },
      },
    )

    if (inviteError) {
      // DB row was created so the owner sees "invited" status,
      // but the email failed — let them know
      console.error('Invite email failed:', inviteError.message)
      return new Response(JSON.stringify({
        success: true,
        email_sent: false,
        message: 'Coach added but the invite email could not be sent. Share the signup link manually.',
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({
      success: true,
      email_sent: true,
      message: `Invite email sent to ${normalizedEmail}`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    console.error('invite-coach error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
