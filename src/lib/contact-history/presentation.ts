import { buildCallItem, formatCallDuration } from '@/components/contacts/conversation-history/conversationTypes';
import type { ActivityItem, HistoryNames, HistoryRow } from './types';
export const text = (v: unknown): string | null => typeof v === 'string' && v.trim() ? v.trim() : null;
export function agentName(id: unknown, names: HistoryNames): string { return names.profiles.get(text(id) ?? '') || 'Agent unavailable'; }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const labels: Record<string,string> = { appointments:'Appointment',tasks:'Task',contact_notes:'Note',leads:'Lead',clients:'Client',recruits:'Recruit',campaign_leads:'Campaign membership' };
const fields: Record<string,string> = {user_id:'Assigned to',assigned_to:'Assigned to',assigned_agent_id:'Assigned to',callback_agent_id:'Callback agent',claimed_by:'Claimed by',status:'Status',start_time:'Start',end_time:'End',due_date:'Due',completed_at:'Completed',callback_due_at:'Callback due',scheduled_callback_at:'Callback due',title:'Title',type:'Type',task_type:'Type',pinned:'Pinned',lead_source:'Lead source'};
const agentFields = new Set(['user_id','assigned_to','assigned_agent_id','callback_agent_id','claimed_by']);
function value(key: string, v: unknown, names: HistoryNames): string {
 if (v === null || v === undefined || v === '') return 'Not recorded';
 if (agentFields.has(key)) return agentName(v,names);
 if (key === 'campaign_id') return names.campaigns.get(String(v)) || 'Campaign unavailable';
 if (typeof v === 'boolean') return v ? 'Yes' : 'No';
 if (/(?:_time|_date|_at)$/.test(key) && typeof v === 'string' && Number.isFinite(Date.parse(v))) return new Date(v).toLocaleString();
 return typeof v === 'string' || typeof v === 'number' ? String(v) : 'Changed';
}
export function presentActivity(row: HistoryRow,names: HistoryNames): ActivityItem {
 const p=row.payload, before=object(p.before_values), after=object(p.after_values);
 const base: ActivityItem={key:row.event_key,timestamp:row.event_time,title:'Activity recorded',actor:'Actor not recorded',details:[],legacy:row.kind==='legacy'};
 if (row.kind==='call') {
  const call=buildCallItem(p,names);
  return {...base,title:`${call.directionLabel} Call — ${call.dispositionName || call.inboundOutcomeLabel || call.outcome || call.status || 'Status not recorded'}`,
   actor:`${call.agentLabel}: ${call.agentName}`,details:[`Duration: ${formatCallDuration(call.durationSeconds)}`]};
 }
 if (row.kind==='sms' || row.kind==='email') {
  const incoming=p.direction==='inbound'||p.direction==='incoming';
  return {...base,title:`${incoming?'Inbound':'Outbound'} ${row.kind==='sms'?'SMS':'email'} — ${text(p.status ?? p.delivery_status)||'Status not recorded'}`,
   actor:incoming?'Received from contact':(row.kind==='sms'&&p.created_by?agentName(p.created_by,names):'Actor not recorded')};
 }
 if (row.kind==='legacy') return {...base,title:text(p.description)||'Activity recorded',actor:p.agent_id?agentName(p.agent_id,names):'Actor not recorded'};
 const source=text(p.source_table)||'', changed=Array.isArray(p.changed_fields)?p.changed_fields as string[]:[];
 let action=text(p.action)||'recorded';
 if (action==='conversion_recorded') return {...base,title:'Lead converted to client',details:['Conversion retained in contact lineage; actor not recorded.']};
 if (action==='converted') return {...base,title:'Lead converted to client',actor:p.actor_id?agentName(p.actor_id,names):'System'};
 if (action==='changed') {
  if (source==='tasks' && changed.includes('completed_at')) action=after.completed_at?(before.completed_at?'completion time updated':'completed'):'reopened';
  else if (source==='contact_notes' && changed.includes('pinned')) action=after.pinned?'pinned':'unpinned';
  else if (source==='appointments' && changed.includes('status')) action=`status changed to ${text(after.status)||'Not recorded'}`;
  else if (source==='appointments' && changed.some(k=>k==='start_time'||k==='end_time')) action='rescheduled';
  else if (source==='campaign_leads' && changed.some(k=>k==='callback_due_at'||k==='scheduled_callback_at')) action=after.callback_due_at||after.scheduled_callback_at?(before.callback_due_at||before.scheduled_callback_at?'callback rescheduled':'callback scheduled'):'callback cleared';
  else if (changed.some(k=>agentFields.has(k))) action='reassigned';
 }
 const details:string[]=[];
 for(const [k,v] of Object.entries(after)) {
  if(k==='campaign_id') {details.push(`Campaign: ${value(k,v,names)}`);continue;}
  if(!fields[k]) continue;
  details.push(`${fields[k]}: ${k in before ? `${value(k,before[k],names)} → `:''}${value(k,v,names)}`);
 }
 const other=changed.filter(k=>!fields[k]&&k!=='campaign_id');
 if(other.length) details.push(`Updated: ${other.map(k=>k.replace(/_/g,' ')).join(', ')}`);
 if(p.assignee_after && !Object.keys(after).some(k=>agentFields.has(k))) details.push(`Assigned to: ${agentName(p.assignee_after,names)}`);
 if(row.kind==='snapshot' && action==='recorded') details.unshift('Current recorded details; prior changes are not available.');
 return {...base,title:`${labels[source]||'Contact'} ${action}`,actor:p.actor_id?agentName(p.actor_id,names):p.actor_kind==='system'?'System':'Actor not recorded',details};
}
