export const sources = {
  AM2511: {carrier:'Americo', title:'Eagle Select Final Expense Agent Guide', version:'24-275-1 (11/25)',
    reviewed:'2026-09-30', status:'User-selected baseline; applicable state variations must be checked',
    url:'https://americofinalexpense.com/ES/FinalExpenseAgentGuide.pdf'},
  MO2604: {carrier:'Mutual of Omaha / United of Omaha', title:'Simplified Issue Life Insurance Underwriting Guide — Living Promise sections only',
    version:'618352_0426 / April 2026', reviewed:'2026-09-30', status:'Published text extracted; state application and visual table verification pending',
    url:'https://cdn.mutualofomaha.com/assets/ad238be6-67ff-4113-821f-c6dcba1df065'},
  TA_HOLD: {carrier:'Transamerica', title:'FE Express Solution / Graded FE Express Solution Agent Guide',
    version:'Unresolved: retrieved text 08/26; rendered pages differ', reviewed:'2026-09-30',
    status:'HOLD — do not apply disputed underwriting or product limits',
    url:'https://cdn.bfldr.com/86JM1UOD/as/m7q69ngk78kw39p7w5923h/Transamerica_FE_Expres%E2%80%A6'}
} as const;
export function sourceName(id: string): string {
  return sources[id as keyof typeof sources]?.title ?? 'Implementation validation';
}
