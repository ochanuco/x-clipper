import { beforeEach, describe, expect, it } from 'vitest';
import { insertSaveButton } from './save-button.js';

function createArticleWithActions(testIds: string[]): { article: HTMLElement; actionArea: HTMLElement } {
    const article = document.createElement('article');
    article.setAttribute('data-testid', 'tweet');

    const actionArea = document.createElement('div');
    actionArea.setAttribute('role', 'group');

    for (const testId of testIds) {
        const slot = document.createElement('div');
        const button = document.createElement('button');
        button.setAttribute('data-testid', testId);
        slot.appendChild(button);
        actionArea.appendChild(slot);
    }

    article.appendChild(actionArea);
    document.body.appendChild(article);
    return { article, actionArea };
}

describe('insertSaveButton', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('inserts save button to the left of like', () => {
        const { article, actionArea } = createArticleWithActions(['reply', 'retweet', 'like', 'analytics', 'bookmark']);

        insertSaveButton(article);

        const wrapper = actionArea.querySelector('.x-clipper-save-button-wrapper');
        const likeSlot = actionArea.querySelector('[data-testid="like"]')?.parentElement;

        expect(wrapper).toBeTruthy();
        expect(wrapper?.nextElementSibling).toBe(likeSlot);
    });

    it('inserts save button to the left of like when analytics is absent', () => {
        const { article, actionArea } = createArticleWithActions(['reply', 'retweet', 'like', 'bookmark']);

        insertSaveButton(article);

        const wrapper = actionArea.querySelector('.x-clipper-save-button-wrapper');
        const likeSlot = actionArea.querySelector('[data-testid="like"]')?.parentElement;

        expect(wrapper).toBeTruthy();
        expect(wrapper?.nextElementSibling).toBe(likeSlot);
    });

    it('does not duplicate save button in the same article', () => {
        const { article, actionArea } = createArticleWithActions(['reply', 'retweet', 'like', 'analytics']);

        insertSaveButton(article);
        insertSaveButton(article);

        expect(actionArea.querySelectorAll('.x-clipper-save-button-wrapper')).toHaveLength(1);
    });

    it('ignores unrelated group and inserts into group containing like', () => {
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');

        const unrelatedGroup = document.createElement('div');
        unrelatedGroup.setAttribute('role', 'group');
        unrelatedGroup.appendChild(document.createElement('button'));

        const actionArea = document.createElement('div');
        actionArea.setAttribute('role', 'group');
        for (const testId of ['reply', 'retweet', 'like', 'analytics']) {
            const slot = document.createElement('div');
            const button = document.createElement('button');
            button.setAttribute('data-testid', testId);
            slot.appendChild(button);
            actionArea.appendChild(slot);
        }

        article.appendChild(unrelatedGroup);
        article.appendChild(actionArea);
        document.body.appendChild(article);

        insertSaveButton(article);

        expect(unrelatedGroup.querySelector('.x-clipper-save-button-wrapper')).toBeNull();
        const wrapper = actionArea.querySelector('.x-clipper-save-button-wrapper');
        const likeSlot = actionArea.querySelector('[data-testid="like"]')?.parentElement;
        expect(wrapper?.nextElementSibling).toBe(likeSlot);
    });

    it('prefers primary action row when multiple like groups exist', () => {
        const article = document.createElement('article');
        article.setAttribute('data-testid', 'tweet');

        const quoteSection = document.createElement('div');
        const quoteGroup = document.createElement('div');
        quoteGroup.setAttribute('role', 'group');
        const quoteLike = document.createElement('button');
        quoteLike.setAttribute('data-testid', 'like');
        quoteGroup.appendChild(quoteLike);
        quoteSection.appendChild(quoteGroup);

        const actionArea = document.createElement('div');
        actionArea.setAttribute('role', 'group');
        for (const testId of ['reply', 'retweet', 'like', 'analytics']) {
            const slot = document.createElement('div');
            const button = document.createElement('button');
            button.setAttribute('data-testid', testId);
            slot.appendChild(button);
            actionArea.appendChild(slot);
        }

        article.appendChild(quoteSection);
        article.appendChild(actionArea);
        document.body.appendChild(article);

        insertSaveButton(article);

        expect(quoteGroup.querySelector('.x-clipper-save-button-wrapper')).toBeNull();
        const wrapper = actionArea.querySelector('.x-clipper-save-button-wrapper');
        const likeSlot = actionArea.querySelector('[data-testid="like"]')?.parentElement;
        expect(wrapper?.nextElementSibling).toBe(likeSlot);
    });

    it('inserts correctly when like is in unlike state', () => {
        const { article, actionArea } = createArticleWithActions(['reply', 'retweet', 'unlike', 'analytics', 'bookmark']);

        insertSaveButton(article);

        const wrapper = actionArea.querySelector('.x-clipper-save-button-wrapper');
        const unlikeSlot = actionArea.querySelector('[data-testid="unlike"]')?.parentElement;
        expect(wrapper?.nextElementSibling).toBe(unlikeSlot);
    });
});
