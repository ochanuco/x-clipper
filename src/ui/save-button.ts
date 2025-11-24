import { collectFromArticle } from '../domain/x/parser.js';

export function createSaveButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-clipper-save-button';
    btn.setAttribute('aria-label', '保存');
    // Icon-style circular button (compact)
    btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" stroke="#111827" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="#fff" />
    </svg>
  `;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '30px';
    btn.style.height = '30px';
    btn.style.padding = '0';
    // place flush to the left of the overflow icon: add right margin instead
    btn.style.marginLeft = '0';
    btn.style.marginRight = '6px';
    btn.style.borderRadius = '999px';
    btn.style.border = '1px solid rgba(0,0,0,0.08)';
    btn.style.background = 'white';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = '0 1px 0 rgba(0,0,0,0.03)';
    return btn;
}

// Small inline SVGs for success / failure states
const SUCCESS_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#10b981" />
    <path d="M7 12.5l2.5 2.5L17 8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const FAILURE_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="12" cy="12" r="10" fill="#ef4444" />
    <path d="M15 9L9 15M9 9l6 6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

const LOADING_SVG = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="x-clipper-spin">
    <path d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z" stroke-opacity="0.2" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 2C6.47715 2 2 6.47715 2 12" stroke="#111827" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;

export function insertSaveButton(article: Element) {
    console.debug('x-clipper: insertSaveButton called for article', article);
    // avoid duplicating
    if (article.querySelector('.x-clipper-save-button')) return;

    const actionArea =
        article.querySelector('[role="group"]') ??
        article.querySelector('[data-testid="tweetAction"]') ??
        article.querySelector('div[aria-label]');

    // Inject styles for rotation if not already present
    if (!document.getElementById('x-clipper-styles')) {
        const style = document.createElement('style');
        style.id = 'x-clipper-styles';
        style.textContent = `
      @keyframes x-clipper-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
      .x-clipper-spin {
        animation: x-clipper-spin 1s linear infinite;
      }
    `;
        document.head.appendChild(style);
    }

    const btn = createSaveButton();
    console.debug('x-clipper: created button element');

    const originalInnerHTML = btn.innerHTML;
    btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        btn.disabled = true;
        const originalOpacity = btn.style.opacity;
        btn.style.opacity = '0.8'; // Slightly dim but keep visible
        btn.innerHTML = LOADING_SVG;

        try {
            const payload = collectFromArticle(article);
            if (!payload) {
                // show failure icon
                btn.innerHTML = FAILURE_SVG;
                btn.disabled = false; // Allow retry
                btn.style.opacity = originalOpacity;
                return;
            }

            chrome.runtime.sendMessage({ type: 'CLIP_X_POST', data: payload }, (resp) => {
                if (chrome.runtime.lastError) console.warn('sendMessage error', chrome.runtime.lastError.message);
                if (resp && resp.success) {
                    btn.innerHTML = SUCCESS_SVG;
                    btn.disabled = true; // Prevent duplicate saves
                    btn.style.opacity = '1'; // Full opacity for success
                } else {
                    btn.innerHTML = FAILURE_SVG;
                    console.warn('clip failed', resp);
                    btn.disabled = false; // Allow retry
                    btn.style.opacity = originalOpacity;
                }
            });
        } catch (err) {
            console.warn('clip button error', err);
            btn.innerHTML = FAILURE_SVG;
            btn.disabled = false; // Allow retry
            btn.style.opacity = originalOpacity;
        }
    });

    console.debug('x-clipper: attempting placement');
    // Strategy: find the rightmost interactive element (likely the ellipsis), then
    // insert before its previous interactive sibling if present.
    let placed = false;
    try {
        const candidates = Array.from(article.querySelectorAll('button, [role="button"], a')) as Element[];
        if (candidates.length > 0) {
            // Measure rightmost position
            let rightmost: Element | null = null;
            let maxRight = -Infinity;
            for (const el of candidates) {
                try {
                    const rect = el.getBoundingClientRect();
                    if (rect && rect.right > maxRight) {
                        maxRight = rect.right;
                        rightmost = el;
                    }
                } catch {
                    // ignore
                }
            }

            if (rightmost && rightmost.parentElement) {
                // find previous interactive sibling (skip text nodes)
                let sibling: Element | null = rightmost.previousElementSibling;
                while (sibling && !/^(BUTTON|A)$/.test(sibling.tagName) && sibling.getAttribute('role') !== 'button') {
                    sibling = sibling.previousElementSibling as Element | null;
                }

                const insertBeforeEl = sibling ?? rightmost;
                if (insertBeforeEl.parentElement) {
                    insertBeforeEl.parentElement.insertBefore(btn, insertBeforeEl);
                    placed = true;
                }
            }
        }
    } catch (err) {
        console.warn('placement by bounding box failed', err);
    }

    if (!placed) {
        console.debug('x-clipper: fallback placement used');
        if (actionArea) {
            actionArea.appendChild(btn);
        } else {
            const header = article.querySelector('[data-testid="User-Names"], [data-testid="User-Name"]');
            if (header) header.appendChild(btn);
            else article.appendChild(btn);
        }
    } else {
        console.debug('x-clipper: placed button successfully');
    }
}

export function scanAndInsertButtons(root: ParentNode = document) {
    const selector = 'article[data-testid="tweet"] , article[data-testid="tweetDetail"]';
    const articles = Array.from(root.querySelectorAll(selector));
    console.debug('x-clipper: scanAndInsertButtons found', articles.length, 'articles');
    articles.forEach((article) => insertSaveButton(article));
}
