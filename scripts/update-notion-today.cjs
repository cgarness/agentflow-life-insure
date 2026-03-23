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
    const progressText = `[${date}] SESSION LOG: Resolved "Failed to save" error in User Management by fixing RLS policies and addressing "infinite recursion" in Supabase. Implemented full RBAC filtering for Admin (full access), Team Leader (team view), and Agent (self view) roles. Replaced mock agent data in the Contacts page with real Supabase user profile data and added security definer functions for safe permission checks.`;
    await appendParagraph(process.env.NOTION_PAGE_PROGRESS_TRACKER, progressText);

    // Decisions Log
    const decisionText = `[${date}] DECISION: We implemented SECURITY DEFINER functions (is_admin, is_team_leader) in Supabase to bypass RLS recursion when policies query the same table they protect. This ensures robust and safe RBAC checks without hitting database performance or stability issues.`;
    await appendParagraph(process.env.NOTION_PAGE_DECISIONS_LOG, decisionText);

    console.log("Notion updates completed.");
}

main();
