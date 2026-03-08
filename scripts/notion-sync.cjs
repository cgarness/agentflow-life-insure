const { Client } = require("@notionhq/client");
require("dotenv").config();

const notion = new Client({ auth: process.env.NOTION_TOKEN });

/**
 * Appends a block (text) to a Notion page.
 */
async function appendToPage(pageId, text) {
    try {
        await notion.blocks.children.append({
            block_id: pageId,
            children: [
                {
                    object: "block",
                    type: "paragraph",
                    paragraph: {
                        rich_text: [{ type: "text", text: { content: text } }],
                    },
                },
            ],
        });
        console.log(`Successfully appended to page ${pageId}`);
    } catch (error) {
        console.error(`Error appending to Notion page ${pageId}:`, error.message);
    }
}

/**
 * Example function to log a build session to the Progress Tracker.
 * Note: If the tracker is a Database and not a Page, this would need to use `notion.pages.create`.
 */
async function logSessionToTracker(details) {
    const pageId = process.env.NOTION_PAGE_PROGRESS_TRACKER;
    const timestamp = new Date().toLocaleString();
    const entry = `[${timestamp}] SESSION LOG: ${details}`;
    await appendToPage(pageId, entry);
}

// Exported for use in build session end
module.exports = { appendToPage, logSessionToTracker };

// Direct execution for testing if run via 'node scripts/notion-sync.js "test message"'
if (require.main === module) {
    const msg = process.argv[2] || "Manual Notion Sync Test triggered.";
    logSessionToTracker(msg);
}
