import { describe,it,expect } from 'vitest';
import { buildCallItem,formatCallDuration } from '@/components/contacts/conversation-history/conversationTypes';
import { presentActivity } from '../presentation';
import type { HistoryRow } from '../types';
const names={profiles:new Map([['dialer','Dialing Agent'],['answer','Answering Agent'],['route','Routed Agent']]),campaigns:new Map([['campaign','Campaign Name']])};
describe('trustworthy history presentation',()=>{
 it('uses stored outbound attribution and never current ownership',()=>{
  const c=buildCallItem({id:'call',direction:'outbound',agent_id:'dialer',assigned_agent_id:'route',campaign_id:'campaign',duration:61,notes:'Recorded note'},names);
  expect(c.agentName).toBe('Dialing Agent');expect(c.campaignName).toBe('Campaign Name');expect(c.notes).toBe('Recorded note');expect(formatCallDuration(c.durationSeconds)).toBe('1:01');
 });
 it('does not invent a Quick Call or unknown agent, direction, time or duration',()=>{
  const c=buildCallItem({agent_id:'unresolved'},names);
  expect(c.agentName).toBe('Agent unavailable');expect(c.campaignName).toBeNull();expect(c.directionLabel).toBe('');expect(c.timestampKnown).toBe(false);expect(formatCallDuration(c.durationSeconds)).toBe('Not recorded');
  expect(formatCallDuration(buildCallItem({duration:0}).durationSeconds)).toBe('0:00');
 });
 it('completed parent with duration is not an answered inbound call',()=>{
  const c=buildCallItem({direction:'inbound',status:'completed',duration:60,routed_agent_ids:['route'],is_missed:true},names);
  expect(c.agentLabel).toBe('Routed to');expect(c.agentName).toBe('Routed Agent');expect(c.answeredAgent).toBeNull();expect(c.inboundMissed).toBe(true);
 });
 it('keeps mobile answer and missed classification together',()=>{
  const c=buildCallItem({direction:'inbound',is_missed:true,missed_reason:'forwarded_to_mobile',outcome:'forwarded_answered',answered_by_agent_id:'answer',routed_agent_ids:['route'],voicemail_id:'vm'},names);
  expect(c.agentName).toBe('Answering Agent');expect(c.agentLabel).toBe('Answered on mobile');expect(c.inboundMissed).toBe(true);expect(c.routedAgents).toEqual(['Routed Agent']);expect(c.voicemailId).toBe('vm');
 });
 it('requires answer evidence before using mobile attribution',()=>{
  const c=buildCallItem({direction:'inbound',answered_by_agent_id:'answer',routed_agent_ids:['route']},names);
  expect(c.answeredAgent).toBeNull();expect(c.agentName).toBe('Routed Agent');
 });
 it('distinguishes actor and assignee and preserves old/new values',()=>{
  const row:HistoryRow={event_key:'event:1',event_time:'2026-10-03T10:00:00Z',kind:'operation',payload:{source_table:'appointments',action:'changed',actor_id:'dialer',assignee_after:'answer',changed_fields:['start_time'],before_values:{start_time:'2026-10-04T10:00:00Z'},after_values:{start_time:'2026-10-05T10:00:00Z'}}};
  const item=presentActivity(row,names);expect(item.title).toBe('Appointment rescheduled');expect(item.actor).toBe('Dialing Agent');expect(item.details.join(' ')).toContain('→');expect(item.details).toContain('Assigned to: Answering Agent');
 });
 it('legacy null actor is not guessed to be System',()=>{
  expect(presentActivity({event_key:'legacy:1',event_time:null,kind:'legacy',payload:{description:'Old entry'}},names).actor).toBe('Actor not recorded');
 });
 it('does not copy communication bodies to activity',()=>{
  const item=presentActivity({event_key:'sms:1',event_time:null,kind:'sms',payload:{body:'PRIVATE',direction:'outbound',status:'queued'}},names);
  expect(JSON.stringify(item)).not.toContain('PRIVATE');expect(item.title).toContain('queued');
 });
});
