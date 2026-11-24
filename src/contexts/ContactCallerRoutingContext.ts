import { createContext } from "react";

export interface ContactCallerRouting {
  resolveContactLocalCaller(phone: string, eligibleNumbers: readonly string[]): Promise<string>;
  getContactCallerRole(numberId: string, number: string): "agency" | "personal" | null;
}

export const ContactCallerRoutingContext = createContext<ContactCallerRouting | null>(null);
