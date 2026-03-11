const { Client } = require("@notionhq/client");
require("dotenv").config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function appendParagraph(pageId, text) {
    try {
        await notion.blocks.children.append({
            block_id: pageId,
            children: [{ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: text } }] } }],
        });
        console.log(`Successfully appended to page ${pageId}`);
    } catch (error) {
        console.error(`Error appending to Notion page ${pageId}:`, error.message);
    }
}

async function main() {
    let date;
    try {
        // Get current date string using standard JS Date object
        date = new Date().toISOString().split('T')[0];
    } catch (e) {
        date = "2026-03-07";
    }

    // Progress Tracker
    const progressText = `[${date}] SESSION LOG: Restructured Dialer active session layout: unified the SMS/Email composer pinned to the bottom of the conversation history, switched campaign selection UI to a responsive 4-column grid, implemented End Session functionality, and synced the robust "ContactModal" from the actual Contacts page to be used as the Dialer's "Full View", ensuring bi-directional database consistency.`;
    await appendParagraph(process.env.NOTION_PAGE_PROGRESS_TRACKER, progressText);

    // Decisions Log
    const decisionText = `[${date}] DECISION: We replaced the custom inline dialog in DialerPage with the shared <ContactModal> component used in the Contacts tab. This enriches the Dialer UI with activity timelines and history filtering without compromising the layout hierarchy.`;
    await appendParagraph(process.env.NOTION_PAGE_DECISIONS_LOG, decisionText);

    console.log("Notion updates completed.");
}

main();
