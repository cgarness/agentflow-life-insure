import {
  fieldIssue,
  fieldProblems,
  fieldsForTrigger,
  fieldValues,
  renderFields,
  savedMessageText,
  usesAppointmentField,
  WORKFLOW_FIELDS,
} from "./fields.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw Error(message);
}

Deno.test("the catalog offers contact fields everywhere and appointment fields only after an appointment trigger", () => {
  assert(
    fieldsForTrigger("lead_created").map((f) => f.label).join("|") === "First name|Last name|Email address|Phone number",
    "friendly contact names",
  );
  assert(fieldsForTrigger(null).length === 4, "no trigger yet");
  assert(
    fieldsForTrigger("appointment_booked").map((f) => f.token).slice(-2).join(",") === "appointment_date,appointment_time",
    "appointment trigger adds date and time",
  );
  assert(new Set(WORKFLOW_FIELDS.map((f) => f.token)).size === WORKFLOW_FIELDS.length, "unique tokens");
});

Deno.test("saved-message tokens are mapped only where an exact automation field exists", () => {
  assert(
    savedMessageText("Hi {{contact_first_name}} {{ contact_last_name }}, call {{contact_phone}} or {{contact_email}}") ===
      "Hi {{first_name}} {{last_name}}, call {{phone}} or {{email}}",
    "one-to-one mappings",
  );
  assert(savedMessageText("Dear {{contact_full_name}}") === "Dear {{first_name}} {{last_name}}", "full name expands");
  assert(savedMessageText("From {{agent_first_name}}") === "From {{agent_first_name}}", "no equivalent is left untouched");
  assert(savedMessageText(savedMessageText("{{contact_first_name}}")) === "{{first_name}}", "mapping is stable");
  const problems = fieldProblems(savedMessageText("{{contact_first_name}} from {{agent_first_name}} at {{agency_name}}"), "lead_created");
  assert(problems.map((p) => p.label).join(",") === "Agent first name,Agency name", "unsupported fields by friendly name");
});

Deno.test("unsupported, unavailable and incomplete fields produce actionable messages", () => {
  assert(fieldIssue("Hi {{first_name}}", "Message", "lead_created") === undefined, "supported");
  assert(fieldIssue("Hi {{ first_name }}", "Message", "lead_created") === undefined, "whitespace tolerated");
  const unsupported = fieldIssue("Hi {{agent_first_name}}", "Message", "lead_created") ?? "";
  assert(unsupported.includes("Agent first name") && unsupported.includes("Insert field"), unsupported);
  const unavailable = fieldIssue("At {{appointment_time}}", "Subject", "lead_created") ?? "";
  assert(unavailable.startsWith("Subject uses Appointment time") && unavailable.includes("does not provide"), unavailable);
  assert(fieldIssue("At {{appointment_time}}", "Subject", "appointment_booked") === undefined, "available after booking");
  assert((fieldIssue("Hi {{first_name", "Message", "lead_created") ?? "").includes("incomplete field"), "open brace");
  assert((fieldIssue("Hi first_name}}", "Message", "lead_created") ?? "").includes("incomplete field"), "close brace");
  assert(fieldIssue(undefined, "Notes", "lead_created") === undefined, "optional text");
});

Deno.test("rendering fills known values, blanks empty ones and reports values it could not establish", () => {
  const values = fieldValues({ contact: { first_name: "Sam", last_name: null, email: "s@example.invalid", phone: "+12025550123" } });
  assert(renderFields("Hi {{first_name}} {{last_name}}!", values).text === "Hi Sam !", "empty contact value renders blank");
  assert(renderFields("{{unknown_thing}}", values).text === "" && renderFields("{{unknown_thing}}", values).missing.length === 0, "unknown token");
  const missing = renderFields("On {{appointment_date}} at {{appointment_time}}", values);
  assert(missing.missing.join(",") === "Appointment date,Appointment time", "appointment values need a start and zone");
  const zoned = fieldValues({ contact: {}, appointment_start: "2026-03-08T07:30:00Z", timezone: "America/Chicago" });
  assert(zoned.appointment_date === "Sunday, March 8" && zoned.appointment_time === "1:30 AM CST", JSON.stringify(zoned));
  const afterShift = fieldValues({ contact: {}, appointment_start: "2026-03-08T08:30:00Z", timezone: "America/Chicago" });
  assert(afterShift.appointment_time === "3:30 AM CDT", "daylight time after the spring shift: " + afterShift.appointment_time);
  assert(!("appointment_date" in fieldValues({ contact: {}, appointment_start: "2026-03-08T08:30:00Z", timezone: "Not/AZone" })), "invalid zone");
  assert(fieldValues({ contact: null, caller_phone: "+12025550188" }).phone === "+12025550188", "unmatched caller number");
  assert(usesAppointmentField("x {{ appointment_time }}") && !usesAppointmentField("x {{first_name}}"), "appointment detection");
});
