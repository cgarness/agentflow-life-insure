# Automations V2 screenshots

Synthetic data on a local stack, taken by `bash e2e/automations-local/run.sh` at twice the pixel density, fully drawn, with the pointer resting off every control. All of them come from the builder and backend-first modes at `b9bcde6`, except the "before" capture of the phone save, which was taken the same way at `ef73668`, the code before that fix. Screens taller than the window are captured as whole pages, so in those the fixed sidebar stops at the window's height. The run summaries are [`mobile-keyboard.json`](mobile-keyboard.json), [`automations-v2-editor.json`](automations-v2-editor.json), [`automations-v2-crm.json`](automations-v2-crm.json) and [`automations-v2-install-stops.json`](automations-v2-install-stops.json).

## Builder

### A draft authored by keyboard

| 1440 px light | 1440 px dark |
| --- | --- |
| ![Draft authored by keyboard, list view, light](automations-1440-light.png) | ![Draft authored by keyboard, list view, dark](automations-1440-dark.png) |

| 375 px light | 375 px dark |
| --- | --- |
| ![Draft authored by keyboard on a phone, light](automations-375-light.png) | ![Draft authored by keyboard on a phone, dark](automations-375-dark.png) |

### Canvas and list

| Canvas, 1440 px light | Canvas, 1440 px dark |
| --- | --- |
| ![Canvas with the selected step's settings, light](automations-v2-canvas-1440-light.png) | ![Canvas with the selected step's settings, dark](automations-v2-canvas-1440-dark.png) |

| List view, 1440 px light |
| --- |
| ![List view with the selected step's settings](automations-v2-list-1440-light.png) |

### Message editor and publish review

| Message editor, 1440 px light | Save & review, 1440 px light |
| --- | --- |
| ![Message editor with Use saved message and Insert field](automations-v2-message-editor-1440-light.png) | ![Publish review with each text's consent requirement](automations-v2-review-1440-light.png) |

### One save message on a phone

Before the fix a save was reported twice, in the toolbar and in a notice above the steps. Now the toolbar's saved-state line says it once, and the first step starts 62 px higher (496 px below that line before, 434 px after).

| Before, `ef73668`, 375 px light | After, `b9bcde6`, 375 px light |
| --- | --- |
| ![Phone builder after Save draft, before: two save messages](automations-v2-timeline-saved-before-375-light.png) | ![Phone builder after Save draft, after: one save message](automations-v2-timeline-saved-after-375-light.png) |

### Phone timeline and settings sheet

| Timeline, 375 px light | Timeline, 375 px dark |
| --- | --- |
| ![Timeline on a phone, light](automations-v2-timeline-375-light.png) | ![Timeline on a phone, dark](automations-v2-timeline-375-dark.png) |

| Settings sheet, 375 px light | Settings sheet, 375 px dark |
| --- | --- |
| ![Step settings sheet on a phone, light](automations-v2-step-sheet-375-light.png) | ![Step settings sheet on a phone, dark](automations-v2-step-sheet-375-dark.png) |

## CRM screens

### A contact with a timed automation task

On a phone the contact screen opens on its right-hand view, so the Tasks tab is on screen without panning.

| 1440 px light | 1440 px dark |
| --- | --- |
| ![Contact tasks with a timed automation task, light](automations-v2-contact-tasks-1440-light.png) | ![Contact tasks with a timed automation task, dark](automations-v2-contact-tasks-1440-dark.png) |

| 375 px light | 375 px dark |
| --- | --- |
| ![Contact tasks on a phone, light](automations-v2-contact-tasks-375-light.png) | ![Contact tasks on a phone, dark](automations-v2-contact-tasks-375-dark.png) |

### Confirm issuance on a 375 px touch phone (pilot agency)

The client page opens with Call and Schedule on screen. A finger drag brings the policies into view; the agent taps the policy row, then Confirm issuance. Dark was cancelled, light was confirmed and saved once.

| First view, dark | After the finger pan, dark | Confirm issuance, dark |
| --- | --- | --- |
| ![Client page on a phone, first view, dark](automations-v2-client-first-view-375-dark.png) | ![Policies after panning, dark](automations-v2-client-policies-375-dark.png) | ![Confirm issuance dialog on a phone, dark](automations-v2-confirm-issuance-375-dark.png) |

| First view, light | After the finger pan, light | Confirm issuance, light |
| --- | --- | --- |
| ![Client page on a phone, first view, light](automations-v2-client-first-view-375-light.png) | ![Policies after panning, light](automations-v2-client-policies-375-light.png) | ![Confirm issuance dialog on a phone, light](automations-v2-confirm-issuance-375-light.png) |

### Confirm issuance at 1440 px

| 1440 px light | 1440 px dark |
| --- | --- |
| ![Confirm policy issuance dialog, light](automations-v2-confirm-issuance-1440-light.png) | ![Confirm policy issuance dialog, dark](automations-v2-confirm-issuance-1440-dark.png) |

### An agency outside the pilot

The same client page for an agency outside the pilot keeps the production phone layout and offers no issuance.

| 375 px light |
| --- |
| ![Client page outside the pilot on a phone](automations-v2-outside-pilot-client-375-light.png) |

### Inbounds callbacks

The Inbounds room keeps its own dark look in either theme, so its light and dark captures are identical; the light ones are shown.

| 1440 px | 375 px |
| --- | --- |
| ![Inbounds callbacks list](automations-v2-inbounds-callbacks-1440-light.png) | ![Inbounds callbacks list on a phone](automations-v2-inbounds-callbacks-375-light.png) |

## Rollback rehearsal

| First-release automations opened in the V2 editor | First-release frontend after the rollback |
| --- | --- |
| ![First-release automations in the V2 editor](backend-first-v2-editor.png) | ![First-release frontend after the database rollback](backend-first-rolled-back.png) |
