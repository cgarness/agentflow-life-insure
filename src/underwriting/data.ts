export const states = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
export const conditions: {id:string; label:string; module:string}[] = [
  {id:'copd',label:'COPD / emphysema / chronic bronchitis',module:'respiratory'},
  {id:'asthma',label:'Asthma',module:'respiratory'},
  {id:'diabetes',label:'Diabetes',module:'diabetes'},
  {id:'chf',label:'Congestive heart failure (CHF)',module:'heart'},
  {id:'cad',label:'Coronary artery / heart disease',module:'heart'},
  {id:'heart_attack',label:'Heart attack',module:'heart'},
  {id:'heart_surgery',label:'Stent / bypass / heart surgery',module:'heart'},
  {id:'afib',label:'Atrial fibrillation / arrhythmia',module:'heart'},
  {id:'stroke',label:'Stroke / TIA',module:'stroke'},
  {id:'pvd',label:'Peripheral vascular disease (PVD)',module:'vascular'},
  {id:'kidney',label:'Kidney disease / dialysis',module:'kidney'},
  {id:'cancer',label:'Cancer history',module:'cancer'},
  {id:'liver',label:'Liver disease',module:'liver'},
  {id:'leukemia',label:'Leukemia',module:'cancer'},
  {id:'transplant',label:'Organ / tissue transplant',module:'other'},
  {id:'ms',label:'Multiple sclerosis',module:'neurological'},
  {id:'lupus',label:'Systemic lupus',module:'other'},
  {id:'als',label:'ALS',module:'neurological'},
  {id:'dementia',label:'Alzheimer’s / dementia',module:'neurological'},
  {id:'huntington',label:'Huntington’s disease',module:'neurological'},
  {id:'brain_tumor',label:'Brain tumor',module:'neurological'},
  {id:'parkinson',label:'Parkinson’s disease',module:'neurological'},
  {id:'amputation',label:'Amputation due to disease',module:'other'},
  {id:'sleep_apnea',label:'Sleep apnea',module:'respiratory'},
  {id:'mental',label:'Mental health condition',module:'mental'},
  {id:'substance',label:'Alcohol / substance treatment',module:'substance'},
  {id:'other',label:'Another diagnosis',module:'other'}
];
export const labelOf = (id:string):string => conditions.find(c=>c.id===id)?.label ?? id;
// AM2511, printed p10 / PDF p11. Exact table, no BMI approximation or interpolation.
export const americoBuild = {
  first:56,
  min:[79,81,84,87,90,93,96,99,102,106,109,112,116,119,122,126,130,133,137,141,144,148,152,156],
  max:[198,205,212,220,227,235,243,251,259,267,275,284,292,301,310,319,328,337,346,356,365,375,385,395]
};
// MO2604 printed p2 / PDF p5. TEXT extraction only: gated pending visual verification.
export const mutualBuild = {
  first:56,
  min:[74,77,79,82,85,88,91,94,97,100,103,106,109,112,115,119,122,126,129,133,136,140,143,147,151,154,158],
  level:[204,209,214,220,226,233,239,246,252,259,268,275,283,291,300,307,315,322,331,339,348,357,366,375,385,395,407],
  graded:[221,225,231,237,244,250,257,264,270,277,285,293,300,309,316,325,333,340,349,358,367,376,385,394,405,415,427]
};
export const americoKnockouts = ['transplant','ms','lupus','als','dementia','huntington','brain_tumor','parkinson','amputation','liver','leukemia'];
// MO2604 Living Promise prescription section ONLY; not the TLE/IULE tables.
// Keys are explicit source spellings. Exact matching, no inferred class/generic substitutions.
export const mutualRxExclude = ['Abacavir','Alkeran','Aricept','Atripla','Campath','Caprelsa','Casodex','Cellcept','Cognex',
  'Combivir','Crixivan','Cyclosporine','Cytoxan','Donepezil','Droxia','Eligard','Epivir HBV','Ergoloid Mesylates','Exelon',
  'Floxuridine','Fluorouracil','Galantamine Hydrobromide','Gammagard','Gamunex','Gengraf','Hydrea','Hydroxyurea','Invirase',
  'Isentress','Keytruda','Leucovorin Calcium','Lexiva','Megace','Megestrol Acetate','Mitomycin','Mycophenolate Mofetil',
  'Myfortic','Namenda','Neupogen','Opdivo','Panretin','Prograf','Razadyne','Retrovir','Revlimid','Rituxan','Sandimmune',
  'Stribild','Sustiva','Targretin','Teslac','Viracept','Viramune','Viread','Zenapax','Zerit','Ziagen','Zidovudine','Zoladex'];
export const mutualRxStarred = ['Amiodarone','Ampyra','Anoro Ellipta','Antabuse','Avonex','Azilect','Betaseron','Calcium Acetate',
  'Campral','Carbidopa/Levodopa','Chlorpromazine Hcl','Clozapine','Copaxone','Daliresp','Geodon','Haldol','Haloperidol',
  'Invega','Latuda','Lithium','Naloxone Hcl','Naltrexone Hcl','Perphenazine','Ranexa','Rebif','Revia','Ribavirin','Risperdal',
  'Saphris','Sinemet','Spiriva','Stalevo','Suboxone','Symbyax','Tudorza','Zyprexa'];
export const mutualRxIndication = ['Abilify','Aggrenox','Arimidex','Baraclude','Carvedilol','Clopidogrel','Coreg','Coumadin',
  'Digitek','Digoxin','Eliquis','Enoxaparin Sodium','Femara','Infergen','Lanoxin','Lovenox','Pegasys','Peg-Intron','Plavix',
  'Pradaxa','Seroquel','Tamoxifen','Truvada','Warfarin','Xarelto'];
export const normalizeMedication = (s:string):string => s.trim().replace(/\s+/g,' ').toLowerCase();
export const commissionProducts = [
  ['am-s1-n','Americo · Select 1 Non-nicotine'],['am-s1-y','Americo · Select 1 Nicotine'],
  ['am-s2-n','Americo · Select 2 Non-nicotine'],['am-s2-y','Americo · Select 2 Nicotine'],['am-s3','Americo · Select 3'],
  ['mo-level','Mutual of Omaha · Living Promise Level'],['mo-graded','Mutual of Omaha · Living Promise Graded'],
  ['ta-premier','Transamerica · Premier — source on hold'],['ta-select','Transamerica · Select — source on hold'],
  ['ta-graded','Transamerica · Graded — source on hold']
] as const;
