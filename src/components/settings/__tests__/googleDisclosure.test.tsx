import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import GoogleDataDisclosure from "../GoogleDataDisclosure";
import { emailSupabaseApi } from "@/lib/supabase-email";
import { toast } from "@/hooks/use-toast";
vi.mock("@/lib/supabase-email", () => ({ emailSupabaseApi: { removeGoogleAccess: vi.fn() } }));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe("Google disclosure and removal controls", () => {
  it("shows mailbox scope and policy links before consent", () => {
    render(<MemoryRouter><GoogleDataDisclosure kind="email" /></MemoryRouter>);
    expect(screen.getByText(/not matched to a contact/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/privacy");
    expect(screen.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/terms");
  });
  it("requires an explicit confirmation explaining both integrations", async () => {
    const onRemoved = vi.fn();
    vi.mocked(emailSupabaseApi.removeGoogleAccess).mockResolvedValue({ google_access_revoked: false, warning: "Remove access in your Google Account." });
    render(<MemoryRouter><GoogleDataDisclosure kind="calendar" onRemoved={onRemoved} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Remove Google access" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("both Gmail and Google Calendar");
    expect(emailSupabaseApi.removeGoogleAccess).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove Google access" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledOnce());
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Google connections stopped", description: "Remove access in your Google Account." }));
  });
  it("cancel leaves existing connections untouched", () => {
    render(<MemoryRouter><GoogleDataDisclosure kind="email" /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Remove Google access" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(emailSupabaseApi.removeGoogleAccess).not.toHaveBeenCalled();
  });
});
