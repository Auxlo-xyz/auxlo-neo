// Telegram MarkdownV2 format converter
// Ported from auxloclaw's src/channels/markdown.rs

const MARKDOWN_V2_SPECIALS = new Set(['_','*','[',']','(',')','~','`','>','#','+','-','=','|','{','}','.','!']);

export function markdownToTelegram(text: string): string {
  const converted = convertInner(text);
  return markersAreBalanced(converted) ? converted : escapeMarkdownV2(text);
}

function markersAreBalanced(text: string): boolean {
  for (const marker of ['_', '*', '~'] as const) {
    let count = 0;
    let i = 0;
    while (i < text.length) {
      if (text[i] === '\\' && i + 1 < text.length) { i += 2; continue; }
      if (text[i] === '`' && text[i+1] === '`' && text[i+2] === '`') {
        i += 3;
        while (i + 2 < text.length && !(text[i] === '`' && text[i+1] === '`' && text[i+2] === '`')) i++;
        if (i + 2 < text.length) i += 3;
        continue;
      }
      if (text[i] === '`') {
        i++;
        while (i < text.length && text[i] !== '`') i++;
        if (i < text.length) i++;
        continue;
      }
      if (text[i] === marker) count++;
      i++;
    }
    if (count % 2 !== 0) return false;
  }
  return true;
}

function convertInner(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    // Triple backtick code blocks
    if (rest.startsWith('```')) {
      const close = rest.indexOf('```', 3);
      if (close !== -1) {
        const inner = rest.slice(3, close);
        out += '`'.repeat(3) + escapeCode(inner) + '`'.repeat(3);
        i += close + 3;
        continue;
      }
    }

    // Inline code
    if (rest[0] === '`') {
      const close = rest.indexOf('`', 1);
      if (close !== -1) {
        out += '`' + escapeCode(rest.slice(1, close)) + '`';
        i += close + 1;
        continue;
      }
    }

    // Bold **text**
    if (rest.startsWith('**')) {
      const close = rest.indexOf('**', 2);
      if (close !== -1) {
        const inner = rest.slice(2, close);
        out += '*' + convertInner(inner) + '*';
        i += close + 2;
        continue;
      }
    }

    // Italic *text*
    if (rest[0] === '*' && !rest.startsWith('**')) {
      const close = rest.indexOf('*', 1);
      if (close !== -1) {
        const inner = rest.slice(1, close);
        if (inner.trim()) {
          out += '_' + convertInner(inner) + '_';
          i += close + 1;
          continue;
        }
      }
    }

    // Italic _text_
    if (rest[0] === '_' && !rest.startsWith('__')) {
      const close = rest.indexOf('_', 1);
      if (close !== -1) {
        const inner = rest.slice(1, close);
        if (inner.trim()) {
          out += '_' + convertInner(inner) + '_';
          i += close + 1;
          continue;
        }
      }
    }

    // Strikethrough ~~text~~
    if (rest.startsWith('~~')) {
      const close = rest.indexOf('~~', 2);
      if (close !== -1) {
        const inner = rest.slice(2, close);
        out += '~' + convertInner(inner) + '~';
        i += close + 2;
        continue;
      }
    }

    // Link [text](url)
    if (rest[0] === '[') {
      const textEnd = rest.indexOf(']');
      if (textEnd !== -1 && rest[textEnd + 1] === '(') {
        const urlEnd = rest.indexOf(')', textEnd + 2);
        if (urlEnd !== -1) {
          const linkText = rest.slice(1, textEnd);
          const linkUrl = rest.slice(textEnd + 2, urlEnd);
          out += '[' + escapeMarkdownV2(linkText) + '](' + escapeUrl(linkUrl) + ')';
          i += urlEnd + 1;
          continue;
        }
      }
    }

    // Regular char - escape if needed
    const ch = text[i];
    if (MARKDOWN_V2_SPECIALS.has(ch)) {
      out += '\\';
    }
    out += ch;
    i++;
  }
  return out;
}

function escapeMarkdownV2(text: string): string {
  let out = '';
  for (const ch of text) {
    if (MARKDOWN_V2_SPECIALS.has(ch)) out += '\\';
    out += ch;
  }
  return out;
}

function escapeCode(text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '`') out += '\\`';
    else if (ch === '\\') out += '\\\\';
    else out += ch;
  }
  return out;
}

function escapeUrl(url: string): string {
  let out = '';
  for (const ch of url) {
    if (ch === ')') out += '\\)';
    else if (ch === '\\') out += '\\\\';
    else out += ch;
  }
  return out;
}
