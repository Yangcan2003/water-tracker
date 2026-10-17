const esc = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function formatAssistantText(value) {
  const inline = text => esc(text).replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>").replace(/`([^`\n]+)`/g, "<code>$1</code>");
  const output = []; let list = [], kind = "";
  const flush = () => { if (list.length) output.push(`<${kind}>${list.map(item => `<li>${inline(item)}</li>`).join("")}</${kind}>`); list = []; kind = ""; };
  for (const line of String(value).split("\n")) {
    const match = line.match(/^([-*] |\d+[.)、] )(.+)$/);
    if (match) { const next = /^[-*] /.test(line) ? "ul" : "ol"; if (kind && kind !== next) flush(); kind = next; list.push(match[2]); continue; }
    flush();
    if (!line.trim()) continue;
    output.push(/^#{1,3} /.test(line) ? `<h3>${inline(line.replace(/^#{1,3} /, ""))}</h3>` : `<p>${inline(line)}</p>`);
  }
  flush(); return output.join("");
}

// Native bridges and cache reads can ignore AbortSignal. Settle the UI deadline
// regardless and consume late rejections without displaying late answers.
export function awaitAssistantOperation(promise, signal) {
  if (signal?.aborted) { Promise.resolve(promise).catch(() => {}); return Promise.reject(new DOMException("请求已取消", "AbortError")); }
  return new Promise((resolve, reject) => {
    const cancel = () => { cleanup(); reject(new DOMException("请求已取消", "AbortError")); };
    const cleanup = () => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
