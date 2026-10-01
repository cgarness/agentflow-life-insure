import { CaseInput, Result } from '../types';
import { normalizeMedication } from '../data';
import { transamericaBuild, transamericaRxExclude, TransamericaFactor, TransamericaTier } from '../transamerica-data';
import { transamericaConditions } from './transamerica-conditions';
const rank:Record<TransamericaTier,number>={Premier:0,Select:1,Graded:2,Decline:3};
export function transamerica(c:CaseInput):Result {
  const r:Result={carrier:'transamerica',name:'Transamerica',product:'FE Express / Graded FE Express',status:'review',
    tier:'Classification unconfirmed',tierKind:'unknown',benefit:'unconfirmed',reasons:[],gaps:[],warnings:[
      'Source: visually verified 08/26 guide. Individual classifications are preliminary, not a carrier offer.',
      'Diagnostic, prescription, personal-history and related-condition checks can change the carrier’s final decision.']};
  const a=c.answers,age=+c.age,face=+c.face,factors:TransamericaFactor[]=[];
  const evidence=(rule:string,text:string,page:string)=>r.reasons.push({rule,source:'TA2608',page,text});
  const outside=(rule:string,text:string,page:string)=>{r.status='outside';evidence(rule,text,page);};
  if(age<18||age>85)outside('TA-AGE','FE Express issue ages are 18–85; Graded ends at 80.','4');
  if(c.state==='NY')outside('TA-NY','New York is excluded in this product guide.','4');
  if(face<5000||face>(age<=75?100000:25000))outside('TA-FACE','Requested coverage is outside the published FE Express amount for this age.','4');
  const row=transamericaBuild.find(x=>x[0]===+c.height);
  if(!row)r.gaps.push('No published Transamerica build row at this height; no extrapolation.');
  else {
    const labels:TransamericaTier[]=['Graded','Select','Premier','Select','Graded'];let found=false;
    for(let band=0;band<5;band++)if(+c.weight>=row[1+band*2]!&&+c.weight<=row[2+band*2]!){
      factors.push({id:'TA-BUILD',tier:labels[band]!,page:'18',text:`Published ${labels[band]} build band: ${row[1+band*2]}–${row[2+band*2]} lb.`});found=true;break;}
    if(+c.weight>row[10]!)outside('TA-BUILD-HIGH','Above the maximum published Graded weight: no coverage under this chart.','18');
    else if(!found)r.gaps.push('Weight is below or between published bands; no rounding or invented classification.');
  }
  const medical=transamericaConditions(c);factors.push(...medical.factors);r.gaps.push(...medical.gaps);
  for(const med of c.medications){
    if(med.status==='current'&&transamericaRxExclude.some(n=>normalizeMedication(n)===normalizeMedication(med.name)))
      outside('TA-RX',`${med.name} matches the current-medication exclusion list for both products.`,'17');
    else r.gaps.push(`${med.name}: medication-specific impact needs review; absence from a non-exhaustive list is not clearance.`);
  }
  if(c.conditionsStatus==='unknown'||c.medicationsStatus==='unknown')r.gaps.push('Complete the diagnosis and prescription history.');
  if(a.taTobacco12==='yes'&&(c.nicotine==='never'||(c.nicotine==='former'&&+c.nicotineMonths>12)))r.gaps.push('Tobacco and nicotine history conflict; confirm the actual history before ranking.');
  if(a.taTobacco12==='yes')factors.push({id:'TA-TOBACCO',tier:'Select',page:'14',text:'Tobacco within one year: Select Tobacco; not inferred from nicotine replacement therapy.'});
  else if(a.taTobacco12!=='no')r.gaps.push('Confirm actual tobacco use separately from the broader nicotine question.');
  for(const [key,page,label] of [
    ['taCurrentSupport','10,12–14','Current listed care-facility, hospice/home-health, bedridden or terminal-illness criterion'],
    ['taHospital','12','Two or more hospitalizations within one year, excluding childbirth'],
    ['taPending','13','Listed pending tests/procedures/diagnosis/results within six months'],
    ['taLegal','11–12','Current incarceration/probation/parole or felony charges within two years']
  ]){
    if(a[key!]==='yes')outside('TA-SAFETY-'+key,`${label}: Decline under the applicable chart row.`,page!);
    else if(a[key!]!=='no')r.gaps.push(`Confirm: ${label}.`);
  }
  if(a.taLifestyle!=='no')r.gaps.push('Alcohol/drug treatment, DUI, suicide-attempt or psychiatric-hospitalization history needs its exact lookback assessment.');
  // Americo's 12-month questions are never reused as a Transamerica decline.
  if(a.oxygen12!=='no'||a.mobility12!=='no'||a.adl12!=='no'||a.hospice12!=='no'||a.pending!=='no')
    r.gaps.push('Reconcile oxygen, temporary-device exceptions and care history against Transamerica’s own current/6/12-month rules.');
  if((c.conditions.length>1||(c.conditions.length>0&&a.taTobacco12==='yes'))&&a.taUnrelated!=='yes')r.gaps.push('Multiple diagnoses need a documented unrelated-condition assessment; do not stack or assume independence.');
  if(a.taUnrelated==='no')r.gaps.push('Related conditions require carrier combination review.');
  if(a.taEligibility!=='yes')r.gaps.push('Confirm current state availability, insured/owner identity, insurable interest and citizenship/green-card eligibility.');
  if(a.taReviewed!=='yes'||!c.details.taForm?.trim())r.gaps.push('Review the current Transamerica application, all health/lifestyle answers, and record its state/form version.');
  for(const f of factors)evidence(f.id,f.text,f.page);
  const tier=factors.reduce<TransamericaTier>((worst,f)=>rank[f.tier]>rank[worst]?f.tier:worst,'Premier');
  if(tier==='Decline')outside('TA-DECLINE-FACTOR','A documented individual factor is rated Decline; it is not overridden by a favorable build or another condition.','9');
  if(tier==='Graded'&&(age>80||face>25000))outside('TA-GRADED-LIMIT','Graded criteria do not fit the requested case: maximum age 80 and $25,000.','4');
  if(tier==='Premier'&&(c.state==='CA'||face<10000))r.gaps.push('Premier is unavailable in California and below $10,000. Confirm the available Select offer with the carrier.');
  const tobacco=a.taTobacco12==='yes'?'Tobacco':a.taTobacco12==='no'?'Nontobacco':'tobacco status unknown';
  if(r.status!=='outside'&&factors.length){
    r.tier=`${tier}${tier==='Premier'?'':' '+tobacco} — individual-factor classification`;
    r.tierKind='ceiling';r.benefit=tier==='Graded'?'graded':'immediate';
    if(!r.gaps.length){
      r.status='candidate';r.tierKind='candidate';r.tier=`${tier}${tier==='Premier'?'':' '+tobacco} candidate`;
      r.commissionKey=tier==='Premier'?'ta-premier':`ta-${tier.toLowerCase()}-${a.taTobacco12==='yes'?'y':'n'}`;
      r.commissionGroup=`${r.benefit}:reviewed-state-application`;
      evidence('TA-APPLICATION','Provisional candidate based on the individual rules and the agent’s current-application confirmation, not an approval.','8–9');
    }
  }
  return r;
}
