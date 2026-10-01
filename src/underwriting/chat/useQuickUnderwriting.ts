import { useMemo, useState } from 'react';
import { basicsErrors, caseWithBasics, noteSchema } from './basics';
import { extractNote } from './parse';
import { applyExtraction, confirmMedication, freshNotes, removeFact } from './session';
import { contextualReply, nextQuestions, answerQuestion } from './questions';
import { quickCards } from './evaluate';
import { emptyBasics, type ChatTurn, type Followup, type NotesState } from './types';

export function useQuickUnderwriting() {
  const [basics, setBasics] = useState(emptyBasics);
  const [notes, setNotes] = useState(freshNotes);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [editingBasics, setEditingBasics] = useState(true);
  const errors = useMemo(() => basicsErrors(basics), [basics]);
  const ready = !Object.keys(errors).length;
  const current = useMemo(() => ready ? { ...notes, case: caseWithBasics(basics, notes.case) } : notes, [basics, notes, ready]);
  const cards = useMemo(() => ready && turns.length ? quickCards(basics, current) : [], [basics, current, ready, turns.length]);
  const questions = useMemo(() => turns.length ? nextQuestions(current) : [], [current, turns.length]);
  function record(text: string, next: NotesState, response: string) {
    setNotes(next);
    setTurns(previous => {
      const id = (previous[previous.length - 1]?.id ?? -1) + 1;
      return [...previous, { id, role: 'user' as const, text }, { id: id + 1, role: 'assistant' as const, text: response }].slice(-40);
    });
    setDraft(''); setError(''); setEditingBasics(false);
  }
  function send() {
    if (!ready) { setFieldErrors(errors); setEditingBasics(true); setError('Complete the client basics first.'); return; }
    const valid = noteSchema.safeParse(draft);
    if (!valid.success) { setError(valid.error.issues[0]?.message ?? 'Add a health note.'); return; }
    const text = valid.data;
    // This is not an identifying client-record intake. Keep identifiers out of
    // the chat rather than relying on a nonexistent server-side redaction step.
    if (/[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{3}[- ]\d{2}[- ]\d{4}\b|\b\d{3}[- .]\d{3}[- .]\d{4}\b/i.test(text)) {
      setError('Remove the client’s email, phone or identifying numbers. Health details only.'); return;
    }
    const reply = contextualReply(current, text, questions);
    if (reply) { record(text, reply, 'Updated. Here’s the current carrier read.'); return; }
    if (/^(?:yes|no|not sure|unknown)$/i.test(text) && questions.length > 1) {
      setError('Use the reply buttons so I know which question you’re answering.'); return;
    }
    const extraction = extractNote(text, current);
    if (!extraction.facts.length && !extraction.medications.length && !extraction.suggestions.length && !extraction.unresolved.length) {
      setError('Add the client’s health details. Family history alone does not describe this client.'); return;
    }
    const next = applyExtraction(current, extraction, text);
    if (next.case.medications.length > 25) { setError('More than 25 medications need a carrier review. This note was not added.'); return; }
    const response = next.suggestions.length ? 'Check the medication spelling below.' : next.unresolved.length
      ? 'I picked up the details below. Some wording needs clarification.' : 'Got it. Here’s the quick carrier read.';
    record(text, next, response);
  }
  function answer(q: Followup, value: string) {
    if (value === 'type') { setError('Type the additional detail in the chat below.'); return; }
    const next = answerQuestion(current, q, value);
    if (next === current) return;
    const choice = q.options.find(o => o.value === value)?.label ?? value;
    record(`${q.text} ${choice}`, next, 'Updated.');
  }
  function reset() {
    setBasics(emptyBasics()); setNotes(freshNotes()); setTurns([]); setDraft(''); setError(''); setFieldErrors({}); setEditingBasics(true);
  }
  function remove(id: string) { setNotes(s => {
    const label = s.facts.find(f => f.id === id)?.label;
    return s.facts.filter(f => f.label === label).reduce((next, f) => removeFact(next, f.id), s);
  }); }
  function acceptMedication(id: string, name: string) { setNotes(s => confirmMedication(s, id, name)); }
  function rejectMedication(id: string) {
    setNotes(s => { const suggestion = s.suggestions.find(x => x.id === id);
      return { ...s, suggestions: s.suggestions.filter(x => x.id !== id), unresolved: [...s.unresolved, suggestion?.entered ?? 'Medication name'].slice(0, 20), revision: s.revision + 1 }; });
  }
  function clearUnresolved(text: string) {
    setNotes(s => ({ ...s, unresolved: s.unresolved.filter(x => x !== text), revision: s.revision + 1 }));
  }
  function changeBasics(next: typeof basics) { setBasics(next); setFieldErrors({}); setError(''); }
  return { basics, setBasics: changeBasics, notes: current, turns, draft, setDraft, error, fieldErrors, editingBasics, setEditingBasics,
    ready, cards, questions, send, answer, reset, remove, acceptMedication, rejectMedication, clearUnresolved };
}
