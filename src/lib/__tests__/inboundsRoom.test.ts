import {describe,it,expect,vi} from 'vitest';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
import {parseRoomRoute} from '../../../supabase/functions/_shared/inbounds-room';
import {filterAutomaticCallerIdPool,isManualCallerIdAllowed} from '@/lib/caller-id-selection';
import {localDayBounds} from '@/lib/inbounds/contracts';
describe('Inbounds boundaries',()=>{
 it('never accepts an ordinary CRM identity as a room identity',()=>{expect(()=>parseRoomRoute({room:true,targets:[{agentId:'a',identity:'agent_crm'}]})).toThrow();expect(parseRoomRoute({room:true,targets:[{agentId:'a',identity:'ir_'+'a'.repeat(32)}]}).targets).toHaveLength(1);expect(()=>parseRoomRoute(null)).toThrow();});
 it('excludes dedicated DIDs from automatic and manual selection',()=>{const p={phone_number:'+12025550123',area_code:'202',is_default:false,daily_call_count:0,daily_call_limit:100,assignment_type:'agency',inbounds_only:true,status:'active'};expect(filterAutomaticCallerIdPool([p])).toEqual([]);expect(isManualCallerIdAllowed(p,'agent')).toBe(false);expect(isManualCallerIdAllowed({...p,assignment_type:'personal',assigned_to:'agent'},'agent')).toBe(false);});
 it('uses local midnights for reporting bounds',()=>{const now=new Date(2026,10,3,15,30),b=localDayBounds(now);expect(new Date(b.start).getHours()).toBe(0);expect(new Date(b.end).getDate()).toBe(4);});
});
