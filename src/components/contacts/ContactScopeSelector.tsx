import React from "react";
import { User, Users, Building2 } from "lucide-react";
import type { ContactScope } from "@/lib/contactsFilters";

const SCOPE_META: Record<ContactScope, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  mine: { label: "My Contacts", Icon: User },
  team: { label: "Team Contacts", Icon: Users },
  agency: { label: "Agency Contacts", Icon: Building2 },
};

interface ContactScopeSelectorProps {
  scope: ContactScope;
  availableScopes: ContactScope[];
  onScopeChange: (s: ContactScope) => void;
}

/**
 * Compact segmented My / Team / Agency control. Renders nothing when only one
 * scope is available (so an own-only user sees no redundant selector).
 */
const ContactScopeSelector: React.FC<ContactScopeSelectorProps> = ({
  scope,
  availableScopes,
  onScopeChange,
}) => {
  if (availableScopes.length <= 1) return null;

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-accent/50 p-1" role="group" aria-label="Contact scope">
      {availableScopes.map((s) => {
        const { label, Icon } = SCOPE_META[s];
        const active = s === scope;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onScopeChange(s)}
            aria-pressed={active}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium sidebar-transition ${
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ContactScopeSelector;
