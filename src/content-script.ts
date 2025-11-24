import { extractPost } from './domain/x/parser.js';
import { insertSaveButton, scanAndInsertButtons } from './ui/save-button.js';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'EXTRACT_X_POST') {
    return undefined;
  }

  try {
    const data = extractPost();
    if (!data) {
      sendResponse({
        success: false,
        error: '投稿を検出できませんでした。詳細ページを開いているか確認してください。'
      });
      return true;
    }
    sendResponse({ success: true, data });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '不明なエラーが発生しました。';
    sendResponse({ success: false, error: message });
  }

  return true;
});

// Initial pass
scanAndInsertButtons();

// Observe for new tweets loaded dynamically
const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (!m.addedNodes) continue;
    m.addedNodes.forEach((node) => {
      console.debug('x-clipper: mutation added node', node);
      if (!(node instanceof Element)) return;
      if (node.matches && (node.matches('article[data-testid="tweet"]') || node.matches('article[data-testid="tweetDetail"]'))) {
        console.debug('x-clipper: mutation node is article, inserting');
        insertSaveButton(node as Element);
      } else {
        // in case articles are nested inside added nodes
        scanAndInsertButtons(node);
      }
    });
  }
});

observer.observe(document.body, { childList: true, subtree: true });
