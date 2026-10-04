import {describe,it,expect} from 'vitest';
import {hasClientPolicyEvidence} from '../policyIdentity';
describe('policy evidence',()=>{
 it('does not turn a default Term contact or zero amount into a phantom policy',()=>{
  expect(hasClientPolicyEvidence({policyType:'Term',premiumAmount:'$0.00',faceAmount:''})).toBe(false);
 });
 it.each([{carrier:'Americo'},{policyNumber:'POL-1'},{premiumAmount:'58.45'},{soldDate:'2026-09-28'}])('recognizes explicit policy data %s',p=>expect(hasClientPolicyEvidence(p)).toBe(true));
});
