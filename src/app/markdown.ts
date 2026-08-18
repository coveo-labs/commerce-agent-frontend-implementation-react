import { marked } from 'marked';

marked.setOptions({ gfm: true, breaks: true });

/** Render assistant text as markdown HTML (equivalent of the Angular pipe). */
export function renderMarkdown(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  return marked.parse(value, { async: false }) as string;
}
