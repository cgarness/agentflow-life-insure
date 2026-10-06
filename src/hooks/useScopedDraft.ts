import { useCallback, useRef, useState } from "react";
/** A draft can never render or send under another contact/actor scope. */
export function useScopedDraft(scope:string) {
  const currentScope = useRef(scope); currentScope.current = scope;
  const [draft,setDraft]=useState<{scope:string;text:string}|null>(null);
  const setText=useCallback((text:string)=>setDraft(prev=>currentScope.current===scope?{scope,text}:prev),[scope]);
  return [draft?.scope===scope?draft.text:"",setText] as const;
}
