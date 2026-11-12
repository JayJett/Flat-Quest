import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

// The scheduler sends a dedicated secret held in Vault. No browser credentials
// can authorize this endpoint. The service key exists only in the Edge runtime.
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const token = req.headers.get('x-cleanup-token')
  if (!token || token.length > 200) return new Response('Unauthorized', { status: 401 })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const authorized = await admin.rpc('authorize_media_cleanup', { p_token: token })
  if (authorized.error || authorized.data !== true) return new Response('Unauthorized', { status: 401 })
  try {
    const body = await req.json()
    const dryRun = body.dry_run !== false
    const candidates = await admin.rpc('claim_media_cleanup', { p_dry_run: dryRun })
    if (candidates.error) throw candidates.error
    let deleted = 0; let failed = 0
    for (const candidate of candidates.data ?? []) {
      if (dryRun) continue
      const paths = [candidate.path, candidate.thumbnail_path].filter(Boolean)
      const result = await admin.storage.from('household-media').remove(paths)
      const ack = await admin.rpc('finish_media_cleanup', { p_path: candidate.path, p_error: result.error?.message ?? null })
      if (result.error || ack.error) failed++; else deleted++
    }
    const result = { dry_run: dryRun, candidates: candidates.data?.length ?? 0, deleted, failed }
    console.log(JSON.stringify(result))
    return Response.json(result, { status: failed ? 503 : 200 })
  } catch {
    console.error('Media cleanup failed; pending entries remain retryable.')
    return Response.json({ error: 'Cleanup failed' }, { status: 500 })
  }
})

