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
    const progressText = `[${date}] SESSION LOG: Completed the implementation and Supabase wiring for 5 remaining Settings sections: Email/SMS Templates, Carriers, Goal Setting, Custom Menu Links, and Activity Log. Pushed changes to GitHub origin main. Also successfully connected AgentFlow AI Assistant to Notion API for automated logging.`;
    await appendParagraph(process.env.NOTION_PAGE_PROGRESS_TRACKER, progressText);

    // Decisions Log
    const decisionText = `[${date}] DECISION: Implemented 5 settings sections manually in code (bypassing Lovable due to credits): EmailSMSTemplates, Carriers, GoalSetting, CustomMenuLinks, ActivityLog. Integrated Notion API via internal integration for AI automated logging. Schema '20260308200000_create_remaining_settings.sql' pushed to Supabase.`;
    await appendParagraph(process.env.NOTION_PAGE_DECISIONS_LOG, decisionText);

    console.log("Notion updates completed.");
}

main();
