import { Link } from "react-router-dom";

export default function GoogleIntegrationSummary() {
  return (
    <section aria-labelledby="google-integrations-title" className="border-t border-border/50 bg-card/30 px-6 py-12">
      <div className="mx-auto max-w-3xl">
        <h2 id="google-integrations-title" className="text-xl font-semibold">Gmail and Google Calendar</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Connect Gmail to send emails from AgentFlow and bring email conversations into your agency workspace.
          Google Calendar is optional and supports appointment synchronization. You choose whether to connect each service.
        </p>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">
          Imported email can include messages that do not match a CRM contact and can be visible to authorized agency users.
          Read our <Link to="/privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link> for Google permissions, data use and deletion requests.
        </p>
      </div>
    </section>
  );
}
