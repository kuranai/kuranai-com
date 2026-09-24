import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const e2ePassword = 'dovari-e2e-password-2026';

test.beforeEach(async ({ page }) => {
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=/u);
  await page.getByLabel('Password').fill(e2ePassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/app');
});

async function openLongEditorPage(page: Page) {
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();

  const editor = page.getByRole('textbox', { name: 'Page content' });
  await editor.fill(
    Array.from(
      { length: 48 },
      (_, index) => `Line ${index + 1}: enough editor content to make the document scroll.`,
    ).join('\n'),
  );
  await expect(editor).toBeFocused();
  return { editor, toolbar: page.locator('.editor-toolbar') };
}

async function deleteCurrentPageAndWait(page: Page) {
  const currentUrl = page.url();
  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).not.toHaveURL(currentUrl);
}

test('signs the owner out and protects the app again', async ({ page }) => {
  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');
  await page.goto('/app');
  await expect(page).toHaveURL(/\/login\?next=/u);
});

test('validates and restores a lossless backup after the workspace is emptied', async ({
  page,
}, testInfo) => {
  const title = `Backup roundtrip ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await page.getByLabel('Edit title').fill(title);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Create backup' }).click();
  await expect(page).toHaveURL('/app/settings/backup');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Dovari backup' }).click();
  const download = await downloadPromise;
  const backupPath = testInfo.outputPath('dovari-backup-v2.zip');
  await download.saveAs(backupPath);

  await page.getByRole('link', { name: 'Back to pages' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  await page.getByRole('link', { name: 'Open Trash' }).click();
  await expect(page).toHaveURL('/app/settings/trash');
  const trashItem = page.locator('.trash-item').filter({ hasText: title });
  await trashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const confirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
  await confirmation.getByLabel(/Type .* to confirm/).fill(title);
  await confirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(trashItem).toHaveCount(0);

  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Restore a backup' }).click();
  await page.getByLabel('Select a Dovari backup ZIP (v1 or v2)').setInputFiles(backupPath);
  await expect(page.getByRole('heading', { name: 'Validated backup' })).toBeVisible();
  await page.getByRole('button', { name: 'Start restore' }).click();
  await expect(page.getByRole('status')).toContainText('Restored 1 pages');
  await page.getByRole('link', { name: 'Back to pages' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await deleteCurrentPageAndWait(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  await page.getByRole('link', { name: 'Open Trash' }).click();
  await expect(page).toHaveURL('/app/settings/trash');
  const restoredTrashItem = page.locator('.trash-item').filter({ hasText: title });
  await restoredTrashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const restoredConfirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
  await restoredConfirmation.getByLabel(/Type .* to confirm/).fill(title);
  await restoredConfirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(restoredTrashItem).toHaveCount(0);
});

test('creates independent template pages and reuses one local daily note', async ({ page }) => {
  const pageTemplateTitle = `Template E2E ${Date.now()}`;
  const dailyTemplateTitle = `Daily template E2E ${Date.now()}`;
  const templateBody = 'This content comes from the reusable template.';

  await page.goto('/app/settings/templates');
  await expect(page.getByRole('heading', { exact: true, name: 'Templates' })).toBeVisible();
  const desktopTemplateA11y = await new AxeBuilder({ page }).analyze();
  expect(
    desktopTemplateA11y.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { exact: true, name: 'Templates' })).toBeVisible();
  const mobileTemplateA11y = await new AxeBuilder({ page }).analyze();
  expect(
    mobileTemplateA11y.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await page.getByLabel('Template title').fill(pageTemplateTitle);
  const templateEditor = page.getByRole('textbox', { name: 'Page content' });
  await templateEditor.click();
  await page.keyboard.type(templateBody);
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('status')).toContainText('Template created.');

  await page.getByRole('button', { name: 'Create page from template' }).click();
  await expect(page).toHaveURL(/\/app\/pages\//u);
  await expect(page.getByRole('heading', { name: pageTemplateTitle })).toBeVisible();
  await expect(page.getByText(templateBody)).toBeVisible();
  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
  await page.goto('/app/settings');
  await expect(page).toHaveURL('/app/settings');
  await page.getByRole('link', { name: 'Open Trash' }).click();
  const copiedPageTrashItem = page.locator('.trash-item').filter({ hasText: pageTemplateTitle });
  await copiedPageTrashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const copiedPageConfirmation = page.getByRole('form', {
    name: `Permanently delete ${pageTemplateTitle}`,
  });
  await copiedPageConfirmation.getByLabel(/Type .* to confirm/).fill(pageTemplateTitle);
  await copiedPageConfirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(copiedPageTrashItem).toHaveCount(0);

  await page.goto('/app/settings/templates');
  await page.getByRole('button', { name: new RegExp(pageTemplateTitle) }).click();
  await expect(page.getByRole('button', { name: 'Delete template' })).toBeVisible();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete template' }).click();
  await expect(page.getByRole('button', { name: 'Create template' })).toBeEnabled();

  await page.getByLabel('Template title').fill(dailyTemplateTitle);
  await page.getByRole('textbox', { name: 'Page content' }).click();
  await page.keyboard.type('A fresh note starts here.');
  await page.getByRole('checkbox', { name: /Use for daily notes/ }).check();
  await page.getByRole('button', { name: 'Create template' }).click();
  await expect(page.getByRole('status')).toContainText('Template created.');

  await page.getByRole('button', { name: 'Open today’s note' }).click();
  await expect(page).toHaveURL(/\/app\/pages\//u);
  const dailyNoteUrl = page.url();
  await expect(page.getByRole('heading', { name: /^\d{4}-\d{2}-\d{2}$/u })).toBeVisible();
  await expect(page.getByText('A fresh note starts here.')).toBeVisible();
  const dailyNoteTitle = await page.locator('h1.page-title-heading').getAttribute('aria-label');
  expect(dailyNoteTitle).toMatch(/^\d{4}-\d{2}-\d{2}$/u);

  await page.goto('/app/settings/templates');
  await page.getByRole('button', { name: 'Open today’s note' }).click();
  await expect(page).toHaveURL(dailyNoteUrl);

  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
  await page.goto('/app/settings');
  await expect(page).toHaveURL('/app/settings');
  await page.getByRole('link', { name: 'Open Trash' }).click();
  const dailyNoteTrashItem = page.locator('.trash-item').filter({ hasText: dailyNoteTitle! });
  await dailyNoteTrashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const dailyNoteConfirmation = page.getByRole('form', {
    name: `Permanently delete ${dailyNoteTitle}`,
  });
  await dailyNoteConfirmation.getByLabel(/Type .* to confirm/).fill(dailyNoteTitle!);
  await dailyNoteConfirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(dailyNoteTrashItem).toHaveCount(0);

  await page.goto('/app/settings/templates');
  await page.getByRole('button', { name: new RegExp(dailyTemplateTitle) }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Delete template' }).click();
});

test('keeps tags and favorites through navigation and Trash restore', async ({ page }) => {
  const title = `Organization E2E page ${Date.now()}`;
  const tagName = `e2e-${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const pageUrl = page.url();
  await page.getByLabel('Edit title').fill(title);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Manage tags' }).click();
  await page.getByLabel('Create a tag').fill(tagName);
  await page.getByRole('button', { name: 'Add tag' }).click();
  await expect(page.getByRole('checkbox', { name: tagName })).toBeChecked();
  await page.getByRole('button', { name: 'Save page tags' }).click();
  await expect(page.locator('.page-tag-list .tag-chip')).toHaveText(tagName);

  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await expect(page.getByRole('button', { name: 'Favorited' })).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Favorite pages' })
      .getByRole('link', { name: `Open favorite page: ${title}` }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open command palette' }).click();
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  await palette
    .getByRole('searchbox', { name: 'Search pages or commands' })
    .fill(`Search #${tagName}`);
  const tagCommand = palette.getByRole('option').filter({ hasText: `Search #${tagName}` });
  await expect(tagCommand).toBeVisible();
  await tagCommand.click();
  await expect(palette).toHaveCount(0);
  await expect(page.locator('.sidebar-filter-tag')).toHaveCount(0);

  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Open Trash' }).click();
  await expect(page).toHaveURL('/app/settings/trash');
  const trashItem = page.locator('.trash-item').filter({ hasText: title });
  await trashItem.getByRole('button', { name: 'Restore' }).click();
  await expect(page).toHaveURL(pageUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Favorited' })).toBeVisible();
  await expect(page.locator('.page-tag-list .tag-chip')).toHaveText(tagName);

  await deleteCurrentPageAndWait(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('link', { name: 'Open Trash' }).click();
  const finalTrashItem = page.locator('.trash-item').filter({ hasText: title });
  await finalTrashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const confirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
  await confirmation.getByLabel(/Type .* to confirm/).fill(title);
  await confirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(finalTrashItem).toHaveCount(0);
});

test('publishes a page for anonymous readers and returns to private editing for unpublish', async ({
  page,
}) => {
  const title = `Public E2E page ${Date.now()}`;
  const childTitle = `Public E2E child ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const privatePageUrl = page.url();
  const privatePageId = privatePageUrl.split('/').pop();
  if (!privatePageId) {
    throw new Error('The private page URL did not contain a page id.');
  }
  await page.getByLabel('Edit title').fill(title);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const editor = page.getByRole('textbox', { name: 'Page content' });
  await editor.click();
  await page.keyboard.type('Anonymous readers can see this snapshot.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText('Not published', { exact: true })).toBeVisible();
  expect(
    await page
      .locator('.publication-panel')
      .evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThan(180);
  await page.getByRole('button', { name: 'Publish page' }).click();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' It stays current automatically.');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update publication' })).toHaveCount(0);

  const publicUrl = await page.getByRole('link', { name: 'Open public page' }).getAttribute('href');
  if (!publicUrl) {
    throw new Error('The publication did not expose a public URL.');
  }
  expect(publicUrl).toMatch(/^\/p\/[0-9a-f-]+$/u);

  await page.getByRole('button', { name: `Create child of ${title}` }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const childPrivateUrl = page.url();
  await page.getByLabel('Edit title').fill(childTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: childTitle })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();
  const childPublicUrl = await page
    .getByRole('link', { name: 'Open public page' })
    .getAttribute('href');
  if (!childPublicUrl) {
    throw new Error('The inherited child publication did not expose a public URL.');
  }
  expect(childPublicUrl).toMatch(/^\/p\/[0-9a-f-]+$/u);
  await page.goto(privatePageUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  const metadataResponse = await page.request.get(publicUrl);
  expect(metadataResponse.status()).toBe(200);
  const metadataHtml = await metadataResponse.text();
  expect(metadataHtml).toContain(`<title>${title} · Dovari</title>`);
  expect(metadataHtml).toContain('name="robots" content="noindex,nofollow"');
  expect(metadataHtml).toContain(`rel="canonical" href="http://127.0.0.1:4173${publicUrl}"`);
  expect(metadataHtml).toContain('property="og:title"');

  await page.goto('/app/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL('/login');

  await page.goto('/');
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(childTitle) })).toBeVisible();
  const publicSearch = page.getByRole('searchbox', { name: 'Search public pages' });
  await publicSearch.fill('Anonymous readers');
  await expect(page.getByRole('option').filter({ hasText: title })).toBeVisible();
  await publicSearch.press('ArrowDown');
  await publicSearch.press('Enter');
  await expect(page).toHaveURL(publicUrl);
  const robotsResponse = await page.request.get('/robots.txt');
  expect(robotsResponse.status()).toBe(200);
  expect(await robotsResponse.text()).not.toContain(publicUrl.slice('/p/'.length));
  const sitemapResponse = await page.request.get('/sitemap.xml');
  expect(sitemapResponse.status()).toBe(200);
  expect(await sitemapResponse.text()).not.toContain(publicUrl.slice('/p/'.length));
  await page.goto('/');
  const landingResults = await new AxeBuilder({ page }).analyze();
  expect(landingResults.violations.filter((violation) => violation.impact === 'critical')).toEqual(
    [],
  );

  await page.getByRole('link', { name: new RegExp(title) }).click();
  await expect(page).toHaveURL(publicUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Anonymous readers can see this snapshot.')).toBeVisible();
  await expect(page.getByText('It stays current automatically.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Page content' })).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(privatePageId);
  await page.goto(childPublicUrl);
  await expect(page.getByRole('heading', { name: childTitle })).toBeVisible();
  await page.goto(publicUrl);
  const publicResults = await new AxeBuilder({ page }).analyze();
  expect(publicResults.violations.filter((violation) => violation.impact === 'critical')).toEqual(
    [],
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const mobilePublicResults = await new AxeBuilder({ page }).analyze();
  expect(
    mobilePublicResults.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);

  await page.getByRole('link', { name: 'Edit page' }).click();
  await expect(page).toHaveURL(/\/login\?next=/u);
  await page.getByLabel('Password').fill(e2ePassword);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(privatePageUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Published', { exact: true })).toBeVisible();

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByText('Not published', { exact: true })).toBeVisible();
  await page.goto(publicUrl);
  await expect(page.getByRole('heading', { name: 'This public page is gone.' })).toBeVisible();

  await page.goto(privatePageUrl);
  await deleteCurrentPageAndWait(page);
  await page.goto(childPrivateUrl);
  await expect(page.getByRole('heading', { name: childTitle })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await page.goto('/app/settings/trash');
  const trashItem = page.locator('.trash-item').filter({ hasText: title });
  await trashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const confirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
  await confirmation.getByLabel(/Type .* to confirm/).fill(title);
  await confirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(trashItem).toHaveCount(0);
  const childTrashItem = page.locator('.trash-item').filter({ hasText: childTitle });
  await childTrashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const childConfirmation = page.getByRole('form', {
    name: `Permanently delete ${childTitle}`,
  });
  await childConfirmation.getByLabel(/Type .* to confirm/).fill(childTitle);
  await childConfirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(childTrashItem).toHaveCount(0);
});

test('creates, navigates, renames, reloads, and deletes pages', async ({ page }) => {
  const renamedTitle = `E2E page ${Date.now()}`;

  await page.goto('/app');
  await expect(page.getByRole('button', { name: /New page/ })).toBeVisible();

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page).toHaveURL(/\/app\/pages\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();

  const firstPageUrl = page.url();
  await page.getByLabel('Edit title').fill(renamedTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: renamedTitle })).toBeVisible();
  expect(
    await page.locator('.page-detail').evaluate((element) => element.getBoundingClientRect().width),
  ).toBeGreaterThan(820);
  await expect(page.getByText('Content', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Write in context.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('View current document JSON', { exact: true })).toHaveCount(0);

  await page.reload();
  await expect(page).toHaveURL(firstPageUrl);
  await expect(page.getByRole('heading', { name: renamedTitle })).toBeVisible();

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page).toHaveURL(/\/app\/pages\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const secondPageUrl = page.url();
  expect(secondPageUrl).not.toBe(firstPageUrl);

  await page.getByRole('link', { exact: true, name: renamedTitle }).click();
  await expect(page).toHaveURL(firstPageUrl);
  await expect(page.getByRole('heading', { name: renamedTitle })).toBeVisible();

  await page.getByRole('link', { exact: true, name: 'Untitled' }).click();
  await expect(page).toHaveURL(secondPageUrl);
  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL(firstPageUrl);
  await expect(page.getByRole('heading', { name: renamedTitle })).toBeVisible();

  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('heading', { name: 'Start with one useful page.' })).toBeVisible();
});

test('covers search, screenshot paste, drag and drop, and Markdown export', async ({ page }) => {
  const title = `P24 workflow ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const pageUrl = page.url();

  await page.getByLabel('Edit title').fill(title);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const editor = page.getByRole('textbox', { name: 'Page content' });
  await editor.click();
  await page.keyboard.type('Cloudflare deployment acceptance marker');

  await editor.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(
        [
          Uint8Array.from(
            atob(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            ),
            (character) => character.charCodeAt(0),
          ),
        ],
        'screenshot.png',
        { type: 'image/png' },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      }),
    );
  });
  await expect(editor.locator('.asset-image-node')).toHaveCount(1);

  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(page.url()).origin,
  });
  const wroteClipboardImage = await page.evaluate(async () => {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      return false;
    }

    const bytes = Uint8Array.from(
      atob(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      ),
      (character) => character.charCodeAt(0),
    );
    await navigator.clipboard.write([
      new ClipboardItem({ 'image/png': new Blob([bytes], { type: 'image/png' }) }),
    ]);
    return true;
  });
  expect(wroteClipboardImage).toBe(true);
  await editor.click();
  await page.keyboard.press('Control+V');
  await expect(editor.locator('.asset-image-node')).toHaveCount(2);

  const editorBox = await editor.boundingBox();
  if (!editorBox) {
    throw new Error('The page editor has no visible bounding box for the drop smoke.');
  }
  await editor.evaluate(
    (element, coordinates) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(
        new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'dropped.png', {
          type: 'image/png',
        }),
      );
      element.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: coordinates.x,
          clientY: coordinates.y,
          dataTransfer,
        }),
      );
    },
    { x: editorBox.x + 24, y: editorBox.y + 24 },
  );
  await expect(editor.locator('.asset-image-node')).toHaveCount(3);
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  const exportDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export Markdown + ZIP' }).click();
  const download = await exportDownload;
  expect(download.suggestedFilename()).toBe('dovari-export.zip');

  await page.keyboard.press('Control+K');
  const palette = page.getByRole('dialog', { name: 'Search or run a command' });
  const search = palette.getByRole('searchbox');
  await search.fill('Cloudflare deployment acceptance marker');
  await expect(palette.getByRole('option', { name: new RegExp(title) })).toBeVisible();
  await palette.getByRole('option', { name: new RegExp(title) }).press('Enter');
  await expect(page).toHaveURL(pageUrl);

  await deleteCurrentPageAndWait(page);
  await page.goto('/app/settings/trash');
  const trashItem = page.locator('.trash-item').filter({ hasText: title });
  await trashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const confirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
  await confirmation.getByLabel(/Type .* to confirm/).fill(title);
  await confirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(trashItem).toHaveCount(0);
});

test('resizes images with presets and moves an existing image without copying it', async ({
  page,
}) => {
  const title = `Image editing ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await page.getByLabel('Edit title').fill(title);
  await page.getByLabel('Edit title').press('Enter');

  const editor = page.getByRole('textbox', { name: 'Page content' });
  await editor.fill('Before image\nAfter image');
  await editor.locator('p').last().click();
  await page.keyboard.press('End');
  await editor.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(
      new File(
        [
          Uint8Array.from(
            atob(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            ),
            (character) => character.charCodeAt(0),
          ),
        ],
        'image.png',
        { type: 'image/png' },
      ),
    );
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer,
      }),
    );
  });

  const image = editor.locator('.asset-image-node');
  await expect(image).toHaveCount(1);
  await image.click();

  const imageBox = await image.boundingBox();
  const targetBox = await editor.locator('p').first().boundingBox();
  if (!imageBox || !targetBox) {
    throw new Error('The image or drop target has no visible bounding box.');
  }
  await page.keyboard.down('Control');
  await page.mouse.move(imageBox.x + imageBox.width / 2, imageBox.y + imageBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + 8, targetBox.y + targetBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  await expect(image).toHaveCount(1);
  await expect(editor.locator('p').first().locator('.asset-image-node')).toHaveCount(1);
  await expect(editor.locator('p').last().locator('.asset-image-node')).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Small' })).toBeVisible();
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await page.getByRole('button', { name: 'Medium' }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
});

test('supports a navigable page tree with child creation, collapse, drag move, and direct rename', async ({
  page,
}) => {
  const rootTitle = `Tree root ${Date.now()}`;
  const siblingTitle = `Tree sibling ${Date.now()}`;

  await page.goto('/app');
  await expect(page.getByRole('button', { name: /New page/ })).toBeVisible();

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await page.getByLabel('Edit title').fill(rootTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: rootTitle })).toBeVisible();
  const rootUrl = page.url();

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await page.getByLabel('Edit title').fill(siblingTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: siblingTitle })).toBeVisible();

  await page.getByRole('link', { exact: true, name: rootTitle }).click();
  await page.getByRole('button', { name: `Create child of ${rootTitle}` }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  await expect(page.getByRole('link', { exact: true, name: 'Untitled' })).toBeVisible();

  await page.getByRole('button', { name: `Collapse ${rootTitle}` }).click();
  await expect(page.getByRole('link', { exact: true, name: 'Untitled' })).toHaveCount(0);
  await page.getByRole('button', { name: `Expand ${rootTitle}` }).click();
  await expect(page.getByRole('link', { exact: true, name: 'Untitled' })).toBeVisible();
  const childUrl = await page
    .getByRole('link', { exact: true, name: 'Untitled' })
    .getAttribute('href');
  if (!childUrl) {
    throw new Error('The child page has no navigation URL.');
  }

  await expect(page.getByRole('button', { name: `Move ${rootTitle}` })).toHaveCount(0);
  const moveResponse = page.waitForResponse(
    (response) => response.url().includes('/move') && response.request().method() === 'POST',
  );
  await page
    .getByLabel(`Drag ${rootTitle} to move it`)
    .dragTo(page.getByLabel(`Drag ${siblingTitle} to move it`));
  await moveResponse;

  await page.goto(rootUrl);
  await expect(page.getByRole('heading', { name: rootTitle })).toBeVisible();
  await page.getByLabel('Edit title').fill(`${rootTitle} renamed`);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('link', { exact: true, name: `${rootTitle} renamed` })).toBeVisible();

  await page.goto(childUrl);
  await deleteCurrentPageAndWait(page);
  await page.goto(rootUrl);
  await expect(page.getByRole('heading', { name: `${rootTitle} renamed` })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await expect(page.getByRole('heading', { name: siblingTitle })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await expect(page.getByRole('heading', { name: 'Start with one useful page.' })).toBeVisible();
});

test('supports theme persistence, skip navigation, and the mobile sidebar drawer', async ({
  page,
}) => {
  await page.goto('/app');
  await expect(page.getByRole('combobox', { name: 'Theme' })).toHaveCount(0);
  await expect(page.getByText('Your knowledge base')).toHaveCount(0);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  await expect(page.getByRole('combobox', { name: 'Theme' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('link', { name: 'Skip to main content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const sidebar = page.locator('#workspace-sidebar');
  const navigationTrigger = page.getByRole('button', { name: 'Open pages navigation' });
  await expect(navigationTrigger).toBeVisible();
  await expect(sidebar).toBeHidden();

  await navigationTrigger.click();
  await expect(sidebar).toHaveClass(/is-open/);
  await expect(page.locator('.sidebar-backdrop')).toBeVisible();
  await expect(page.locator('.sidebar-close')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open pages navigation' })).toBeFocused();
});

test('has no critical accessibility violations in the workspace shell', async ({ page }) => {
  await page.goto('/app');

  const desktopResults = await new AxeBuilder({ page }).analyze();
  expect(desktopResults.violations.filter((violation) => violation.impact === 'critical')).toEqual(
    [],
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const navigationTrigger = page.getByRole('button', { name: 'Open pages navigation' });
  await navigationTrigger.click();

  const mobileResults = await new AxeBuilder({ page }).analyze();
  expect(mobileResults.violations.filter((violation) => violation.impact === 'critical')).toEqual(
    [],
  );

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const pageResults = await new AxeBuilder({ page }).analyze();
  expect(pageResults.violations.filter((violation) => violation.impact === 'critical')).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByLabel('Edit title')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await deleteCurrentPageAndWait(page);
});

test('supports discoverable safe links and wiki-link navigation by mouse and keyboard', async ({
  page,
}) => {
  const sourceTitle = `P20 source ${Date.now()}`;
  const targetTitle = `P20 target ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const sourceUrl = page.url();
  await page.getByLabel('Edit title').fill(sourceTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible();

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const targetUrl = page.url();
  const targetId = targetUrl.split('/').pop();
  if (!targetId) {
    throw new Error('The target page URL did not contain a page id.');
  }
  await page.getByLabel('Edit title').fill(targetTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: targetTitle })).toBeVisible();

  await page.getByRole('link', { exact: true, name: sourceTitle }).click();
  await expect(page).toHaveURL(sourceUrl);
  const editor = page.getByRole('textbox', { name: 'Page content' });
  await editor.click();
  await page.keyboard.type('https://example.com');
  await page.keyboard.press('Space');
  await expect(editor.locator('a[href="https://example.com"]')).toBeVisible();

  await editor.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'person@example.com');
    element.dispatchEvent(
      new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      }),
    );
  });
  await expect(editor.locator('a[href="mailto:person@example.com"]')).toBeVisible();

  await editor.locator('a[href="https://example.com"]').click();
  const linkDialog = page.getByRole('dialog', { name: 'Link options' });
  await expect(linkDialog).toContainText('https://example.com');
  await page.evaluate(() => {
    const browserWindow = window as Window & { __dovariOpenCalls?: string[][] };
    browserWindow.__dovariOpenCalls = [];
    window.open = ((url, target, features) => {
      browserWindow.__dovariOpenCalls?.push([String(url), String(target), String(features)]);
      return null;
    }) as typeof window.open;
  });
  await linkDialog.getByRole('button', { name: 'Open link' }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { __dovariOpenCalls?: string[][] }).__dovariOpenCalls ?? [],
      ),
    )
    .toEqual([['https://example.com', '_blank', 'noopener,noreferrer']]);

  await editor.click();
  await editor.press('Control+A');
  await editor.press('Backspace');
  await page.getByRole('button', { name: 'Wiki link' }).click();
  const wikiPicker = page.getByRole('dialog', { name: 'Wiki link picker' });
  const wikiSearch = page.getByRole('searchbox', { name: 'Search pages to link' });
  await wikiSearch.fill(targetTitle);
  await expect(
    wikiPicker.getByRole('option', { name: new RegExp(`^${targetTitle}`) }),
  ).toBeVisible();
  await wikiSearch.press('Enter');
  const wikiLink = editor.locator(`[data-dovari-wiki-link-id="${targetId}"]`);
  await expect(wikiLink).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await wikiLink.click();
  await expect(page).toHaveURL(targetUrl);
  await page.goto(sourceUrl);
  const keyboardWikiLink = page
    .getByRole('textbox', { name: 'Page content' })
    .locator(`[data-dovari-wiki-link-id="${targetId}"]`);
  await keyboardWikiLink.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(targetUrl);

  await deleteCurrentPageAndWait(page);
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await expect(page.getByRole('heading', { name: 'Start with one useful page.' })).toBeVisible();
});

test('supports delete undo, Trash restore, and revision restore', async ({ page }) => {
  const title = `Recovery page ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const pageUrl = page.url();

  await page.getByLabel('Edit title').fill(title);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rename page' })).toHaveCount(0);
  const editor = page.getByRole('textbox', { name: 'Page content' });
  await editor.click();
  await page.keyboard.type('Recoverable content');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await deleteCurrentPageAndWait(page);
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page).toHaveURL(pageUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  await page.getByRole('link', { name: 'Open Trash' }).click();
  await expect(page).toHaveURL('/app/settings/trash');
  const trashItem = page.locator('.trash-item').filter({ hasText: title });
  await expect(trashItem).toBeVisible();
  await trashItem.getByRole('button', { name: 'Restore' }).click();
  await expect(page).toHaveURL(pageUrl);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await page.getByRole('button', { name: 'Version history' }).click();
  const history = page.getByRole('dialog', { name: 'Version history' });
  await history.locator('.revision-list-item').filter({ hasText: title }).first().click();
  await expect(history.getByRole('button', { name: 'Restore this version' })).toBeVisible();
  await history.getByRole('button', { name: 'Restore this version' }).click();
  await expect(page.locator('h1.page-title-heading')).toHaveAttribute('aria-label', title);

  await page.getByRole('button', { name: 'Delete page' }).click();
  await expect(page).toHaveURL('/app');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeVisible();
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  await page.getByRole('link', { name: 'Open Trash' }).click();
  await expect(page).toHaveURL('/app/settings/trash');
  const finalTrashItem = page.locator('.trash-item').filter({ hasText: title });
  await finalTrashItem.getByRole('button', { name: 'Delete permanently' }).click();
  const confirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
  await confirmation.getByLabel(/Type .* to confirm/).fill(title);
  await confirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
  await expect(finalTrashItem).toHaveCount(0);
});

test('supports Settings, Recent Pages, and slash commands on desktop and mobile', async ({
  page,
}) => {
  const sourceTitle = `P23 source ${Date.now()}`;
  const targetTitle = `P23 target ${Date.now()}`;

  await page.goto('/app');
  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const sourceUrl = page.url();
  const sourceId = sourceUrl.split('/').pop();
  if (!sourceId) {
    throw new Error('The source page URL did not contain a page id.');
  }
  await page.getByLabel('Edit title').fill(sourceTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible();

  await page.getByRole('button', { name: /New page/ }).click();
  await expect(page.getByRole('heading', { name: 'Untitled' })).toBeVisible();
  const targetUrl = page.url();
  const targetId = targetUrl.split('/').pop();
  if (!targetId) {
    throw new Error('The target page URL did not contain a page id.');
  }
  await page.getByLabel('Edit title').fill(targetTitle);
  await page.getByLabel('Edit title').press('Enter');
  await expect(page.getByRole('heading', { name: targetTitle })).toBeVisible();

  const recentPages = page.getByRole('navigation', { name: 'Recent pages' });
  await expect(
    recentPages.getByRole('link', { name: `Open recent page: ${sourceTitle}` }),
  ).toBeVisible();
  await expect(
    recentPages.getByRole('link', { name: `Open recent page: ${targetTitle}` }),
  ).toHaveCount(0);

  await page.getByRole('link', { name: `Open recent page: ${sourceTitle}` }).click();
  await expect(page).toHaveURL(sourceUrl);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Trash' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open version history' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create backup' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Restore a backup' })).toBeVisible();

  await page.getByRole('link', { name: 'Open version history' }).click();
  await expect(page).toHaveURL(/\/app\/pages\/[^/]+\?history=1$/);
  await expect(page.getByRole('dialog', { name: 'Version history' })).toBeVisible();
  await page.getByRole('button', { name: 'Close version history' }).click();
  await expect(page).toHaveURL(/\/app\/pages\/[^?]+$/);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL('/app/settings');

  const desktopSettingsResults = await new AxeBuilder({ page }).analyze();
  expect(
    desktopSettingsResults.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  const navigationTrigger = page.getByRole('button', { name: 'Open pages navigation' });
  await navigationTrigger.click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  const mobileSettingsResults = await new AxeBuilder({ page }).analyze();
  expect(
    mobileSettingsResults.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(sourceUrl);
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible();
  const editor = page.getByRole('textbox', { name: 'Page content' });

  await editor.click();
  await page.keyboard.type('/heading 2');
  await expect(page.getByRole('dialog', { name: 'Slash commands' })).toBeVisible();
  const desktopSlashResults = await new AxeBuilder({ page }).analyze();
  expect(
    desktopSlashResults.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);
  await page.keyboard.press('Enter');
  await expect(editor.locator('h2')).toBeVisible();

  await editor.click();
  await editor.press('Control+A');
  await editor.press('Backspace');
  await page.keyboard.type('/wiki');
  await page.keyboard.press('Enter');
  const wikiPicker = page.getByRole('dialog', { name: 'Wiki link picker' });
  const wikiSearch = page.getByRole('searchbox', { name: 'Search pages to link' });
  await wikiSearch.fill(targetTitle);
  await expect(
    wikiPicker.getByRole('option', { name: new RegExp(`^${targetTitle}`) }),
  ).toBeVisible();
  await wikiSearch.press('Enter');
  await expect(editor.locator(`[data-dovari-wiki-link-id="${targetId}"]`)).toBeVisible();

  await editor.click();
  await editor.press('Control+A');
  await editor.press('Backspace');
  await page.keyboard.type('/image');
  await page.keyboard.press('Enter');
  await page.locator('input.slash-command-file-input').setInputFiles({
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
    mimeType: 'image/png',
    name: 'pixel.png',
  });
  await expect(editor.locator('.asset-image-node')).toBeVisible();

  await editor.click();
  await editor.press('Control+A');
  await editor.press('Backspace');
  await page.keyboard.type('/file');
  await page.keyboard.press('Enter');
  await page.locator('input.slash-command-file-input').setInputFiles({
    buffer: Buffer.from('notes from slash command'),
    mimeType: 'text/plain',
    name: 'notes.txt',
  });
  await expect(editor.locator('.asset-attachment-node')).toBeVisible();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(targetUrl);
  await expect(page.getByRole('heading', { name: targetTitle })).toBeVisible();
  const mobileEditor = page.getByRole('textbox', { name: 'Page content' });
  await mobileEditor.click();
  await page.keyboard.type('/');
  await expect(page.getByRole('dialog', { name: 'Slash commands' })).toBeVisible();
  const mobileSlashResults = await new AxeBuilder({ page }).analyze();
  expect(
    mobileSlashResults.violations.filter((violation) => violation.impact === 'critical'),
  ).toEqual([]);
  await page.keyboard.press('Escape');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(targetUrl);
  await expect(page.getByRole('heading', { name: targetTitle })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await page.goto(sourceUrl);
  await expect(page.getByRole('heading', { name: sourceTitle })).toBeVisible();
  await deleteCurrentPageAndWait(page);
  await page.goto('/app/settings/trash');
  for (const title of [sourceTitle, targetTitle]) {
    const trashItem = page.locator('.trash-item').filter({ hasText: title });
    await trashItem.getByRole('button', { name: 'Delete permanently' }).click();
    const confirmation = page.getByRole('form', { name: `Permanently delete ${title}` });
    await confirmation.getByLabel(/Type .* to confirm/).fill(title);
    await confirmation.getByRole('button', { name: 'Confirm permanent delete' }).click();
    await expect(trashItem).toHaveCount(0);
  }
});

test('keeps the formatting toolbar reachable while a long document is scrolled', async ({
  page,
}) => {
  const { editor, toolbar } = await openLongEditorPage(page);

  await expect(toolbar.getByRole('button', { name: 'Checklist' })).toHaveAttribute(
    'aria-keyshortcuts',
    'Alt+C',
  );
  await expect(toolbar.getByRole('button', { name: 'Checklist' })).toHaveAttribute(
    'title',
    /Alt\+C/u,
  );

  await editor.locator('p').last().scrollIntoViewIfNeeded();

  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox?.y).toBeGreaterThanOrEqual(0);
  expect(toolbarBox?.y).toBeLessThan(page.viewportSize()?.height ?? 0);

  const headerBox = await page.locator('.app-header').boundingBox();
  expect(headerBox).not.toBeNull();
  expect(toolbarBox?.y).toBeGreaterThanOrEqual((headerBox?.y ?? 0) + (headerBox?.height ?? 0));

  await page.setViewportSize({ width: 820, height: 720 });
  await editor.locator('p').last().scrollIntoViewIfNeeded();
  const narrowToolbarBox = await toolbar.boundingBox();
  const narrowHeaderBox = await page.locator('.app-header').boundingBox();
  expect(narrowToolbarBox).not.toBeNull();
  expect(narrowHeaderBox).not.toBeNull();
  expect(narrowToolbarBox?.y).toBeGreaterThanOrEqual(
    (narrowHeaderBox?.y ?? 0) + (narrowHeaderBox?.height ?? 0),
  );
  expect(narrowToolbarBox?.y).toBeLessThan(page.viewportSize()?.height ?? 0);
});

test('docks the mobile toolbar above the keyboard inset', async ({ page }) => {
  const { editor, toolbar } = await openLongEditorPage(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await editor.click();
  await expect(toolbar).toHaveCSS('position', 'fixed');

  await page.evaluate(() => {
    const visualViewport = {
      height: window.innerHeight - 280,
      offsetTop: 0,
      addEventListener() {},
      removeEventListener() {},
    };

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    });
    window.dispatchEvent(new Event('resize'));
  });

  await expect
    .poll(() =>
      editor
        .locator('..')
        .evaluate((element) =>
          getComputedStyle(element).getPropertyValue('--editor-keyboard-inset').trim(),
        ),
    )
    .toBe('280px');

  const toolbarBox = await toolbar.boundingBox();
  expect(toolbarBox).not.toBeNull();
  expect(toolbarBox ? toolbarBox.y + toolbarBox.height : undefined).toBeLessThanOrEqual(844 - 280);
});
