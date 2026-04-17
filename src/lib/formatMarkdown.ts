import DOMPurify from 'dompurify';

/** Lightweight markdown-to-HTML converter for AI-generated analysis text. */
export function formatMarkdown(text: string): string {
  const html = text
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n- /g, '<br>\u2022 ')
    .replace(/\n(\d+)\. /g, '<br>$1. ')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>')
    .replace(/$/, '</p>')
    .replace(/<p><\/p>/g, '');
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'rel'] });
}
