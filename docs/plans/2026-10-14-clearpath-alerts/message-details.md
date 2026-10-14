# Owner-requested alert format

Chris requested NEW VET LEAD followed by one labeled line per relevant submitted field, with no opt-out wording in his personal internal notification. This authorizes the message change and publication.

Change only the ClearPath notification bridge and Sites server payload. Read contact and coverage fields from the saved, phone-verified lead; send an authenticated, bounded allowlist to the existing fixed owner recipient. Render name, phone, optional email, affiliation, age range, ZIP, requested coverage, coverage goal, best contact time and timezone, available callback preference, phone verification, ad source and submission time. No arbitrary message/recipient input, tracking identifiers, tokens or health fields. No client-side or Meta payload changes.

The notification remains immediate and once per saved lead. A callback chosen afterward does not resend it. Preserve consent enforcement and provider STOP handling; removing footer text changes neither. Retain legacy payload support during the two-part deployment. Test signed-field validation, formatting, saved-row sourcing, duplicate/callback protection, then deploy backend first and the same existing Site. No historical sends or test prospect creation.

Files: clearpath-lead-alert handler/index/message and tests; WORK_LOG; Sites lib/lead-alert and tests. Shared SMS dispatch, credentials, A2P registration, lead forms and database schema unchanged.
