import { CaseInput, Result, CommissionSchedule } from './types';
import { validateCase, validSchedule } from './validation';
import { americo } from './rules/americo';
import { mutual } from './rules/mutual';
import { transamerica } from './rules/transamerica';
export function evaluate(c:CaseInput):Result[] {
  const issues=validateCase(c);
  if(issues.length)throw new Error(issues.map(e=>e.message).join(' '));
  return [americo(c),mutual(c),transamerica(c)];
}
// No numeric approval score; preserve carrier-native outcomes and distinct benefit structures.
export function orderResults(results:Result[]):Result[] {
  const rank:Record<Result['status'],number>={candidate:0,possible:1,review:2,hold:3,outside:4};
  return [...results].sort((a,b)=>rank[a.status]-rank[b.status]||a.name.localeCompare(b.name));
}
export function commissionLeaders(results:Result[],s:CommissionSchedule,today:string):string[] {
  if(!validSchedule(s,today))return [];
  // A source hold, unknown tier or mere tier ceiling must never be presented as suitable for a payout badge.
  const candidates=results.filter(r=>r.status==='candidate'&&r.tierKind==='candidate'&&r.commissionKey&&r.commissionGroup);
  const leaders:string[]=[];
  for(const group of new Set(candidates.map(c=>c.commissionGroup))) {
    const peers=candidates.filter(c=>c.commissionGroup===group);
    if(peers.length<2)continue;
    if(peers.some(r=>s.rates[r.commissionKey!]===undefined||s.rates[r.commissionKey!]===''))continue;
    const max=Math.max(...peers.map(r=>+s.rates[r.commissionKey!]!));
    leaders.push(...peers.filter(r=>Number(s.rates[r.commissionKey!])===max).map(r=>r.carrier));
  }
  return leaders;
}
export function caseSummary(c:CaseInput):string {
  return `${c.age} years · ${c.state} · ${Math.floor(+c.height/12)}′${+c.height%12}″ · ${c.weight} lb · $${Number(c.face).toLocaleString('en-US')} coverage`;
}
