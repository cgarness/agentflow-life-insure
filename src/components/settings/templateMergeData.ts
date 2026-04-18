export type MergeFieldRow = { token: string; label: string };
export type MergeFieldGroup = { title: string; rows: MergeFieldRow[] };

export const MERGE_FIELD_GROUPS: MergeFieldGroup[] = [
  {
    title: "Contact",
    rows: [
      { token: "{{contact_first_name}}", label: "First Name" },
      { token: "{{contact_last_name}}", label: "Last Name" },
      { token: "{{contact_full_name}}", label: "Full Name" },
      { token: "{{contact_phone}}", label: "Phone Number" },
      { token: "{{contact_email}}", label: "Email Address" },
      { token: "{{contact_state}}", label: "State" },
      { token: "{{contact_city}}", label: "City" },
    ],
  },
  {
    title: "Policy",
    rows: [
      { token: "{{policy_type}}", label: "Policy Type" },
      { token: "{{policy_amount}}", label: "Coverage Amount" },
      { token: "{{policy_anniversary_date}}", label: "Anniversary Date" },
    ],
  },
  {
    title: "Agent",
    rows: [
      { token: "{{agent_first_name}}", label: "Agent First Name" },
      { token: "{{agent_last_name}}", label: "Agent Last Name" },
      { token: "{{agent_phone}}", label: "Agent Phone" },
      { token: "{{agent_email}}", label: "Agent Email" },
      { token: "{{agency_name}}", label: "Agency Name" },
    ],
  },
  {
    title: "Appointment",
    rows: [
      { token: "{{appointment_date}}", label: "Appointment Date" },
      { token: "{{appointment_time}}", label: "Appointment Time" },
      { token: "{{appointment_link}}", label: "Booking Link" },
    ],
  },
];

/** Sample replacements for live preview (life insurance context). */
export const MERGE_SAMPLE_MAP: Record<string, string> = {
  "{{contact_first_name}}": "Jane",
  "{{contact_last_name}}": "Smith",
  "{{contact_full_name}}": "Jane Smith",
  "{{contact_phone}}": "(555) 867-5309",
  "{{contact_email}}": "jane.smith@email.com",
  "{{contact_state}}": "Texas",
  "{{contact_city}}": "Austin",
  "{{policy_type}}": "Term Life",
  "{{policy_amount}}": "$500,000",
  "{{policy_anniversary_date}}": "March 15, 2025",
  "{{agent_first_name}}": "Marcus",
  "{{agent_last_name}}": "Rivera",
  "{{agent_phone}}": "(555) 234-5678",
  "{{agent_email}}": "marcus@agencyflow.com",
  "{{agency_name}}": "Summit Life Agency",
  "{{appointment_date}}": "Friday, April 25",
  "{{appointment_time}}": "2:00 PM",
  "{{appointment_link}}": "https://calendly.com/marcus",
};

export function applyMergeSamples(text: string): string {
  let out = text;
  for (const [token, sample] of Object.entries(MERGE_SAMPLE_MAP)) {
    out = out.split(token).join(sample);
  }
  return out;
}
