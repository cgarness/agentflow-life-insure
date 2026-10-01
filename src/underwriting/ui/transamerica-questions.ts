import { CaseInput } from '../types';
import { el, add } from './dom';
import { answer, input, select, Option } from './fields';

export function transamericaQuestions(c:CaseInput,change:()=>void,rerender:()=>void):HTMLElement {
  const root=el('details','rounded-xl border border-slate-200 p-4');
  add(root,el('summary','min-h-[44px] cursor-pointer text-sm font-semibold leading-6 text-slate-800','Transamerica — source-specific follow-ups'));
  const body=el('div','mt-4 space-y-4');
  add(body,el('p','text-xs leading-6 text-slate-500','08/26 guide. Expand to refine Transamerica. Unanswered questions stay Unknown; they do not prevent reviewing the other carriers.'));
  const changed=()=>{c.answers.taReviewed='';change();};
  const ask=(key:string,title:string,help?:string)=>add(body,answer(key,title,c.answers[key]??'',v=>{c.answers[key]=v;changed();rerender();},help));
  const text=(key:string,title:string,help?:string)=>add(body,input(key,title,c.details[key]??'',v=>{c.details[key]=v;changed();},{type:'number',min:'0',max:'1200',step:'1',help}));
  const pick=(key:string,title:string,values:Option[])=>add(body,select(key,title,c.details[key]??'',[['','Choose / Unknown'],...values],v=>{c.details[key]=v;changed();rerender();}));
  ask('taTobacco12','Any tobacco use less than one year ago?','Use actual tobacco history, not nicotine replacement alone. Select Unknown at exactly one year; the single-condition row does not specify that boundary.');
  ask('taCurrentSupport','Any current listed care or terminal-illness situation?','Currently bedridden; nursing home, assisted living or long-term care; hospice, palliative care, home healthcare or adult daycare; or a current terminal diagnosis with life expectancy of 12 months or less.');
  ask('taHospital','Two or more hospitalizations within the past year?','Exclude hospitalizations for childbirth, as the guide specifies.');
  ask('taPending','Any listed pending medical evaluation within six months?','Pending medical tests, surgery, hospitalization, diagnosis or test results. Check the actual application for scope.');
  ask('taLegal','Current incarceration, probation/parole, or recent felony charges?','Current jail/probation/parole or felony charges/awaiting trial within two years. Exact boundary or unclear history: Unknown.');
  ask('taLifestyle','Any alcohol/drug treatment, DUI, suicide attempt or psychiatric hospitalization history?','A Yes requires the exact diagnosis/event and applicable lookback; it is not an automatic decline.');
  if(c.conditions.length>1||(c.conditions.length&&c.answers.taTobacco12==='yes'))
    ask('taUnrelated','Confirmed that the conditions and lifestyle factors are unrelated?','Only Yes when a current carrier assessment supports treating them as unrelated. Related or uncertain combinations need review.');
  if(c.conditions.includes('cad'))ask('taCadSimple','Coronary artery disease with NO heart attack and NO cardiac surgery?','The Premier single-condition row has both restrictions.');
  if(c.conditions.includes('heart_attack')){ask('taMultipleMi','More than one heart attack?');if(c.answers.taMultipleMi==='no')text('taMiMonths','Completed months since the single heart attack');}
  if(c.conditions.includes('heart_surgery'))text('taSurgeryMonths','Completed months since the most recent listed cardiac procedure','Pacemaker, stent, valve replacement, bypass or angioplasty. A defibrillator is a different condition; select Another diagnosis as well.');
  if(c.conditions.includes('stroke')){
    pick('taStrokeType','Stroke / TIA history',[['stroke','Stroke'],['single-tia','A single TIA only'],['multiple-tia','Multiple TIAs, no stroke']]);
    if(['stroke','multiple-tia'].includes(c.details.taStrokeType??''))text('taStrokeMonths','Completed months since the most recent stroke / TIA');
  }
  if(c.conditions.includes('diabetes')){
    text('taDiabetesAge','Age when diabetes was diagnosed');ask('taInsulin12','Insulin used within the last 12 months?');
    ask('taDiabetesComplication','Diabetic eye, kidney or nerve complication?','The Transamerica row names these complications. Other complications still need review.');
    ask('taDiabetesRelated','Heart, stroke/TIA, vascular, kidney or liver comorbidity?','These are the specific comorbidities named in the diabetes footnote.');
  }
  if(c.conditions.includes('kidney'))pick('taKidneyType','Kidney diagnosis',[['mild','Mild/moderate insufficiency; NO failure or recurrent dialysis'],['other','Failure, dialysis, another diagnosis, or uncertain']]);
  if(c.conditions.includes('liver'))pick('taLiverType','Liver diagnosis',[['cirrhosis','Cirrhosis'],['failure','Liver failure'],['other','Another liver diagnosis / uncertain']]);
  if(c.conditions.includes('transplant'))ask('taOrganTransplant','Organ transplant received or recommended?','A tissue-only transplant is not silently mapped to the organ-transplant row.');
  if(c.conditions.includes('cancer')){
    pick('taCancerType','Cancer type',[['breast','Breast'],['testicular','Testicular'],['cervical','Cervical'],['prostate','Prostate'],['melanoma','Melanoma'],['thyroid','Thyroid'],['bladder','Bladder'],['kidney','Kidney'],['colorectal','Colorectal'],['other','Other cancer type']]);
    ask('taCancerSpread','Any spread, recurrence or multiple-site cancer?','Confirm lymph nodes and metastatic history; a simple “in remission” label does not answer this.');
    ask('taCancerComplete','All recommended cancer treatment completed?');
    text('taCancerMonths','Completed months since the last cancer treatment');
    if(['testicular','cervical','melanoma'].includes(c.details.taCancerType??''))ask('taCancerSurgeryOnly','Treatment was surgery only?','No chemotherapy, radiation or other treatment. This is an explicit footnote restriction.');
  }
  ask('taEligibility','State and nonmedical eligibility requirements verified?','Confirm the current state form, insured as owner, insurable interest, and U.S. citizenship or a valid green card that will not expire within the next 90 days. Do not enter identifying documents.');
  add(body,input('taForm','Transamerica application form / version / state',c.details.taForm??'',v=>{c.details.taForm=v;changed();},{maxLength:250,placeholder:'Form number, revision and state — no client information'}));
  add(body,answer('taReviewed','Current application and complete history reviewed?',c.answers.taReviewed??'',v=>{c.answers.taReviewed=v;change();rerender();},'Confirm all reported health, medication and lifestyle facts against the current application. This does not substitute for carrier data checks.'));
  add(root,body);return root;
}
