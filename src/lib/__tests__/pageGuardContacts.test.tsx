/**
 * Contacts Build 5 (CP2) — PageGuard `contactsPermission` gating.
 *
 * The /contacts/import route is wrapped with PageGuard pageName="Contacts"
 * contactsPermission="contacts.leads.import", so it cannot be reached by URL
 * when the Import permission is off — even though the page itself is allowed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

const perms = {
  hasPageAccess: vi.fn(() => true),
  hasContactsPermission: vi.fn(() => true),
  isLoading: false,
};

vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => perms }));
vi.mock("@/components/AccessDenied", () => ({
  default: () => React.createElement("div", null, "ACCESS_DENIED"),
}));

import PageGuard from "@/components/PageGuard";

describe("PageGuard — Contacts route permission gating", () => {
  beforeEach(() => {
    perms.hasPageAccess.mockReturnValue(true);
    perms.hasContactsPermission.mockReturnValue(true);
    perms.isLoading = false;
  });

  it("renders children when page access AND the contacts permission are allowed", () => {
    render(
      <PageGuard pageName="Contacts" contactsPermission="contacts.leads.import">
        <div>IMPORT_PAGE</div>
      </PageGuard>
    );
    expect(screen.getByText("IMPORT_PAGE")).toBeInTheDocument();
  });

  it("denies the route when the contacts permission is false (page access notwithstanding)", () => {
    perms.hasContactsPermission.mockReturnValue(false);
    render(
      <PageGuard pageName="Contacts" contactsPermission="contacts.leads.import">
        <div>IMPORT_PAGE</div>
      </PageGuard>
    );
    expect(screen.queryByText("IMPORT_PAGE")).not.toBeInTheDocument();
    expect(screen.getByText("ACCESS_DENIED")).toBeInTheDocument();
    expect(perms.hasContactsPermission).toHaveBeenCalledWith("contacts.leads.import");
  });

  it("ignores contactsPermission when the prop is not supplied (plain page route)", () => {
    perms.hasContactsPermission.mockReturnValue(false);
    render(
      <PageGuard pageName="Contacts">
        <div>CONTACTS_PAGE</div>
      </PageGuard>
    );
    expect(screen.getByText("CONTACTS_PAGE")).toBeInTheDocument();
  });
});
