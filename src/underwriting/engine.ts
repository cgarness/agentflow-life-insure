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
export function orderResults(results:Result[],schedule?:CommissionSchedule,today?:string):Result[] {
  const rank:Record<Result['status'],number>={candidate:0,possible:1,review:2,hold:3,outside:4};
  const benefitRank={immediate:0,graded:1,unconfirmed:2};
  const comparable=schedule&&today&&validSchedule(schedule,today);
  return [...results].sort((a,b)=>{
    const underwriting=rank[a.status]-rank[b.status]||benefitRank[a.benefit]-benefitRank[b.benefit];
    if(underwriting)return underwriting;
    if(comparable&&a.status==='candidate'&&b.status==='candidate'&&a.tierKind==='candidate'&&b.tierKind==='candidate'&&
      a.commissionKey&&b.commissionKey&&a.commissionGroup&&a.commissionGroup===b.commissionGroup){
      const peers=results.filter(r=>r.status==='candidate'&&r.tierKind==='candidate'&&r.commissionGroup===a.commissionGroup);
      if(peers.length>1&&peers.every(r=>r.commissionKey&&schedule.rates[r.commissionKey]!==undefined&&schedule.rates[r.commissionKey]!=='')){
        const commission=+schedule.rates[b.commissionKey]!-+schedule.rates[a.commissionKey]!;
        if(commission)return commission;
      }
    }
    return a.name.localeCompare(b.name);
  });
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
