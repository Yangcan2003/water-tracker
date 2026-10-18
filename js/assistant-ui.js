import MarkdownIt from "markdown-it";
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });
// A model answer must never load remote tracking images or execute raw HTML.
markdown.renderer.rules.image = (tokens, index) => markdown.utils.escapeHtml(tokens[index].content || "图片");
const linkOpen = markdown.renderer.rules.link_open || ((tokens, index, options, env, renderer) => renderer.renderToken(tokens, index, options));
markdown.renderer.rules.link_open = (tokens, index, options, env, renderer) => {
  tokens[index].attrSet("rel", "noopener noreferrer");
  tokens[index].attrSet("target", "_blank");
  return linkOpen(tokens, index, options, env, renderer);
};
markdown.renderer.rules.table_open = () => '<div class="assistant-table-scroll" role="region" aria-label="回答中的表格" tabindex="0"><table>';
markdown.renderer.rules.table_close = () => '</table></div>';

export function formatAssistantText(value) {
  // Some old answers separate every table row with a blank line. Repair only
  // adjacent pipe rows; keep ordinary paragraph boundaries intact.
  const source = String(value).replace(/(\|[^\n]*\|)[\t ]*\n[\t ]*\n(?=[\t ]*\|[^\n]*\|)/g, "$1\n");
  return markdown.render(source);
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
