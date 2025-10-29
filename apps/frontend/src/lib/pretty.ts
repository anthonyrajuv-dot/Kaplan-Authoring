import prettier from "prettier/standalone";
import parserHtml from "prettier/plugins/html.js";
import parserBabel from "prettier/plugins/babel.js";

export async function formatClient(text: string, lang: 'html'|'json'): Promise<string> {
  if (lang === 'html') {
    return await prettier.format(text, { parser: 'html', plugins: [parserHtml] })
  }
  // json
  return await prettier.format(text, { parser: 'json', plugins: [parserBabel] })
}
