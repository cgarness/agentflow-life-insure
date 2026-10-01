import { CaseInput, Result, Evidence } from '../types';
import { americoBuild, americoKnockouts, labelOf } from '../data';
import { nicotineClass } from '../validation';
const e=(rule:string,text:string,page='10'):Evidence=>({rule,source:'AM2511',page,text});
export function americo(c:CaseInput, options: { checkAmount?: boolean } = {}):Result {
  const r:Result={carrier:'americo',name:'Americo',product:'Eagle Select',status:'possible',tier:'Tier not established',
    tierKind:'unknown',benefit:'unconfirmed',reasons:[],gaps:[],warnings:['Field guidance only. Americo also evaluates third-party medical and prescription information.']};
  const age=+c.age,face=+c.face,nic=nicotineClass(c,24), a=c.answers;
  const outside=(rule:string,text:string,page='10')=>{r.status='outside';r.reasons.push(e(rule,text,page));};
  if(age<40||age>85)outside('AM-AGE','Outside the documented Eagle Select issue ages of 40–85.','5');
  if(c.state==='NY')outside('AM-NY','The guide identifies the issuing company as not authorized in New York.','11');
  if(options.checkAmount!==false&&(face<5000||face>(age<=75?50000:40000)))outside('AM-FACE','Requested coverage is outside the age-specific published range.','5');
  const i=+c.height-americoBuild.first,lo=americoBuild.min[i],hi=americoBuild.max[i];
  if(lo===undefined||hi===undefined)r.gaps.push('Height is not in the published build chart. Do not interpolate.');
  else if(+c.weight<lo||+c.weight>hi)outside('AM-BUILD',`Outside the published ${lo}–${hi} lb range for this height.`);
  else r.reasons.push(e('AM-BUILD',`Within the published build range: ${lo}–${hi} lb.`));
  for(const id of c.conditions.filter(x=>americoKnockouts.includes(x)))outside(`AM-KO-${id}`,`${labelOf(id)} is listed as a knockout.`);
  for(const [key,label] of [['oxygen12','Supplemental oxygen within 12 months'],['adl12','Specified ADL assistance / bed-bound status within 12 months'],
    ['hospice12','Hospice within 12 months'],['mobility12','Wheelchair / motorized mobility dependence within 12 months'],
    ['pending','Specified unresolved testing, diagnosis, procedure or hospitalization']] as const) {
    if(a[key]==='yes')outside(`AM-SAFETY-${key}`,`${label} is a published declinable circumstance.`);
    else if(a[key]!=='no')r.gaps.push(`Confirm: ${label.toLowerCase()}.`);
  }
  if(nic==='unknown')r.gaps.push('Nicotine classification requires a confirmed 24-month history.');
  const heart=a.heartQuestion==='yes',resp=a.respQuestion==='yes',stroke=a.strokeQuestion==='yes';
  const diabetes=c.conditions.includes('diabetes'),pvd=c.conditions.includes('pvd');
  const cap=(rule:string,text:string,n:'yes'|'no'|'unknown')=>{
    r.tier=`No better than Select 2${n==='unknown'?'':n==='yes'?' Nicotine':' Non-nicotine'}`;
    r.tierKind='ceiling';r.reasons.push(e(rule,text,'9–10'));
    // A ceiling is not evidence that Select 2 (or Select 3) will actually be issued.
    if(age>75&&n==='yes')outside('AM-CAP-AGE','Select 1 is capped out and Select 2 Nicotine / Select 3 issue ages end at 75.','5, 9');
  };
  if(nic==='yes') {
    if(resp)cap('AM-RESP-NIC','Respiratory-question Yes plus nicotine excludes Select 1.','yes');
    if(heart)cap('AM-HEART-NIC','Heart-disease-question Yes plus nicotine excludes Select 1.','yes');
    if(stroke)cap('AM-STROKE-NIC','Stroke/TIA-question Yes plus nicotine excludes Select 1.','yes');
    if(diabetes)cap('AM-DIAB-NIC','The smoking/diabetes summary identifies Select 2 Smoker as the available ceiling.','yes');
    if(pvd)cap('AM-PVD-NIC','PVD plus nicotine caps the class at Select 2 Nicotine.','yes');
  }
  if(nic==='no'&&[heart,diabetes,stroke].filter(Boolean).length>=2)
    cap('AM-COMBINATION','Two or more of heart disease, diabetes and stroke/TIA cap the class at Select 2 Non-nicotine.','no');
  if(pvd&&diabetes)cap('AM-PVD-DIAB','PVD plus diabetes caps the class at Select 2; the rule does not specify a nicotine class.',nic);
  if(diabetes&&!['yes','no'].includes(a.diabetesComplication??''))r.gaps.push('Confirm whether diabetes has associated complications.');
  if(diabetes&&a.diabetesComplication==='yes')r.gaps.push('The diabetes-complication bullet specifies “Select 2 Nicotine” without explaining nonsmoker handling. Carrier clarification is required.');
  if(c.conditions.some(id=>['copd','asthma','sleep_apnea'].includes(id))&&!['yes','no'].includes(a.respQuestion??''))
    r.gaps.push('Confirm the actual Americo respiratory-question response; diagnosis selection alone is not the application.');
  if(c.conditions.some(id=>['cad','chf','afib','heart_attack','heart_surgery'].includes(id))&&!['yes','no'].includes(a.heartQuestion??''))
    r.gaps.push('Confirm the actual Americo heart-disease-question response.');
  if(c.conditions.includes('stroke')&&!['yes','no'].includes(a.strokeQuestion??''))r.gaps.push('Confirm the actual stroke/TIA-question response.');
  if(a.amState!=='yes')r.gaps.push('Confirm current product and form availability in the applicant’s state.');
  if(a.amState==='no')outside('AM-STATE-CHECK','Agent reports the applicable product is unavailable in this state.','11');
  if(c.conditionsStatus==='unknown')r.gaps.push('The diagnosis history is incomplete.');
  if(c.medicationsStatus==='unknown'||c.medications.length)r.gaps.push('Current Americo medication eligibility is not established by this guide; carrier prescription review is still required.');
  if(c.conditions.includes('other'))r.gaps.push('The additional diagnosis has no verified rule in this baseline.');
  if(r.status!=='outside'&&r.gaps.length)r.status='review';
  if(r.status!=='outside')r.gaps.push(r.tierKind==='ceiling'?'Select 2 is a ceiling, not a confirmed offer; Select 3 or decline remains possible.':'Passing these checks does not establish Select 1 eligibility. The guide is not an exhaustive decision matrix.');
  r.warnings.push('Select 1/2 nicotine policies use Quit Smoking Advantage; the default benefit decreases in year 4 without an eligible alternative election.');
  return r;
}
