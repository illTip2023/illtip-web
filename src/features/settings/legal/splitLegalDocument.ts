/**
 * Splits legal copy into readable paragraphs without altering the text.
 * Multi-paragraph docs (already using blank lines) are split as-is.
 * Single-block legacy docs get breaks before numbered sections / contact blocks.
 */
export function splitLegalDocument(text: string): string[] {
  let normalized = text;
  if (!text.includes('\n\n')) {
    normalized = text
      .replace(/\s+(Questions or Additional Information)/g, '\n\n$1')
      .replace(/\s+(Contact Information)/g, '\n\n$1')
      .replace(/\s+(\d+\.\s)/g, '\n\n$1');
  }

  return normalized
    .split('\n\n')
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}
