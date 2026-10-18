import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.98.0';
import { handleWorker } from './handler.ts';
import { json } from '../_shared/uv-profile/protocol.ts';

Deno.serve(async (request: Request) => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({error:'not_configured'},503);
  const client = createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  return handleWorker(request,{
    enabled:Deno.env.get('UV_PROFILE_SYNC_ENABLED')==='true',
    workerSecret:Deno.env.get('UV_PROFILE_WORKER_SECRET') ?? '',
    syncSecret:Deno.env.get('UV_PROFILE_SYNC_SECRET') ?? '',
    fetch,
    rpc:async (name,args) => {
      const result = await client.rpc(name,args);
      return {data:result.data,error:result.error};
    },
  });
});
