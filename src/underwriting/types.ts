export type Answer = '' | 'yes' | 'no' | 'unknown';
export type CarrierId = 'americo' | 'mutual' | 'transamerica';
export type MedStatus = 'current' | 'stopped' | 'unknown';
export interface Medication { id: string; name: string; indication: string; status: MedStatus }
export interface CaseInput {
  age: string; state: string; height: string; weight: string; face: string;
  nicotine: '' | 'never' | 'current' | 'former' | 'unknown'; nicotineMonths: string;
  conditionsStatus: '' | 'none' | 'listed' | 'unknown'; conditions: string[]; otherCondition: string;
  medicationsStatus: '' | 'none' | 'listed' | 'unknown'; medications: Medication[];
  answers: Record<string, Answer>; details: Record<string, string>;
}
export interface Evidence { rule: string; source: string; page: string; text: string }
export interface Result {
  carrier: CarrierId; name: string; product: string;
  status: 'candidate' | 'possible' | 'review' | 'outside' | 'hold';
  tier: string; tierKind: 'candidate' | 'ceiling' | 'unknown';
  benefit: 'immediate' | 'graded' | 'unconfirmed';
  reasons: Evidence[]; gaps: string[]; warnings: string[];
  commissionKey?: string; commissionGroup?: string;
}
export interface CommissionSchedule {
  basis: 'first-year-commissionable-premium'; reference: string; contract: string;
  effectiveFrom: string; effectiveTo: string; acknowledged: boolean;
  rates: Record<string, string>;
}
export interface ValidationIssue { field: string; message: string; step: number }
export interface Question { id: string; title: string; help?: string; module?: string; source?: string }
export const freshCase = (): CaseInput => ({
  age:'', state:'', height:'', weight:'', face:'', nicotine:'', nicotineMonths:'',
  conditionsStatus:'', conditions:[], otherCondition:'', medicationsStatus:'', medications:[],
  answers:{}, details:{}
});
export const freshSchedule = (): CommissionSchedule => ({basis:'first-year-commissionable-premium',
  reference:'', contract:'', effectiveFrom:'', effectiveTo:'', acknowledged:false, rates:{}});
