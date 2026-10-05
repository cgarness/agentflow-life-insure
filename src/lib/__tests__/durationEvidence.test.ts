import {describe,it,expect} from 'vitest';
import {durationEvidence,parseDurationSeconds} from '../../../supabase/functions/twilio-voice-status/duration';
const parent='CA'+'1'.repeat(32),child='CA'+'2'.repeat(32);
describe('signed duration evidence',()=>{
 it.each(['-1','1.5','12seconds','Infinity','NaN',' 90','2147483648'])('rejects malformed seconds %s',s=>expect(parseDurationSeconds(s)).toBeNull());
 it('preserves known zero and integer values',()=>{expect(parseDurationSeconds('0')).toBe(0);expect(parseDurationSeconds('90')).toBe(90);});
 it('prefers CallDuration with the matching call leg',()=>expect(durationEvidence({CallDuration:'90',DialCallDuration:'80',CallSid:parent,DialCallSid:child,SequenceNumber:'2'},parent,90)).toMatchObject({source:'provider',sid:parent,parentSid:parent,sequence:2}));
 it('keeps Dial duration attached to the child with signed parent correlation',()=>expect(durationEvidence({DialCallDuration:'90',CallSid:parent,DialCallSid:child},parent,90)).toMatchObject({source:'provider',sid:child,parentSid:parent}));
 it('distinguishes elapsed estimate from terminal non-answer',()=>{expect(durationEvidence({},parent,120)?.source).toBe('elapsed_estimate');expect(durationEvidence({},parent,0)?.source).toBe('terminal_non_answer');expect(durationEvidence({},parent,null)).toBeNull();});
});
