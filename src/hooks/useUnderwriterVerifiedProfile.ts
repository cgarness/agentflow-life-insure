import { useEffect,useRef } from 'react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { completeSetup,type SetupSnapshot,type SetupDraft } from '@/lib/uv-profile/setup';
import { useAuth } from '@/contexts/AuthContext';
import { getProfileStatus,saveProfilePreferences,type Preferences,type Scope } from '@/lib/uv-profile/api';

export function useUnderwriterVerifiedProfile(enabled:boolean) {
  const auth = useAuth();
  const own = auth.realProfile;
  const ready = enabled && auth.isLoading===false && auth.isImpersonating===false && !!auth.user?.id
    && own?.id===auth.user.id && auth.profile?.id===own?.id && !!own?.organization_id;
  const scope:Scope|null = ready ? {profileId:own!.id,organizationId:own!.organization_id!} : null;
  const scopeKey = scope ? `${scope.profileId}:${scope.organizationId}` : '';
  const current = useRef(scopeKey);
  current.current = scopeKey;
  const refreshUntil = useRef(Date.now()+30_000);
  const savedProfile = JSON.stringify([scopeKey,own?.first_name,own?.last_name,own?.phone,own?.email,own?.npn,own?.avatar_url]);
  const previousProfile = useRef(savedProfile);
  const key = ['uv-public-profile',scope?.profileId ?? null,scope?.organizationId ?? null];
  const cache = useQueryClient();
  const query = useQuery({queryKey:key,enabled:ready,queryFn:() => getProfileStatus(scope!),
    staleTime:0,gcTime:60_000,retry:1,refetchOnMount:'always',refetchOnWindowFocus:true,
    refetchInterval:query => query.state.data?.state==='pending' && Date.now()<refreshUntil.current ? 2_000 : false,
    refetchIntervalInBackground:false});
  useEffect(() => {
    if (previousProfile.current===savedProfile) return;
    previousProfile.current = savedProfile;
    refreshUntil.current = Date.now()+30_000;
    if (ready) void cache.invalidateQueries({queryKey:['uv-public-profile',own!.id,own!.organization_id],exact:true});
  },[savedProfile,ready,cache,own]);
  const mutation = useMutation({
    mutationFn:async ({preferences,revision}:{preferences:Preferences;revision:string}) => {
      if (!scope || !scopeKey || current.current!==scopeKey) throw new Error('Profile scope changed.');
      refreshUntil.current = Date.now()+30_000;
      const data = await saveProfilePreferences(scope,preferences,revision);
      if (current.current!==scopeKey) throw new Error('Profile scope changed.');
      return data;
    },
    onSuccess:data => {if (current.current===scopeKey) cache.setQueryData(key,data);},
    onError:() => {if (current.current===scopeKey) void cache.invalidateQueries({queryKey:key,exact:true});},
  });
  return {ready,scopeKey,scope,
    complete:async(snapshot:SetupSnapshot,draft:SetupDraft,phonePublic:boolean,emailPublic:boolean) => {
      if (!scope || !scopeKey || current.current!==scopeKey) throw new Error('Profile scope changed.');
      refreshUntil.current=Date.now()+30_000;
      const data=await completeSetup(scope,snapshot,draft,phonePublic,emailPublic);
      if(current.current!==scopeKey) throw new Error('Profile scope changed.');
      cache.setQueryData(key,data);
      // Reload canonical profile state after the atomic server save; never write it twice.
      void auth.refreshProfile?.();
      return data;
    },data:ready && !query.error ? query.data ?? null : null,
    loading:ready && query.isPending,error:ready ? query.error : null,
    refresh:() => {refreshUntil.current=Date.now()+30_000;return query.refetch();},save:(input:{preferences:Preferences;revision:string}) => {
      if (!scopeKey || current.current!==scopeKey) return Promise.reject(new Error('Profile scope changed.'));
      return mutation.mutateAsync(input);
    },saving:mutation.isPending,
    phone:ready ? own?.phone ?? '' : '',email:ready ? own?.email ?? '' : ''};
}
