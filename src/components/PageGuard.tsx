/**
 * PageGuard — wraps a route's content and checks Page Access permissions.
 *
 * Usage: <PageGuard pageName="Dialer"><DialerPage /></PageGuard>
 *
 * While permissions are loading, shows a centered spinner (matches ProtectedRoute).
 * If hasPageAccess(pageName) is false, renders AccessDenied inside the layout
 * so the sidebar stays visible and the user can navigate away.
 * Super Admin and Admin bypass automatically (handled inside usePermissions).
 *
 * Optional `contactsPermission` (Contacts Build 5) additionally requires a Contacts
 * module permission key (e.g. "contacts.leads.import"), so a route can't be reached
 * by URL even when the page button is hidden.
 */

import React from "react";
import { usePermissions } from "@/hooks/usePermissions";
import AccessDenied from "@/components/AccessDenied";

interface PageGuardProps {
  pageName: string;
  /** Optional Contacts module permission key also required to view this route. */
  contactsPermission?: string;
  children: React.ReactNode;
}

const PageGuard: React.FC<PageGuardProps> = ({ pageName, contactsPermission, children }) => {
  const { hasPageAccess, hasContactsPermission, isLoading } = usePermissions();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hasPageAccess(pageName)) {
    return <AccessDenied />;
  }

  if (contactsPermission && !hasContactsPermission(contactsPermission)) {
    return <AccessDenied />;
  }

  return <>{children}</>;
};

export default PageGuard;
