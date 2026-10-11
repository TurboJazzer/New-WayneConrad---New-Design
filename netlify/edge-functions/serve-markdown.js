// netlify/edge-functions/serve-markdown.js
//
// Serves Markdown instead of HTML when a request explicitly asks for it
// (Accept: text/markdown), so AI agents and crawlers that support this
// get a lighter, token-cheaper version of the same content instead of
// full page markup with nav, footer, and styling noise.
//
// TEST IT:
//   curl -H "Accept: text/markdown" https://wayneconrad.com/index.html
//   curl -H "Accept: text/markdown" https://wayneconrad.com/articles/hidden-friction-tax.html
//
// TEST LOCALLY:
//   netlify dev
//   curl -H "Accept: text/markdown" http://localhost:8888/index.html
//
// ADD OR REMOVE PATHS:
//   Registration lives in netlify.toml under [[edge_functions]], not in this
//   file. Add or remove a path entry there to change scope — this function
//   itself applies the same logic to whatever path it's registered against.

import TurndownService from "https://esm.sh/turndown@7";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

// Strip elements that add no reading content: scripts, styles, and the
// site chrome (nav, header, footer, aside/sidebars). Regex-based on
// purpose — Deno's edge runtime has no native DOMParser, and pulling in
// a full DOM polyfill just to strip a handful of known wrapper tags is
// more weight than this needs.
function stripNonContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "");
}

export default async (request, context) => {
  const acceptHeader = request.headers.get("accept") || "";

  // Pass through unchanged unless the request explicitly wants Markdown.
  if (!acceptHeader.toLowerCase().includes("text/markdown")) {
    return await context.next();
  }

  try {
    const originResponse = await context.next();
    const html = await originResponse.text();

    const contentOnly = stripNonContent(html);
    const markdown = turndown.turndown(contentOnly);

    // Rough token estimate: ~4 characters per token, a common heuristic
    // for English text. Not exact, close enough to be a useful signal.
    const estimatedTokens = Math.ceil(markdown.length / 4);

    return new Response(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "X-Markdown-Tokens": String(estimatedTokens),
        "Content-Signal": "ai-train=yes, search=yes, ai-input=yes",
      },
    });
  } catch (error) {
    // Any failure in fetch, stripping, or conversion falls back to the
    // normal HTML response rather than breaking the request.
    return await context.next();
  }
};
