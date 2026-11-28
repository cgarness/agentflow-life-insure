import { useCallback, useLayoutEffect, useRef } from "react";

type TextControl = HTMLInputElement | HTMLTextAreaElement;
/** A cursor position is only meaningful for the text it was read from. */
interface Caret { start: number; end: number; text: string }

/**
 * Insert text into a controlled Input or Textarea where the author left the cursor.
 * A selection is replaced, the surrounding text is kept, and a field that was never
 * focused receives the text at its end. Focus returns to the field with the cursor after the insertion.
 */
export function useInsertAtCursor(value: string, onChange: (next: string) => void) {
  const element = useRef<TextControl | null>(null);
  const caret = useRef<Caret | null>(null);
  const pending = useRef<Caret | null>(null);

  const ref = useCallback((node: TextControl | null) => { element.current = node; }, []);

  const remember = useCallback(() => {
    const node = element.current;
    if (!node) return;
    const start = node.selectionStart ?? node.value.length;
    caret.current = {start, end: node.selectionEnd ?? start, text: node.value};
  }, []);

  const place = useCallback((target: Caret) => {
    const node = element.current;
    if (!node || node.value !== target.text) return;
    node.focus();
    node.setSelectionRange(target.start, target.end);
    caret.current = target;
  }, []);

  const insert = useCallback((text: string) => {
    const known = caret.current?.text === value ? caret.current : null;
    const start = known ? Math.min(known.start, value.length) : value.length;
    const end = known ? Math.min(Math.max(known.end, start), value.length) : value.length;
    const next = value.slice(0, start) + text + value.slice(end);
    const position = start + text.length;
    caret.current = pending.current = {start: position, end: position, text: next};
    onChange(next);
  }, [value, onChange]);

  // The cursor can only be placed once the controlled value has reached the field.
  useLayoutEffect(() => {
    const target = pending.current;
    if (!target) return;
    pending.current = null;
    place(target);
  }, [value, place]);

  /** Return focus to the field, for a menu that closes after inserting. Leaves a field the author is already in alone. */
  const focus = useCallback(() => {
    const target = caret.current;
    if (!element.current || document.activeElement === element.current) return;
    if (target && element.current.value === target.text) place(target);
    else element.current.focus();
  }, [place]);

  return {ref, insert, focus, bind: {onSelect: remember, onKeyUp: remember, onClick: remember, onBlur: remember}};
}
