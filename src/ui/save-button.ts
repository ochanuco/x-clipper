import { collectFromArticle } from '../domain/x/parser.js';

export function createSaveButton(): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'x-clipper-save-button';
    btn.setAttribute('aria-label', '保存');
    // Icon-style circular button (compact)
    btn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 7.5h-.75A2.25 2.25 0 0 0 4.5 9.75v7.5a2.25 2.25 0 0 0 2.25 2.25h7.5a2.25 2.25 0 0 0 2.25-2.25v-7.5a2.25 2.25 0 0 0-2.25-2.25h-.75m0-3-3-3m0 0-3 3m3-3v11.25m6-2.25h.75a2.25 2.25 0 0 1 2.25 2.25v7.5a2.25 2.25 0 0 1-2.25 2.25h-7.5a2.25 2.25 0 0 1-2.25-2.25v-.75" />
    </svg>
  `;
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '32px';
    btn.style.height = '32px';
    btn.style.padding = '0';
    btn.style.lineHeight = '0';
    // Insert button before overflow menu: use right margin to maintain spacing
    btn.style.marginLeft = '0';
    btn.style.marginRight = '0';
    btn.style.borderRadius = '999px';
    btn.style.border = 'none';
    btn.style.background = 'transparent';
    btn.style.position = 'relative';
    btn.style.pointerEvents = 'auto';
    btn.style.isolation = 'isolate';
    btn.style.zIndex = '2147483647';
    btn.style.cursor = 'pointer';
    btn.style.boxShadow = 'none';
    btn.style.color = 'rgba(17, 24, 39, 0.9)';
    btn.style.transition = 'background-color 120ms ease, color 120ms ease';

    const setIdleStyle = () => {
        btn.style.background = 'transparent';
        btn.style.color = 'rgba(17, 24, 39, 0.9)';
    };
    const setHoverStyle = () => {
        if (btn.disabled) return;
        btn.style.background = 'rgba(29, 155, 240, 0.12)';
        btn.style.color = 'rgb(29, 155, 240)';
    };
    const setActiveStyle = () => {
        if (btn.disabled) return;
        btn.style.background = 'rgba(29, 155, 240, 0.2)';
        btn.style.color = 'rgb(29, 155, 240)';
    };

    btn.addEventListener('mouseenter', setHoverStyle);
    btn.addEventListener('mouseleave', setIdleStyle);
    btn.addEventListener('mousedown', setActiveStyle);
    btn.addEventListener('mouseup', setHoverStyle);
    btn.addEventListener('blur', setIdleStyle);

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

function isContextInvalidatedError(error: unknown) {
    const message = (error instanceof Error ? error.message : String(error ?? '')).toLowerCase();
    const runtimeMessage = chrome.runtime?.lastError?.message?.toLowerCase() ?? '';
    const combined = `${message}\n${runtimeMessage}`;
    return (
        combined.includes('extension context invalidated') ||
        combined.includes('receiving end does not exist') ||
        combined.includes('could not establish connection')
    );
}

function sendClipRequest(payload: ReturnType<typeof collectFromArticle>) {
    if (!payload) {
        return Promise.resolve({ success: false, error: 'missing_payload' });
    }
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) {
        return Promise.reject(new Error('Extension context invalidated.'));
    }

    return new Promise<{ success?: boolean; error?: string }>((resolve, reject) => {
        try {
            chrome.runtime.sendMessage({ type: 'CLIP_X_POST', data: payload }, (resp) => {
                const lastErrorMessage = chrome.runtime.lastError?.message;
                if (lastErrorMessage) {
                    reject(new Error(lastErrorMessage));
                    return;
                }
                resolve((resp ?? {}) as { success?: boolean; error?: string });
            });
        } catch (error) {
            reject(error);
        }
    });
}

function findDirectChild(parent: Element, descendant: Element): Element | null {
    let current: Element | null = descendant;
    while (current && current.parentElement !== parent) {
        current = current.parentElement;
    }
    return current && current.parentElement === parent ? current : null;
}

function queryLikeControl(root: ParentNode): Element | null {
    return root.querySelector('[data-testid="like"], [data-testid="unlike"]');
}

function findInsertionPointForLike(root: Element): { parent: Element; before: Element } | null {
    const likeButton = queryLikeControl(root);
    if (!likeButton) return null;

    let slot: Element | null = likeButton;
    while (slot && slot.parentElement && slot.parentElement !== root) {
        const parent: Element = slot.parentElement;
        const siblings = Array.from(parent.children) as Element[];
        const hasSiblingAction = siblings.some(
            (child) =>
                child !== slot &&
                !!child.querySelector(
                    '[data-testid="reply"], [data-testid="retweet"], [data-testid="like"], [data-testid="unlike"], [data-testid="bookmark"], [data-testid="analytics"]'
                )
        );
        if (hasSiblingAction) {
            return { parent, before: slot };
        }
        slot = parent;
    }

    const likeSlot = findDirectChild(root, likeButton);
    if (!likeSlot) return null;
    return { parent: root, before: likeSlot };
}

function placeButtonLeftOfLike(actionArea: Element, wrapper: Element): boolean {
    const insertion = findInsertionPointForLike(actionArea);
    if (!insertion) return false;
    insertion.parent.insertBefore(wrapper, insertion.before);
    return true;
}

function scoreActionArea(group: Element): number {
    let score = 0;
    if (group.querySelector('[data-testid="reply"]')) score += 2;
    if (group.querySelector('[data-testid="retweet"]')) score += 2;
    if (queryLikeControl(group)) score += 3;
    if (group.querySelector('[data-testid="bookmark"]')) score += 1;
    return score;
}

function findTweetActionArea(article: Element): Element | null {
    const explicitActionAreas = Array.from(article.querySelectorAll('[data-testid="tweetAction"]')).filter(
        (el) => el.closest('article') === article && queryLikeControl(el)
    );
    if (explicitActionAreas.length > 0) {
        const sorted = explicitActionAreas.sort((a, b) => scoreActionArea(b) - scoreActionArea(a));
        const best = sorted[0];
        if (best && scoreActionArea(best) > 0) return best;
    }

    const groups = Array.from(article.querySelectorAll('[role="group"]'));
    const sameArticleGroups = groups.filter((group) => group.closest('article') === article);
    const candidateGroups = sameArticleGroups.filter((group) => queryLikeControl(group));
    if (candidateGroups.length > 0) {
        const sorted = candidateGroups.sort((a, b) => scoreActionArea(b) - scoreActionArea(a));
        const best = sorted[0];
        if (best && scoreActionArea(best) > 0) return best;
    }

    const ariaLabeledGroup = article.querySelector('div[aria-label]');
    if (ariaLabeledGroup && queryLikeControl(ariaLabeledGroup)) return ariaLabeledGroup;
    return null;
}

export function insertSaveButton(article: Element) {
    console.debug('x-clipper: insertSaveButton called for article', article);
    // avoid duplicating
    if (article.querySelector('.x-clipper-save-button')) return;

    const actionArea = findTweetActionArea(article);

    // Keep styles up-to-date even when the extension is reloaded on an open tab.
    const style = (document.getElementById('x-clipper-styles') as HTMLStyleElement | null) ?? document.createElement('style');
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
    if (!style.parentElement) {
        document.head.appendChild(style);
    }

    const btn = createSaveButton();
    const wrapper = document.createElement('div');
    wrapper.className = 'x-clipper-save-button-wrapper';
    wrapper.style.display = 'inline-flex';
    wrapper.style.position = 'relative';
    wrapper.style.isolation = 'isolate'; // ensure a new stacking context above overlays (CI flakiness)
    wrapper.style.zIndex = '2147483647';
    wrapper.style.pointerEvents = 'auto';
    wrapper.style.marginLeft = '-4px';
    wrapper.style.marginRight = '8px';
    wrapper.appendChild(btn);
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
                console.warn('x-clipper: skipping clip because tweet content is missing');
                btn.innerHTML = FAILURE_SVG;
                btn.disabled = false;
                btn.style.opacity = originalOpacity;
                return;
            }

            const resp = await sendClipRequest(payload);
            if (resp && resp.success) {
                btn.innerHTML = SUCCESS_SVG;
                btn.disabled = true; // Prevent duplicate saves
                btn.style.opacity = '1'; // Full opacity for success
                btn.title = '';
            } else {
                btn.innerHTML = FAILURE_SVG;
                console.warn('clip failed', resp);
                btn.disabled = false; // Allow retry
                btn.style.opacity = originalOpacity;
            }
        } catch (err) {
            console.warn('clip button error', err);
            btn.innerHTML = FAILURE_SVG;
            btn.disabled = false; // Allow retry
            btn.style.opacity = originalOpacity;
            if (isContextInvalidatedError(err)) {
                btn.title = '拡張機能が更新されたため、ページを再読み込みしてください。';
            }
        }
    });

    console.debug('x-clipper: attempting placement');
    const placed = actionArea ? placeButtonLeftOfLike(actionArea, wrapper) : false;

    if (!placed) {
        console.debug('x-clipper: fallback placement used');
        if (actionArea) {
            actionArea.appendChild(wrapper);
        } else {
            const header = article.querySelector('[data-testid="User-Names"], [data-testid="User-Name"]');
            if (header) header.appendChild(wrapper);
            else article.appendChild(wrapper);
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
