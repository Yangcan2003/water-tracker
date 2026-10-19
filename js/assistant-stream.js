// Preview only the top-level reply string. Partial JSON/action proposals must
// never become visible or executable before the completed response is checked.
function jsonString(text, start) {
  let value = "", index = start + 1;
  for (; index < text.length; index++) {
    const char = text[index];
    if (char === '"') return { value, end: index + 1, complete: true };
    if (char === "\\") {
      const escape = text[index + 1];
      if (!escape) break;
      const count = escape === "u" ? 6 : 2;
      if (index + count > text.length) break;
      try { value += JSON.parse(`"${text.slice(index, index + count)}"`); } catch { break; }
      index += count - 1;
    } else if (char.charCodeAt(0) < 32) break;
    else value += char;
  }
  // A UTF-16 surrogate pair can span two provider deltas.
  if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return { value, end: index, complete: false };
}

export function previewAssistantReply(raw) {
  if (typeof raw !== "string" || raw.length > 24000 || !raw.trimStart().startsWith("{")) return "";
  let depth = 0;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (char === '"') {
      const token = jsonString(raw, i);
      if (!token.complete) return "";
      let next = token.end;
      while (/\s/.test(raw[next] || "") && next < raw.length) next++;
      if (depth === 1 && raw[next] === ":" && token.value === "reply") {
        next++;
        while (/\s/.test(raw[next] || "") && next < raw.length) next++;
        return raw[next] === '"' ? jsonString(raw, next).value.slice(0, 6000) : "";
      }
      i = token.end - 1;
    } else if (char === "{" || char === "[") depth++;
    else if (char === "}" || char === "]") depth--;
  }
  return "";
}
