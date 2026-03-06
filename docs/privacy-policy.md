# Privacy Policy for X Clipper

Last updated: 2026-03-07

X Clipper is a Chrome extension that lets the user save X (formerly Twitter) post details into the user's Notion workspace.

## Data Collected

X Clipper processes the following data only when the user uses the extension on an X post detail page:

- Post content shown on the page, such as display name, username, post text, post URL, posted time, avatar image, and attached images
- User-provided Notion settings, including Notion API key, selected Notion database ID, and property mappings

## How Data Is Used

The extension uses this data only to:

- extract the current X post information from the page
- create a page in the user's selected Notion database
- upload related images to Notion when needed
- store extension settings locally in the browser so the user does not need to re-enter them

## Data Storage

- Notion API key, database ID, and property mappings are stored in `chrome.storage.local` on the user's browser
- Downloaded media may be cached temporarily inside the extension only for the time needed to complete the save flow
- X Clipper does not operate its own server for storing user data

## Data Sharing

X Clipper does not sell user data.

Data is sent only to services required for the requested function:

- Notion API, to create pages and upload files into the user's Notion workspace
- X/Twitter and related media domains, only to read the page the user is viewing and fetch media needed for saving

## User Control

Users control when data is processed by choosing to save a post.

Users can:

- remove the extension at any time
- clear extension settings through Chrome extension storage controls
- revoke the Notion integration token from their Notion account

## Contact

For privacy-related questions, contact the developer through the support channel listed on the Chrome Web Store page for X Clipper.
