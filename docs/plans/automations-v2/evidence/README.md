# Automations V2 screenshots

Synthetic data on a local stack, taken by `bash e2e/automations-local/run.sh` at twice the pixel density, fully drawn, with the pointer resting off every control. All of them come from the builder and backend-first modes at `d40f552`. Screens taller than the window are captured as whole pages, so in those the fixed sidebar stops at the window's height. The run summaries are [`mobile-keyboard.json`](mobile-keyboard.json), [`automations-v2-editor.json`](automations-v2-editor.json) and [`automations-v2-crm.json`](automations-v2-crm.json).

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

### Phone timeline and settings sheet

| Timeline, 375 px light | Timeline, 375 px dark |
| --- | --- |
| ![Timeline on a phone, light](automations-v2-timeline-375-light.png) | ![Timeline on a phone, dark](automations-v2-timeline-375-dark.png) |

| Settings sheet, 375 px light | Settings sheet, 375 px dark |
| --- | --- |
| ![Step settings sheet on a phone, light](automations-v2-step-sheet-375-light.png) | ![Step settings sheet on a phone, dark](automations-v2-step-sheet-375-dark.png) |

## CRM screens

### A contact with a timed automation task

| 1440 px light | 1440 px dark |
| --- | --- |
| ![Contact tasks with a timed automation task, light](automations-v2-contact-tasks-1440-light.png) | ![Contact tasks with a timed automation task, dark](automations-v2-contact-tasks-1440-dark.png) |

| 375 px light | 375 px dark |
| --- | --- |
| ![Contact tasks on a phone, light](automations-v2-contact-tasks-375-light.png) | ![Contact tasks on a phone, dark](automations-v2-contact-tasks-375-dark.png) |

### Confirm issuance

| 1440 px light | 1440 px dark |
| --- | --- |
| ![Confirm policy issuance dialog, light](automations-v2-confirm-issuance-1440-light.png) | ![Confirm policy issuance dialog, dark](automations-v2-confirm-issuance-1440-dark.png) |

| 375 px light | 375 px dark |
| --- | --- |
| ![Confirm policy issuance dialog on a phone, light](automations-v2-confirm-issuance-375-light.png) | ![Confirm policy issuance dialog on a phone, dark](automations-v2-confirm-issuance-375-dark.png) |

### Inbounds callbacks

The Inbounds room keeps its own dark look in either theme, so its light and dark captures are identical; the light ones are shown.

| 1440 px | 375 px |
| --- | --- |
| ![Inbounds callbacks list](automations-v2-inbounds-callbacks-1440-light.png) | ![Inbounds callbacks list on a phone](automations-v2-inbounds-callbacks-375-light.png) |

## Rollback rehearsal

| First-release automations opened in the V2 editor | First-release frontend after the rollback |
| --- | --- |
| ![First-release automations in the V2 editor](backend-first-v2-editor.png) | ![First-release frontend after the database rollback](backend-first-rolled-back.png) |
