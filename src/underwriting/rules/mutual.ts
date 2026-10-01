import { CaseInput, Result, Evidence } from '../types';
import { mutualBuild, mutualRxExclude, mutualRxStarred, mutualRxIndication, normalizeMedication } from '../data';
import { nicotineClass } from '../validation';
const e=(rule:string,text:string,page:string):Evidence=>({rule,source:'MO2604',page,text});
const contains=(list:string[],s:string)=>list.some(x=>normalizeMedication(x)===normalizeMedication(s));
export function mutual(c:CaseInput, options: { checkAmount?: boolean } = {}):Result {
  const r:Result={carrier:'mutual',name:'Mutual of Omaha',product:'Living Promise',status:'review',tier:'Level / Graded unconfirmed',
    tierKind:'unknown',benefit:'unconfirmed',reasons:[],gaps:[],warnings:[
      'April 2026 source text and Living Promise build/Rx tables visually verified; exact state-application mapping remains partial.',
      'The carrier uses MIB, pharmaceutical and medical-data checks; this is not an approval.']};
  const age=+c.age,face=+c.face,a=c.answers;
  const outside=(rule:string,text:string,page:string)=>{r.status='outside';r.reasons.push(e(rule,text,page));};
  if(age<45||age>85)outside('MO-AGE','Outside published Living Promise issue ages of 45–85.','1');
  if(options.checkAmount!==false&&(face<2000||face>50000))outside('MO-FACE','Requested coverage is outside the published Level range of $2,000–$50,000 (state variations apply).','1');
  const i=+c.height-mutualBuild.first,lo=mutualBuild.min[i],level=mutualBuild.level[i],graded=mutualBuild.graded[i];
  let needsGraded=false;
  if(lo===undefined||level===undefined||graded===undefined)r.gaps.push('Height has no row in the published Living Promise build chart.');
  else if(+c.weight<lo||+c.weight>graded)outside('MO-BUILD',`Outside published build limits ${lo}–${graded} lb; verify the current chart.`,'2');
  else if(+c.weight>level){needsGraded=true;r.reasons.push(e('MO-BUILD-GRADED',`Above the published Level maximum ${level} lb; within Graded maximum ${graded} lb.`,'2'));}
  else r.reasons.push(e('MO-BUILD-LEVEL',`Within the published Level build range ${lo}–${level} lb.`,'2'));
  for(const med of c.medications) {
    if(med.status==='stopped'){r.gaps.push(`${med.name}: discontinued treatment needs the applicable condition/lookback assessment.`);continue;}
    if(med.status==='unknown'){r.gaps.push(`${med.name}: confirm whether currently taken.`);continue;}
    if(contains(mutualRxExclude,med.name))outside('MO-RX-EXCLUDED',`${med.name} matches a current-medication exclusion in the Living Promise section.`,'16');
    else if(contains(mutualRxStarred,med.name)){
      needsGraded=true;r.reasons.push(e('MO-RX-STAR',`${med.name} is starred: Graded may be available, not guaranteed.`,'16'));
      r.gaps.push(`${med.name}: confirm the starred-drug exception and all other underwriting requirements.`);
    }else if(contains(mutualRxIndication,med.name)){
      r.reasons.push(e('MO-RX-INDICATION',`${med.name} appears in the list requiring the prescription reason.`,'17'));
      r.gaps.push(`${med.name}: ${med.indication.trim()?'indication recorded; apply the current application rule.':'prescription indication is required.'}`);
    }else r.gaps.push(`${med.name}: no verified exact-match outcome. Absence from the drug list is not clearance.`);
  }
  if(a.moReviewed!=='yes'||!c.details.moForm?.trim())r.gaps.push('Review the current state-specific Living Promise application and record its form/version.');
  if(a.moState!=='yes')r.gaps.push('Confirm state availability and the applicable application/form variations.');
  if(a.moState==='no')outside('MO-STATE-CHECK','Agent reports the product is not available under the applicable state form.','1');
  if(a.moPart1==='yes'){
    r.reasons.push(e('MO-PART1','A Yes in Part One means the applicant may not be eligible; the summary is not a categorical decline rule.','9'));
    r.gaps.push('A Part One Yes requires the exact state question and carrier decision.');
  }else if(a.moPart1!=='no')r.gaps.push('Part One health answers have not been confirmed.');
  if(a.moPart2==='yes'){
    needsGraded=true;r.reasons.push(e('MO-PART2','Part Two Yes limits the application to Graded consideration.','9'));
  }else if(a.moPart2!=='no')r.gaps.push('Part Two health answers have not been confirmed.');
  if(needsGraded){
    r.tier='Graded consideration only';r.tierKind='ceiling';r.benefit='graded';
    if(age>80||(options.checkAmount!==false&&face>20000))outside('MO-GRADED-LIMIT','Graded consideration does not fit the requested age or amount: maximum age 80 / $20,000.','1');
  }
  if(nicotineClass(c,12)==='unknown')r.gaps.push('Confirm the 12-month nicotine history.');
  if(c.conditionsStatus==='unknown'||c.medicationsStatus==='unknown')r.gaps.push('Complete the diagnosis and medication history.');
  if(c.conditions.length)r.gaps.push('Declared diagnoses require exact state-application question mapping; a Part One/Part Two summary alone does not establish their classification.');
  if(c.conditions.includes('other'))r.gaps.push('An additional diagnosis requires source-specific assessment.');
  if(['oxygen12','adl12','hospice12','mobility12','pending'].some(k=>a[k]!=='no'))
    r.gaps.push('Safety-screen answers need reconciliation with the current application; do not transfer Americo’s rules to Living Promise.');
  if(r.status!=='outside'&&r.gaps.length===0){
    r.status='candidate';r.tier=needsGraded?'Graded candidate':'Level candidate';r.tierKind='candidate';r.benefit=needsGraded?'graded':'immediate';
    r.commissionKey=needsGraded?'mo-graded':'mo-level';r.commissionGroup=`${r.benefit}:reviewed-state-application`;
    r.reasons.push(e('MO-APPLICATION','Candidate based on the agent’s current-state application confirmation, subject to all carrier checks.','9'));
  }
  return r;
}
