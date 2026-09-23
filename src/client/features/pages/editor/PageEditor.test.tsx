import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetResponse } from '../../../../shared/assets';
import type { PageDetail, PageSummary, TiptapDocument } from '../../../../shared/pages';
import { AssetUploadError, type UploadAsset } from '../../assets/api';
import { PageEditor } from './PageEditor';

const documentWithFormatting: TiptapDocument = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Existing heading' }],
    },
    {
      type: 'paragraph',
      content: [
        { marks: [{ type: 'bold' }], text: 'bold text', type: 'text' },
        { marks: [{ type: 'italic' }], text: ' and italic text', type: 'text' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A bullet' }] }],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A task' }] }],
        },
      ],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A quote' }] }],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'ts' },
      content: [{ type: 'text', text: 'const answer = 42;' }],
    },
    { type: 'horizontalRule' },
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          text: 'Documentation',
        },
      ],
    },
  ],
};

const assetId = '11111111-1111-4111-8111-111111111111';

const documentWithAssets: TiptapDocument = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Before ' },
        { type: 'assetImage', attrs: { assetId, alt: 'A screenshot', title: 'Capture' } },
        { type: 'text', text: ' and ' },
        { type: 'attachment', attrs: { assetId, filename: 'notes.txt', title: 'Notes' } },
      ],
    },
  ],
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('PageEditor', () => {
  it('loads the supported document nodes and marks without interpreting HTML', async () => {
    const { container } = render(<PageEditor content={documentWithFormatting} />);

    const editor = await screen.findByRole('textbox', { name: 'Page content' });

    expect(editor.querySelector('h1')?.textContent).toContain('Existing heading');
    expect(editor.querySelector('strong')?.textContent).toContain('bold text');
    expect(editor.querySelector('em')?.textContent).toContain('and italic text');
    expect(editor.querySelector('ul:not([data-type="taskList"])')?.textContent).toContain(
      'A bullet',
    );
    expect(editor.querySelector('ul[data-type="taskList"]')?.textContent).toContain('A task');
    expect(editor.querySelector('blockquote')?.textContent).toContain('A quote');
    expect(editor.querySelector('pre code')?.textContent).toContain('const answer = 42;');
    expect(editor.querySelector('pre code .hljs-keyword')?.textContent).toBe('const');
    expect(editor.querySelector('hr')).toBeTruthy();
    expect(editor.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('dangerously');
  });

  it('lets the user select the language of a code block and persists it', async () => {
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [
            {
              type: 'codeBlock',
              attrs: { language: 'ts' },
              content: [{ type: 'text', text: 'const answer = 42;' }],
            },
          ],
        }}
        onChange={onChange}
      />,
    );

    const language = await screen.findByRole('combobox', { name: 'Code language' });
    expect(language.hasAttribute('disabled')).toBe(false);
    expect(language.querySelector('option:checked')?.textContent).toBe('TypeScript');

    fireEvent.change(language, { target: { value: 'python' } });

    await waitFor(() => {
      const serialized = onChange.mock.lastCall?.[0] as TiptapDocument;
      expect(serialized.content[0]?.attrs).toEqual({ language: 'python' });
    });
    expect(
      screen
        .getByRole('textbox', { name: 'Page content' })
        .querySelector('code')
        ?.classList.contains('language-python'),
    ).toBe(true);
  });

  it('only shows the code language selector for the active code block', async () => {
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Plain text' }] }],
        }}
      />,
    );

    await screen.findByRole('textbox', { name: 'Page content' });
    expect(screen.queryByRole('combobox', { name: 'Code language' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Code block' }));
    expect(await screen.findByRole('combobox', { name: 'Code language' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Code block' }));
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Code language' })).toBeNull(),
    );
  });

  it('renders persisted asset nodes from their asset ids', async () => {
    render(<PageEditor content={documentWithAssets} />);

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    const image = editor.querySelector('.asset-image-node');
    const attachment = editor.querySelector('.asset-attachment-node');

    expect(image?.getAttribute('src')).toBe(`/api/private/assets/${assetId}/content`);
    expect(image?.getAttribute('alt')).toBe('A screenshot');
    expect(attachment?.getAttribute('href')).toBe(`/api/private/assets/${assetId}/content`);
    expect(attachment?.textContent).toContain('notes.txt');
    expect(JSON.stringify(documentWithAssets)).not.toContain('blob:');
  });

  it('shows a readable fallback when an inline asset cannot be loaded', async () => {
    render(<PageEditor content={documentWithAssets} />);

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    const image = editor.querySelector('.asset-image-node');
    expect(image).not.toBeNull();

    fireEvent.error(image!);

    const fallback = await screen.findByText('Image unavailable: A screenshot');
    expect(fallback.hidden).toBe(false);
    expect(image?.getAttribute('data-dovari-asset-status')).toBe('missing');
  });

  it('marks a missing attachment without breaking the surrounding document', async () => {
    const fetchAsset = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal('fetch', fetchAsset);
    render(<PageEditor content={documentWithAssets} />);

    const fallback = await screen.findByText('Attachment unavailable: notes.txt');
    expect(fallback.hidden).toBe(false);
    expect(fetchAsset).toHaveBeenCalledWith(
      `/api/private/assets/${assetId}/content`,
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(screen.getByRole('textbox', { name: 'Page content' }).textContent).toContain('Before');
  });

  it('uploads a pasted screenshot and inserts one asset image without a temporary URL', async () => {
    const onChange = vi.fn();
    const uploadAsset = vi.fn<UploadAsset>().mockResolvedValue({
      contentUrl: `/api/private/assets/${assetId}/content`,
      filename: 'screenshot.png',
      id: assetId,
      mimeType: 'image/png',
      sizeBytes: 128,
    });
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        pageId="22222222-2222-4222-8222-222222222222"
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    const screenshot = new File(['png bytes'], 'screenshot.png', { type: 'image/png' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [screenshot],
        getData: () => '',
      },
    });

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce());
    await waitFor(() => expect(editor.querySelector('.asset-image-node')).not.toBeNull());

    expect(uploadAsset.mock.calls[0]?.[1]).toMatchObject({
      pageId: '22222222-2222-4222-8222-222222222222',
    });
    const serialized = onChange.mock.lastCall?.[0] as TiptapDocument;
    expect(serialized.content[0]?.content).toContainEqual({
      attrs: { assetId, alt: '', height: null, title: null, width: null },
      type: 'assetImage',
    });
    expect(JSON.stringify(serialized)).not.toContain('blob:');
    expect(editor.querySelector('.asset-upload-decoration')).toBeNull();
  });

  it('does not insert an upload that finishes after the page changes', async () => {
    const onChange = vi.fn();
    let resolveUpload!: (asset: AssetResponse) => void;
    const uploadAsset = vi.fn<UploadAsset>(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve;
        }),
    );
    const view = render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        pageId="44444444-4444-4444-8444-444444444444"
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(['png bytes'], 'screenshot.png', { type: 'image/png' })],
        getData: () => '',
      },
    });
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce());

    view.rerender(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        pageId="55555555-5555-4555-8555-555555555555"
        uploadAsset={uploadAsset}
      />,
    );
    await screen.findByRole('textbox', { name: 'Page content' });

    resolveUpload({
      contentUrl: `/api/private/assets/${assetId}/content`,
      filename: 'screenshot.png',
      id: assetId,
      mimeType: 'image/png',
      sizeBytes: 128,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(view.container.querySelector('.asset-image-node')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uploads a dropped non-image file as an attachment at the drop position', async () => {
    const uploadAsset = vi.fn<UploadAsset>().mockResolvedValue({
      contentUrl: `/api/private/assets/${assetId}/content`,
      filename: 'notes.txt',
      id: assetId,
      mimeType: 'text/plain',
      sizeBytes: 20,
    });
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Drop here' }] }],
        }}
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => editor,
    });
    fireEvent.drop(editor, {
      clientX: 0,
      clientY: 0,
      dataTransfer: {
        files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })],
        getData: () => '',
        types: ['Files'],
      },
    });

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce());
    await waitFor(() => expect(editor.querySelector('.asset-attachment-node')).not.toBeNull());
    expect(editor.querySelector('.asset-attachment-node')?.textContent).toContain('notes.txt');
  });

  it('shows an upload error and retries without changing document content', async () => {
    const onChange = vi.fn();
    const uploadAsset = vi
      .fn<UploadAsset>()
      .mockRejectedValueOnce(
        new AssetUploadError(415, 'ASSET_MIME_NOT_ALLOWED', 'This file type is not supported.'),
      )
      .mockResolvedValueOnce({
        contentUrl: `/api/private/assets/${assetId}/content`,
        filename: 'notes.txt',
        id: assetId,
        mimeType: 'text/plain',
        sizeBytes: 20,
      });
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        pageId="33333333-3333-4333-8333-333333333333"
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    fireEvent.paste(editor, {
      clipboardData: { files: [file], getData: () => '' },
    });

    const retry = await screen.findByRole('button', { name: 'Retry upload notes.txt' });
    expect(screen.getByRole('alert').textContent).toContain('This file type is not supported.');
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(retry);
    await waitFor(() => expect(uploadAsset).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(editor.querySelector('.asset-attachment-node')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Retry upload notes.txt' })).toBeNull();
  });

  it('removes a failed upload decoration without removing editor content', async () => {
    const uploadAsset = vi
      .fn<UploadAsset>()
      .mockRejectedValue(
        new AssetUploadError(415, 'ASSET_MIME_NOT_ALLOWED', 'This file type is not supported.'),
      );
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keep this' }] }],
        }}
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })],
        getData: () => '',
      },
    });

    const remove = await screen.findByRole('button', { name: 'Remove failed upload bad.svg' });
    fireEvent.click(remove);
    await waitFor(() => expect(editor.querySelector('.asset-upload-decoration')).toBeNull());
    expect(editor.textContent).toContain('Keep this');
  });

  it('serializes a toolbar formatting change and keeps focus in the editor', async () => {
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Write here' }] }],
        }}
        onChange={onChange}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    editor.focus();
    expect(document.activeElement).toBe(editor);

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Heading 2' }));
    expect(document.activeElement).toBe(editor);
    fireEvent.click(screen.getByRole('button', { name: 'Heading 2' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const serialized = onChange.mock.lastCall?.[0] as TiptapDocument;
    expect(serialized.content[0]).toMatchObject({ attrs: { level: 2 }, type: 'heading' });
    expect(editor.querySelector('h2')?.textContent).toContain('Write here');
  });

  it('supports the Mod-B keyboard shortcut for bold text', async () => {
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Keyboard ready' }] }],
        }}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    editor.focus();
    fireEvent.keyDown(editor, { ctrlKey: true, key: 'b' });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Bold' }).getAttribute('aria-pressed')).toBe(
        'true',
      ),
    );
  });

  it('opens the slash palette, filters commands, and inserts a heading with Enter', async () => {
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '/heading' : ''),
      },
    });

    const palette = await screen.findByRole('dialog', { name: 'Slash commands' });
    expect(palette.textContent).toContain('Heading 1');
    expect(palette.textContent).toContain('Heading 2');
    expect(palette.textContent).not.toContain('Bullet List');

    fireEvent.keyDown(editor, { key: 'Enter' });

    await waitFor(() => expect(editor.querySelector('h1')).not.toBeNull());
    expect(screen.queryByRole('dialog', { name: 'Slash commands' })).toBeNull();
    expect(editor.textContent).not.toContain('/heading');
    expect((onChange.mock.lastCall?.[0] as TiptapDocument).content[0]).toMatchObject({
      attrs: { level: 1 },
      type: 'heading',
    });
  });

  it('inserts one focused checklist item from the slash menu without an extra paragraph', async () => {
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '/checklist' : ''),
      },
    });

    await screen.findByRole('dialog', { name: 'Slash commands' });
    fireEvent.click(screen.getByRole('option', { name: /Checklist/ }));

    await waitFor(() => expect(editor.querySelector('ul[data-type="taskList"]')).not.toBeNull());
    expect((onChange.mock.lastCall?.[0] as TiptapDocument).content).toEqual([
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [{ type: 'paragraph' }],
          },
        ],
      },
    ]);
    expect(editor.children).toHaveLength(1);
    expect(editor.querySelectorAll('li.page-editor-task-item')).toHaveLength(1);
    expect(document.activeElement).toBe(editor);
  });

  it('closes the slash palette with Escape without removing the query', async () => {
    render(<PageEditor content={{ type: 'doc', content: [{ type: 'paragraph' }] }} />);

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '/heading' : ''),
      },
    });
    await screen.findByRole('dialog', { name: 'Slash commands' });

    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(screen.queryByRole('dialog', { name: 'Slash commands' })).toBeNull();
    expect(editor.textContent).toBe('/heading');
  });

  it('uses the existing wiki-link picker after choosing Wiki Link', async () => {
    const target: PageSummary = {
      id: '66666666-6666-4666-8666-666666666666',
      isFavorite: false,
      parentId: null,
      position: 0,
      revision: 1,
      slug: 'cloudflare-workers',
      title: 'Cloudflare Workers',
      tags: [],
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    const searchWikiLinks = vi.fn().mockResolvedValue({ pages: [target] });
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        searchWikiLinkPages={searchWikiLinks}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '/' : ''),
      },
    });
    await screen.findByRole('dialog', { name: 'Slash commands' });
    fireEvent.click(screen.getByRole('option', { name: /Wiki Link/ }));

    const search = await screen.findByRole('searchbox', { name: 'Search pages to link' });
    fireEvent.change(search, { target: { value: 'Cloudflare' } });
    await screen.findByRole('option', { name: /Cloudflare Workers/ });
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() => expect(editor.querySelector('[data-dovari-wiki-link-id]')).not.toBeNull());
    expect(editor.textContent).toContain('[[Cloudflare Workers]]');
    expect(editor.textContent).not.toContain('/');
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      content: [
        {
          content: [
            { attrs: { targetPageId: target.id, targetTitle: target.title }, type: 'wikiLink' },
          ],
          type: 'paragraph',
        },
      ],
    });
  });

  it('opens the image picker and inserts through the shared upload pipeline', async () => {
    const asset = {
      contentUrl: '/api/private/assets/11111111-1111-4111-8111-111111111111/content',
      filename: 'screenshot.png',
      id: '11111111-1111-4111-8111-111111111111',
      mimeType: 'image/png',
      sizeBytes: 128,
    } satisfies AssetResponse;
    const uploadAsset = vi.fn<UploadAsset>().mockResolvedValue(asset);
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        pageId="22222222-2222-4222-8222-222222222222"
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '/' : ''),
      },
    });
    await screen.findByRole('dialog', { name: 'Slash commands' });
    fireEvent.click(screen.getByRole('option', { name: /Image/ }));

    const fileInput = screen.getByLabelText('Choose an image or file');
    fireEvent.change(fileInput, {
      target: { files: [new File(['png'], 'screenshot.png', { type: 'image/png' })] },
    });

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce());
    await waitFor(() => expect(editor.querySelector('.asset-image-node')).not.toBeNull());
    expect(editor.textContent).not.toContain('/');
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      content: [
        {
          content: [{ attrs: { assetId: asset.id }, type: 'assetImage' }],
          type: 'paragraph',
        },
      ],
    });
  });

  it('opens the file picker and inserts an attachment through the shared upload pipeline', async () => {
    const asset = {
      contentUrl: '/api/private/assets/33333333-3333-4333-8333-333333333333/content',
      filename: 'notes.txt',
      id: '33333333-3333-4333-8333-333333333333',
      mimeType: 'text/plain',
      sizeBytes: 20,
    } satisfies AssetResponse;
    const uploadAsset = vi.fn<UploadAsset>().mockResolvedValue(asset);
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        pageId="44444444-4444-4444-8444-444444444444"
        uploadAsset={uploadAsset}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '/' : ''),
      },
    });
    await screen.findByRole('dialog', { name: 'Slash commands' });
    fireEvent.click(screen.getByRole('option', { name: /^File/ }));
    fireEvent.change(screen.getByLabelText('Choose an image or file'), {
      target: { files: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] },
    });

    await waitFor(() => expect(uploadAsset).toHaveBeenCalledOnce());
    await waitFor(() => expect(editor.querySelector('.asset-attachment-node')).not.toBeNull());
    expect(editor.querySelector('.asset-attachment-node')?.textContent).toContain('notes.txt');
  });

  it('opens wiki-link autocomplete and selects an existing page with the keyboard', async () => {
    const onChange = vi.fn();
    const target: PageSummary = {
      id: '66666666-6666-4666-8666-666666666666',
      isFavorite: false,
      parentId: null,
      position: 0,
      revision: 1,
      slug: 'cloudflare-workers',
      title: 'Cloudflare Workers',
      tags: [],
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    const searchWikiLinks = vi.fn().mockResolvedValue({ pages: [target] });
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
        searchWikiLinkPages={searchWikiLinks}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '[[' : ''),
      },
    });

    const listbox = await screen.findByRole('listbox', { name: 'Wiki link suggestions' });
    expect(listbox.textContent).toContain('Cloudflare Workers');
    expect(searchWikiLinks).toHaveBeenCalledWith('', expect.any(AbortSignal));

    fireEvent.keyDown(editor, { key: 'Enter' });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalled();
      expect(onChange.mock.lastCall?.[0]).toMatchObject({
        content: [
          {
            content: [
              { attrs: { targetPageId: target.id, targetTitle: target.title }, type: 'wikiLink' },
            ],
            type: 'paragraph',
          },
        ],
        type: 'doc',
      });
    });
    expect(screen.queryByRole('listbox', { name: 'Wiki link suggestions' })).toBeNull();
  });

  it('offers the same wiki-link picker from the labeled toolbar entry', async () => {
    const target: PageSummary = {
      id: '99999999-9999-4999-8999-999999999999',
      isFavorite: false,
      parentId: null,
      position: 0,
      revision: 1,
      slug: 'cloudflare-workers',
      title: 'Cloudflare Workers',
      tags: [],
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    const searchWikiLinks = vi.fn().mockResolvedValue({ pages: [target] });
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Link here' }] }],
        }}
        onChange={onChange}
        searchWikiLinkPages={searchWikiLinks}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    editor.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Wiki link' }));

    const picker = await screen.findByRole('dialog', { name: 'Wiki link picker' });
    const search = screen.getByRole('searchbox', { name: 'Search pages to link' });
    expect(picker.textContent).toContain('Type [[ in the editor');
    expect(searchWikiLinks).toHaveBeenCalledWith('', expect.any(AbortSignal));

    fireEvent.change(search, { target: { value: 'Cloudflare' } });
    const option = await screen.findByRole('option', { name: /Cloudflare Workers/ });
    expect(searchWikiLinks).toHaveBeenLastCalledWith('Cloudflare', expect.any(AbortSignal));
    fireEvent.keyDown(search, { key: 'Enter' });

    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0]).toMatchObject({
        content: [
          {
            content: [
              {
                attrs: { targetPageId: target.id, targetTitle: target.title },
                type: 'wikiLink',
              },
              { text: 'Link here', type: 'text' },
            ],
            type: 'paragraph',
          },
        ],
        type: 'doc',
      }),
    );
    expect(option).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Wiki link picker' })).toBeNull();
  });

  it('creates a page from an unresolved wiki-link suggestion', async () => {
    const createdPage: PageDetail = {
      content: { type: 'doc', content: [] },
      contentText: '',
      createdAt: '2026-09-13T00:00:00.000Z',
      deletedAt: null,
      id: '77777777-7777-4777-8777-777777777777',
      isFavorite: false,
      parentId: null,
      position: 0,
      revision: 1,
      slug: 'new-page',
      title: 'New Page',
      tags: [],
      updatedAt: '2026-09-13T00:00:00.000Z',
    };
    const createWikiLinkPage = vi.fn().mockResolvedValue({ page: createdPage });
    const onPageCreated = vi.fn();
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        createWikiLinkPage={createWikiLinkPage}
        onChange={onChange}
        onPageCreated={onPageCreated}
        searchWikiLinkPages={vi.fn().mockResolvedValue({ pages: [] })}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? '[[New Page' : ''),
      },
    });

    const createOption = await screen.findByRole('option', { name: 'Create “New Page”' });
    fireEvent.click(createOption);
    await waitFor(() =>
      expect(createWikiLinkPage).toHaveBeenCalledWith({ parentId: null, title: 'New Page' }),
    );
    expect(onPageCreated).toHaveBeenCalledWith(createdPage);
    await waitFor(() =>
      expect(onChange.mock.lastCall?.[0]).toMatchObject({
        content: [
          {
            content: [
              {
                attrs: { targetPageId: createdPage.id, targetTitle: createdPage.title },
                type: 'wikiLink',
              },
            ],
            type: 'paragraph',
          },
        ],
      }),
    );
  });

  it('renders unresolved links and navigates resolved wiki links by page id', async () => {
    const onNavigateToPage = vi.fn();
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  attrs: {
                    targetPageId: '88888888-8888-4888-8888-888888888888',
                    targetTitle: 'Stable target',
                  },
                  type: 'wikiLink',
                },
                {
                  attrs: { targetPageId: null, targetTitle: 'Missing page' },
                  type: 'wikiLink',
                },
              ],
            },
          ],
        }}
        onNavigateToPage={onNavigateToPage}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    expect(editor.querySelector('.wiki-link-unresolved')?.textContent).toContain(
      '[[Missing page]]',
    );
    const resolved = editor.querySelector('[data-dovari-wiki-link-id]');
    expect(resolved).not.toBeNull();
    fireEvent.click(resolved!);
    expect(onNavigateToPage).toHaveBeenCalledWith('88888888-8888-4888-8888-888888888888');
  });

  it('autolinks a pasted web address and email address', async () => {
    const onChange = vi.fn();
    render(
      <PageEditor
        content={{ type: 'doc', content: [{ type: 'paragraph' }] }}
        onChange={onChange}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? 'https://example.com/docs' : ''),
      },
    });

    const link = await waitFor(() => {
      const element = editor.querySelector<HTMLAnchorElement>('a');
      expect(element).not.toBeNull();
      return element;
    });
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(onChange).toHaveBeenCalled();

    fireEvent.paste(editor, {
      clipboardData: {
        files: [],
        getData: (type: string) => (type === 'text/plain' ? 'person@example.com' : ''),
      },
    });
    await waitFor(() =>
      expect(editor.querySelector('a[href="mailto:person@example.com"]')).not.toBeNull(),
    );
  });

  it('opens, edits, and removes a normal link without losing the editor selection', async () => {
    const onChange = vi.fn();
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  marks: [{ attrs: { href: 'https://example.com' }, type: 'link' }],
                  text: 'Documentation',
                  type: 'text',
                },
              ],
            },
          ],
        }}
        onChange={onChange}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    const link = editor.querySelector<HTMLAnchorElement>('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    fireEvent.click(link!);

    expect((await screen.findByRole('dialog', { name: 'Link options' })).textContent).toContain(
      'https://example.com',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer');
    expect(document.activeElement).toBe(editor);

    fireEvent.click(link!);
    fireEvent.click(screen.getByRole('button', { name: 'Edit link' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Link URL' }), {
      target: { value: 'https://example.org/updated' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() =>
      expect(editor.querySelector('a[href="https://example.org/updated"]')).not.toBeNull(),
    );

    const updatedLink = editor.querySelector<HTMLAnchorElement>(
      'a[href="https://example.org/updated"]',
    );
    fireEvent.click(updatedLink!);
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));
    await waitFor(() => expect(editor.querySelector('a')).toBeNull());
    expect(editor.textContent).toContain('Documentation');
    expect(onChange).toHaveBeenCalled();
  });

  it('falls back to an empty document for unknown nodes', async () => {
    const unsafeDocument = {
      type: 'doc',
      content: [
        {
          type: 'html',
          attrs: { html: '<script>window.__dovariAttack = true</script>' },
        },
      ],
    } as unknown as TiptapDocument;

    const { container } = render(<PageEditor content={unsafeDocument} />);
    const editor = await screen.findByRole('textbox', { name: 'Page content' });

    expect(editor.textContent).toBe('');
    expect(container.querySelector('script')).toBeNull();
    expect((window as Window & { __dovariAttack?: boolean }).__dovariAttack).toBeUndefined();
  });

  it('rejects unsafe link URLs in the link form', async () => {
    render(
      <PageEditor
        content={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Link text' }] }],
        }}
      />,
    );

    const editor = await screen.findByRole('textbox', { name: 'Page content' });
    editor.focus();
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    fireEvent.change(screen.getByLabelText('Link URL'), {
      target: { value: 'javascript:alert(1)' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect((await screen.findByRole('alert')).textContent).toContain('http, https, mailto');
    expect(editor.querySelector('a')).toBeNull();
  });
});
