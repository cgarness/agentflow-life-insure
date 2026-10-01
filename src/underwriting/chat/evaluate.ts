import { americo } from '../rules/americo';
import { mutual } from '../rules/mutual';
import { transamerica } from '../rules/transamerica';
import { caseWithBasics } from './basics';
import { statedHistoryScreen } from './assumptions';
import { optionalDetail } from './cardNotes';
import { carrierPlacement } from './placement';
import type { Basics, NotesState, QuickCard } from './types';

export function quickCards(basics: Basics, notes: NotesState): QuickCard[] {
  const actual = caseWithBasics(basics, notes.case);
  const { case: c, assumed } = statedHistoryScreen(notes, actual);
  const native = [americo(c, { checkAmount: false }), transamerica(c, { checkAmount: false }), mutual(c, { checkAmount: false })];
  const uncertain = notes.facts.some(f => f.value === 'unknown') || Object.values(c.answers).some(v => v === 'unknown');
  const recognized = !notes.suggestions.length && !notes.unresolved.length && !uncertain;
  return native.map((r): QuickCard => {
    const placement = carrierPlacement(c, r);
    // A pending spelling correction may affect the asserted exclusion itself.
    // Preserve independently established native exclusions; never fabricate a
    // red or green merely because the parser cannot resolve additional wording.
    const red = r.status === 'outside' || !!placement.excluded;
    const green = !red && recognized && placement.supported;
    const color = red ? 'red' : green ? 'green' : 'yellow';
    let reason = red ? placement.excluded?.text ?? r.reasons[r.reasons.length - 1]?.text ?? 'Outside a published guideline.'
      : green ? 'Supported carrier-level consideration.' : 'Condition recognized; carrier guidance needs review.';
    if (!red && !green) {
      if (notes.suggestions.length) reason = 'Confirm the medication spelling first.';
      else if (notes.unresolved.length) reason = 'Some entered health details are not recognized.';
      else if (uncertain) reason = 'An entered health detail is uncertain or conflicting.';
      else reason = optionalDetail(c, r) ?? reason;
    }
    // Diagnostic evidence remains internal. Compact cards do not render Why,
    // source lists, unconfirmed tier labels, footers or compensation placeholders.
    return { carrier: r.carrier, name: r.name, product: r.carrier === 'transamerica' ? 'FE Express' : r.product,
      color, label: green ? 'Likely fit' : red ? 'Likely decline' : 'Possible fit',
      tier: '', benefit: green ? placement.benefit : 'unconfirmed', reason,
      evidence: [...r.reasons, ...placement.evidence, ...(placement.excluded ? [placement.excluded] : [])],
      gaps: [...r.gaps, ...(assumed.length ? ['Internal quick-screen assumptions apply only to unlisted items; captured facts remain unchanged.'] : []), 'Coverage amount was not supplied.'], native: r };
  }).sort((a, b) => ({ green: 0, yellow: 1, red: 2 }[a.color] - { green: 0, yellow: 1, red: 2 }[b.color]) || a.name.localeCompare(b.name));
}
