import { CaseInput, Result } from '../types';
/** Source hold is intentional. Re-enable only with one coherent, version-pinned carrier document. */
export function transamerica(_c:CaseInput):Result {
  return {carrier:'transamerica',name:'Transamerica',product:'FE Express Solution',status:'hold',tier:'Source verification required',
    tierKind:'unknown',benefit:'unconfirmed',reasons:[{rule:'TA-SOURCE-CONFLICT',source:'TA_HOLD',page:'4, 10',
      text:'Retrieved text and rendered pages disagree on product limits and Premier versus Select classifications.'}],
    gaps:['Upload or verify one complete, current Agent Guide before automatic Transamerica tiering is enabled.'],
    warnings:['No disputed Transamerica rule participates in recommendations or commission ranking.']};
}
