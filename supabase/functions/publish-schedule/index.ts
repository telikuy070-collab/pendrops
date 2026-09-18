import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );

  const { lessons, version } = await req.json();

  // Transactional publish via RPC
  const { error } = await supabase.rpc('publish_schedule', {
    p_lessons: lessons,
    p_version: version,
    p_updated_at: new Date().toISOString()
  });

  if (error) return new Response(JSON.stringify({ error: error.message }), {
    status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
});