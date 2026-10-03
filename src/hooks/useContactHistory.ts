import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationFilter, ConversationItem } from '@/components/contacts/conversation-history/conversationTypes';
import { getActivityPage, getConversationPage } from '@/lib/contact-history/queries';
import { subscribeContactHistory } from '@/lib/contact-history/refresh';
import type { ActivityItem, HistoryPage, HistoryScope } from '@/lib/contact-history/types';

type Feed<T> = HistoryPage<T> & { loading:boolean; error:string|null };
const empty = <T,>():Feed<T> => ({items:[],hasMore:false,nextCursor:null,loading:true,error:null});
interface State { key:string; conversation:Feed<ConversationItem>; activity:Feed<ActivityItem> }
export function useContactHistory(scope:HistoryScope|null,filter:ConversationFilter,activityActive:boolean) {
 const key=scope?JSON.stringify([scope.viewerId,scope.organizationId,scope.contactType,scope.contactId,filter]):'';
 const currentKey=useRef(key); currentKey.current=key;
 const [state,setState]=useState<State>(()=>({key,conversation:empty(),activity:empty()}));
 const schedule=useRef<(mode:'refresh'|'conversation'|'activity')=>void>(()=>{});
 useEffect(()=>{
  let disposed=false,busy=false,queued=false,controller:AbortController|null=null;
  let conversation=empty<ConversationItem>(),activity=empty<ActivityItem>();
  let failures=0,lastFinished=0;
  const current=()=>!disposed&&currentKey.current===key;
  const publish=()=>{if(current())setState({key,conversation:{...conversation},activity:{...activity}});};
  const run=async(mode:'refresh'|'conversation'|'activity')=>{
   if(!current()||!scope)return;
   if(busy){if(mode==='refresh')queued=true;return;}
   if(mode!=='refresh' && (mode==='conversation'? !conversation.hasMore:!activity.hasMore))return;
   busy=true;controller=new AbortController();
   const signal=controller.signal;
   const timeout=setTimeout(()=>controller?.abort(),20000);
   const fetchFeed=async<T extends {key:string}>(feed:Feed<T>,loader:(request:import('@/lib/contact-history/types').HistoryRequest)=>Promise<HistoryPage<T>>,append:boolean):Promise<Feed<T>>=>{
    try {
     // Refresh the previously visible window, using one fresh cursor generation.
     const target=append?1:Math.max(1,Math.ceil(feed.items.length/30));
     let cursor=append?feed.nextCursor:null;
     const items:T[]=append?[...feed.items]:[];
     let result:HistoryPage<T>|null=null;
     for(let i=0;i<target;i++) {
      result=await loader({scope,filter,cursor,signal});
      const known=new Set(items.map(x=>x.key));
      items.push(...result.items.filter(x=>!known.has(x.key)));
      cursor=result.nextCursor;
      if(!result.hasMore)break;
     }
     if(!result)throw new Error('History unavailable');
     return {...result,items,loading:false,error:null};
    } catch(e) {
     return {...feed,loading:false,error:signal.aborted?'History request timed out. Retry to refresh.':e instanceof Error?e.message:'History unavailable'};
    }
   };
   if(mode!=='activity')conversation={...conversation,loading:true,error:null};
   if(mode!=='conversation')activity={...activity,loading:true,error:null};
   publish();
   const [c,a]=await Promise.all([
    mode==='activity'?Promise.resolve(conversation):fetchFeed(conversation,getConversationPage,mode==='conversation'),
    mode==='conversation'?Promise.resolve(activity):fetchFeed(activity,getActivityPage,mode==='activity'),
   ]);
   clearTimeout(timeout);
   if(!current())return;
   conversation=c;activity=a;busy=false;lastFinished=Date.now();failures=c.error||a.error?Math.min(failures+1,4):0;publish();
   if(queued){queued=false;void run('refresh');}
  };
  schedule.current=mode=>{if(current())void run(mode);};
  if(scope)void run('refresh');else {conversation.loading=false;activity.loading=false;publish();}
  const reconcile=()=>{
   if(document.visibilityState!=='hidden'&&navigator.onLine!==false&&!busy)void run('refresh');
  };
  const unsub=subscribeContactHistory(s=>{
   if(s.organizationId===scope?.organizationId&&(!s.contactId||s.contactId===scope?.contactId)&&(!s.contactType||s.contactType===scope?.contactType))void run('refresh');
  });
  window.addEventListener('focus',reconcile);window.addEventListener('online',reconcile);document.addEventListener('visibilitychange',reconcile);
  const interval=setInterval(()=>{if(Date.now()-lastFinished>=60000*Math.pow(2,failures))reconcile();},60000);
  return ()=>{disposed=true;controller?.abort();clearInterval(interval);unsub();window.removeEventListener('focus',reconcile);window.removeEventListener('online',reconcile);document.removeEventListener('visibilitychange',reconcile);};
 // scope and filter are fully encoded in the generation key; object identity must not restart reads.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key]);
 const refresh=useCallback(()=>{if(currentKey.current===key)schedule.current('refresh');},[key]);
 const loadConversation=useCallback(()=>{if(currentKey.current===key)schedule.current('conversation');},[key]);
 const loadActivity=useCallback(()=>{if(currentKey.current===key)schedule.current('activity');},[key]);
 const wasActive=useRef(activityActive);
 useEffect(()=>{if(activityActive&&!wasActive.current)refresh();wasActive.current=activityActive;},[activityActive,refresh]);
 const visible=state.key===key?state:{key,conversation:empty<ConversationItem>(),activity:empty<ActivityItem>()};
 return {...visible,refresh,loadConversation,loadActivity};
}
