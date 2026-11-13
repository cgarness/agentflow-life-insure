import { createContext, useContext } from "react";
import { ME_SCOPE, type CommissionAgentRoster, type CommissionAgentScope, type CommissionScopeMeta } from "@/lib/commission/centerScope";

export interface CommissionScopeContextValue {
  managed: boolean;
  scope: CommissionAgentScope | null;
  revision: string;
  financialKey: string;
  ready: boolean;
  isMe: boolean;
  readOnly: boolean;
  canViewOwn: boolean;
  roster: CommissionAgentRoster | null;
  loading: boolean;
  error: Error | null;
  invalid: boolean;
  apply: (scope: CommissionAgentScope) => void;
  retry: () => void;
  deny: (error: Error) => void;
  acceptRevision: (meta: CommissionScopeMeta) => boolean;
  withScopeHref: (destination: string) => string;
}
// Standalone presentation components retain personal behavior. The application page always installs the provider.
const personal: CommissionScopeContextValue = {
  managed: false, scope: ME_SCOPE, revision: "legacy", financialKey: "me:legacy", ready: true, isMe: true, readOnly: false,
  canViewOwn: true, roster: null, loading: false, error: null, invalid: false, apply: () => undefined, retry: () => undefined,
  deny: () => undefined, acceptRevision: () => true, withScopeHref: (destination) => destination,
};
export const CommissionScopeContext = createContext<CommissionScopeContextValue>(personal);
export const useCommissionScope = () => useContext(CommissionScopeContext);
