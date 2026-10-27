/** Evidence snippet: starts at the nearest sentence/word boundary before the match and always contains the match. */
export function snippet(text: string, index: number, matchLength: number, before = 60, after = 110) {
  let start = Math.max(0, index - before);
  const sentence = Math.max(text.lastIndexOf(". ", index), text.lastIndexOf(".\n", index));
  if (sentence >= start && sentence < index) start = sentence + 2;
  else if (start > 0) {
    const ws = text.slice(start, index).search(/\s/);
    if (ws !== -1) start = start + ws + 1;
  }
  let end = Math.min(text.length, index + matchLength + after);
  if (end < text.length) {
    const tail = text.slice(index + matchLength, end);
    const lastWs = Math.max(tail.lastIndexOf(" "), tail.lastIndexOf("\n"));
    if (lastWs > 0) end = index + matchLength + lastWs;
  }
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
