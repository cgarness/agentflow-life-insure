import { labelOf } from '../data';
import { CaseInput } from '../types';
import { TransamericaFactor, TransamericaTier } from '../transamerica-data';

// Individual factors only. Combining related conditions remains a separate gate.
export function transamericaConditions(c:CaseInput):{factors:TransamericaFactor[];gaps:string[]} {
  const factors:TransamericaFactor[]=[],gaps:string[]=[];
  const add=(id:string,tier:TransamericaTier,page:string,text:string)=>factors.push({id,tier,page,text});
  const details=c.details,a=c.answers;
  const months=(key:string):number|null=>{const s=details[key]??'';return /^\d{1,4}$/.test(s)&&+s<=Math.min(1200,+c.age*12)?+s:null;};
  // The single-condition table uses strict < / > in these rows. Do not invent
  // an inclusive answer at the exact boundary or an unspecified date anchor.
  const timed=(id:string,key:string,boundary:number,recent:TransamericaTier,older:TransamericaTier,page:string,label:string)=>{
    const n=months(key);
    if(n===null||n===boundary)gaps.push(`${label}: confirm the event timeframe; the exact ${boundary}-month boundary needs carrier clarification.`);
    else add(id,n<boundary?recent:older,page,`${label}: ${n} completed months since the recorded event; individual-condition guidance only.`);
  };
  const fixed:Record<string,[TransamericaTier,string,string]>={
    copd:['Select','11','COPD / emphysema / chronic bronchitis'],chf:['Select','11','Congestive heart failure'],
    afib:['Premier','10','Atrial fibrillation / arrhythmia'],ms:['Select','12','Multiple sclerosis'],
    lupus:['Select','12','Systemic lupus'],parkinson:['Select','13','Parkinson’s disease'],
    als:['Decline','10','ALS'],dementia:['Decline','10–11','Alzheimer’s / dementia'],
    amputation:['Decline','10','Amputation not due to trauma']
  };
  for(const id of c.conditions){
    if(fixed[id]){const [tier,page,label]=fixed[id]!;add(`TA-${id}`,tier,page,`${label}: ${tier} in the single-condition chart.`);continue;}
    switch(id){
      case 'cad':
        if(a.taCadSimple==='yes')add('TA-CAD','Premier','11','Coronary artery disease without myocardial infarction or surgery: Premier individual factor.');
        else gaps.push('Coronary disease: the Premier row applies only with no myocardial infarction or surgery.');break;
      case 'heart_attack':
        if(a.taMultipleMi==='yes')add('TA-MULTIPLE-MI','Select','11','Multiple heart attacks: Select individual factor.');
        else if(a.taMultipleMi==='no')timed('TA-MI','taMiMonths',12,'Select','Premier','11','Single heart attack');
        else gaps.push('Confirm whether the heart-attack history involves multiple events.');break;
      case 'heart_surgery':
        timed('TA-SURGERY','taSurgeryMonths',12,'Select','Premier','10,12','Most recent pacemaker / stent / valve / bypass / angioplasty');break;
      case 'stroke':
        if(details.taStrokeType==='single-tia')add('TA-SINGLE-TIA','Premier','14','A single TIA: Premier individual factor.');
        else if(details.taStrokeType==='stroke')timed('TA-STROKE','taStrokeMonths',60,'Select','Premier','14','Stroke');
        else if(details.taStrokeType==='multiple-tia')timed('TA-MULTIPLE-TIA','taStrokeMonths',12,'Select','Premier','14','Most recent of multiple TIAs');
        else gaps.push('Distinguish stroke, a single TIA, and multiple TIAs.');break;
      case 'diabetes': {
        const age=months('taDiabetesAge');
        if(a.taInsulin12==='yes')add('TA-INSULIN','Select','11','Insulin use within the previous 12 months: Select individual factor.');
        if(a.taDiabetesComplication==='yes')add('TA-DIABETES-COMPLICATION','Select','11','Diabetes with eye, kidney or nerve complications: Select individual factor.');
        if(age!==null&&age<40)add('TA-DIABETES-EARLY','Select','11','Diabetes diagnosed before age 40: Select individual factor.');
        if(!['yes','no'].includes(a.taInsulin12??'')||!['yes','no'].includes(a.taDiabetesComplication??'')||age===null||age>+c.age||age===40)
          gaps.push('Complete diabetes diagnosis age, insulin and complication history; age 40 exactly is not assigned by the published row.');
        else if(age>40&&a.taInsulin12==='no'&&a.taDiabetesComplication==='no'){
          if(a.taDiabetesRelated==='no')add('TA-DIABETES-PREMIER','Premier','11','Diagnosed after 40, without insulin, complications or listed comorbidities: Premier individual factor.');
          else gaps.push('Diabetes: confirm heart, stroke/TIA, vascular, kidney and liver comorbidities.');
        }
        if(a.diabetesComplication==='yes'&&a.taDiabetesComplication!=='yes')gaps.push('Other diabetic complications need exact carrier assessment.');
        if(c.conditions.some(x=>['chf','cad','heart_attack','heart_surgery','stroke','pvd','kidney','liver'].includes(x)))
          gaps.push('Diabetes with a listed comorbidity needs carrier combination review; do not treat it as unrelated.');
        break;
      }
      case 'pvd':add('TA-PVD',c.conditions.includes('amputation')?'Decline':'Select','13','Peripheral vascular disease: Select without amputation; Decline when associated with amputation.');break;
      case 'kidney':
        if(details.taKidneyType==='mild')add('TA-KIDNEY-MILD','Premier','10','Mild/moderate kidney insufficiency without failure or recurrent dialysis: Premier individual factor.');
        else gaps.push('Renal failure/dialysis requires carrier clarification of the time-frame anchor; duration on dialysis is not time since treatment.');break;
      case 'liver':
        if(details.taLiverType==='cirrhosis')add('TA-CIRRHOSIS','Graded','10','Cirrhosis: Graded individual factor.');
        else if(details.taLiverType==='failure')add('TA-LIVER-FAILURE','Graded','12','Liver failure: Graded individual factor.');
        else gaps.push('Other liver diagnoses require exact diagnosis and the carrier’s applicable time-frame interpretation.');break;
      case 'transplant':
        if(a.taOrganTransplant==='yes')add('TA-TRANSPLANT','Decline','13','Organ transplant recipient or recommended transplant: Decline.');
        else gaps.push('The Transamerica row specifies organ transplant; do not silently extend it to every tissue transplant.');break;
      case 'sleep_apnea':
        if(a.oxygen12==='no')add('TA-SLEEP-APNEA','Premier','14','Sleep apnea / CPAP without supplemental oxygen: Premier individual factor.');
        else gaps.push('Sleep apnea: clarify oxygen/concentrator use separately from a CPAP device.');break;
      case 'cancer': {
        const n=months('taCancerMonths'),type=details.taCancerType;
        if(a.taCancerSpread==='yes'){add('TA-CANCER-SPREAD','Decline','10','Spread, recurrent, or multiple-site cancer: Decline.');break;}
        if(a.taCancerSpread!=='no'||a.taCancerComplete!=='yes'||n===null){gaps.push('Cancer: confirm type, spread/recurrence, completed treatment and months since last treatment.');break;}
        if(['testicular','cervical','melanoma'].includes(type??'')&&a.taCancerSurgeryOnly!=='yes'){
          gaps.push('Testicular/cervical/melanoma chart rows require surgery only, without chemo, radiation or other treatment.');break;}
        let tier:TransamericaTier;
        if(n<24)tier='Decline';
        else if(['breast','testicular'].includes(type??''))tier=n<48?'Select':'Premier';
        else if(['cervical','prostate','melanoma'].includes(type??''))tier=n<60?'Select':'Premier';
        else if(type==='thyroid')tier='Premier';
        else if(['bladder','kidney','colorectal'].includes(type??''))tier=n<48?'Graded':n<120?'Select':'Premier';
        else if(type==='other')tier=n<48?'Graded':'Select';
        else {gaps.push('Confirm the cancer type against the current cancer table.');break;}
        add('TA-CANCER',tier,'15',`${type} cancer: ${n} months since completed treatment, under the table’s no-spread/no-recurrence assumptions.`);break;
      }
      default:gaps.push(`${labelOf(id)}: no complete, verified rule for this selected diagnosis in this implementation; carrier review required.`);
    }
  }
  return {factors,gaps};
}
