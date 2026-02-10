/**
 * Web tools for Neo coding assistant
 * Provides web fetching and search capabilities
 */
import { z } from 'zod';
import { defineTool } from '../tool';
import { GoogleGenAI } from '@google/genai';

const MAX_RESPONSE_SIZE = 100000; // 100KB
const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Convert HTML to plain text (basic implementation)
 */
function htmlToText(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)));
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract main content from HTML (basic heuristics)
 */
function extractMainContent(html: string): string {
  // Try to find main content areas
  const mainSelectors = [
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  
  for (const selector of mainSelectors) {
    const match = selector.exec(html);
    if (match && match[1]) {
      const content = htmlToText(match[1]);
      if (content.length > 100) {
        return content;
      }
    }
    selector.lastIndex = 0; // Reset regex
  }
  
  // Fall back to body content
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) {
    return htmlToText(bodyMatch[1]);
  }
  
  return htmlToText(html);
}

export const WebFetchTool = defineTool('web_fetch', {
  description: `Fetch content from a URL and return it as text.

Usage notes:
- Supports HTTP and HTTPS URLs
- HTML is converted to plain text
- Response is truncated to 100KB
- Has a 15 second timeout by default

Use this to:
- Fetch documentation pages
- Get content from APIs
- Read web articles`,
  parameters: z.object({
    url: z.string().describe('The URL to fetch'),
    timeout: z.coerce.number().optional().describe('Timeout in milliseconds (default: 15000)'),
    raw: z.coerce.boolean().optional().describe('Return raw content without HTML processing'),
  }),
  async execute(params, _ctx) {
    const { url, timeout = DEFAULT_TIMEOUT_MS, raw = false } = params;

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error(`Invalid URL: ${url}`);
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Neo/1.0 (AI Coding Assistant)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
      }

      // Get content type
      const contentType = response.headers.get('content-type') || '';
      const isHtml = contentType.includes('text/html');
      const isJson = contentType.includes('application/json');

      // Read response body
      let text = await response.text();

      // Truncate if too large
      if (text.length > MAX_RESPONSE_SIZE) {
        text = text.slice(0, MAX_RESPONSE_SIZE) + '\n\n(content truncated)';
      }

      // Process content
      let output: string;
      if (raw) {
        output = text;
      } else if (isJson) {
        try {
          const json = JSON.parse(text);
          output = JSON.stringify(json, null, 2);
        } catch {
          output = text;
        }
      } else if (isHtml) {
        output = extractMainContent(text);
      } else {
        output = text;
      }

      return {
        title: `Fetched: ${parsedUrl.hostname}${parsedUrl.pathname.slice(0, 30)}`,
        output,
        metadata: {
          url,
          status: response.status,
          contentType,
          size: text.length,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeout}ms`);
      }
      const error = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to fetch URL: ${error}`);
    }
  },
});

type SearchResult = { title: string; url: string; snippet: string };

const GEMINI_SEARCH_MODEL = 'gemini-2.0-flash-lite';

async function searchViaGemini(
  apiKey: string,
  query: string,
): Promise<SearchResult[]> {
  const client = new GoogleGenAI({ apiKey });

  const response = await client.models.generateContent({
    model: GEMINI_SEARCH_MODEL,
    contents: [{ role: 'user', parts: [{ text: query }] }],
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const candidate = response.candidates?.[0];
  if (!candidate) throw new Error('No response from Gemini');

  const results: SearchResult[] = [];
  const chunks = candidate.groundingMetadata?.groundingChunks || [];

  for (const chunk of chunks) {
    if (chunk.web) {
      results.push({
        title: chunk.web.title || chunk.web.domain || '',
        url: chunk.web.uri || '',
        snippet: '',
      });
    }
  }

  // Enrich snippets from groundingSupports if available
  const supports = candidate.groundingMetadata?.groundingSupports || [];
  for (const support of supports) {
    const text = support.segment?.text || '';
    if (!text) continue;
    for (const idx of support.groundingChunkIndices || []) {
      if (idx < results.length && !results[idx].snippet) {
        results[idx].snippet = text;
      }
    }
  }

  // If no grounding chunks but we got text, return as single result
  if (results.length === 0 && candidate.content?.parts) {
    const text = candidate.content.parts.map((p) => p.text || '').join('');
    if (text) {
      return [{ title: 'Web Search Results', url: '', snippet: text }];
    }
  }

  return results.slice(0, 10);
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const SEARCH_MODEL = 'google/gemini-2.5-flash-lite:online';

interface OpenRouterAnnotation {
  type: 'url_citation';
  url_citation: {
    url: string;
    title?: string;
    content?: string;
    start_index?: number;
    end_index?: number;
  };
}

interface OpenRouterSearchResponse {
  choices?: Array<{
    message?: {
      content?: string;
      annotations?: OpenRouterAnnotation[];
    };
  }>;
}

async function searchViaOpenRouter(
  apiKey: string,
  query: string,
): Promise<SearchResult[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://neo.local',
        'X-Title': 'Neo Coding Assistant',
      },
      body: JSON.stringify({
        model: SEARCH_MODEL,
        messages: [
          {
            role: 'user',
            content: `Search the web for: ${query}\n\nReturn a concise summary of the top results with source URLs.`,
          },
        ],
        plugins: [{ id: 'web', max_results: 10 }],
        max_tokens: 4096,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter ${response.status}: ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterSearchResponse;
    const choice = data.choices?.[0]?.message;
    if (!choice) throw new Error('No response from search model');

    const results: SearchResult[] = [];

    // Extract results from annotations (structured citations)
    if (choice.annotations && choice.annotations.length > 0) {
      for (const ann of choice.annotations) {
        if (ann.type === 'url_citation' && ann.url_citation) {
          results.push({
            title: ann.url_citation.title || ann.url_citation.url,
            url: ann.url_citation.url,
            snippet: ann.url_citation.content || '',
          });
        }
      }
    }

    // If we got annotations, return them as structured results + the summary
    if (results.length > 0) {
      // Deduplicate by URL
      const seen = new Set<string>();
      const deduped = results.filter((r) => {
        if (seen.has(r.url)) return false;
        seen.add(r.url);
        return true;
      });
      return deduped.slice(0, 10);
    }

    // Fallback: if no annotations, return the text content as a single result
    if (choice.content) {
      return [{ title: 'Web Search Results', url: '', snippet: choice.content }];
    }

    return [];
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// SearXNG fallback for when OpenRouter is unavailable
const SEARXNG_INSTANCES = [
  'https://paulgo.io',
  'https://priv.au',
  'https://opnxng.com',
  'https://etsi.me',
  'https://baresearch.org',
  'https://ooglester.com',
];

async function searchViaSearXNG(query: string): Promise<SearchResult[]> {
  const instances = [...SEARXNG_INSTANCES].sort(() => Math.random() - 0.5);
  const errors: string[] = [];

  for (const instance of instances) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const url = `${instance}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
      const response = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json, text/html' },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      // Try JSON
      if (contentType.includes('application/json') || body.trimStart().startsWith('{')) {
        const data = JSON.parse(body);
        const rawResults = (data.results || []) as Array<{ title?: string; url?: string; content?: string }>;
        const results = rawResults.slice(0, 10).map((r) => ({
          title: r.title || '',
          url: r.url || '',
          snippet: r.content ? htmlToText(r.content) : '',
        })).filter((r: SearchResult) => r.title && r.url);
        if (results.length > 0) return results;
      }

      // Fall through if no results from this instance
      errors.push(`${instance}: no results`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${instance}: ${msg}`);
    }
  }

  throw new Error(`SearXNG fallback failed:\n${errors.join('\n')}`);
}

export const WebSearchTool = defineTool('web_search', {
  description: `Search the web for information.

Usage notes:
- Returns up to 10 search results with titles, URLs, and snippets
- Useful for finding documentation, tutorials, and current information
- Supports site-specific searches`,
  parameters: z.object({
    query: z.string().describe('The search query'),
    site: z.string().optional().describe('Limit search to a specific site (e.g., "docs.python.org")'),
  }),
  async execute(params, _ctx) {
    const { query, site } = params;
    const fullQuery = site ? `site:${site} ${query}` : query;

    const ctx = _ctx as { apiKey?: string; provider?: string };

    // Primary for Gemini: use Google Search grounding (free, built-in)
    if (ctx.apiKey && ctx.provider === 'gemini') {
      try {
        const results = await searchViaGemini(ctx.apiKey, fullQuery);

        if (results.length === 0) {
          return {
            title: `Search: ${query}`,
            output: 'No results found. Try a different search query.',
            metadata: { query, resultCount: 0 },
          };
        }

        const output = results.map((r, i) => {
          const urlLine = r.url ? `\n   ${r.url}` : '';
          return `${i + 1}. ${r.title}${urlLine}\n   ${r.snippet}`;
        }).join('\n\n');

        return {
          title: `Search: ${query}`,
          output: `Found ${results.length} results:\n\n${output}`,
          metadata: { query, site, resultCount: results.length, source: 'gemini' },
        };
      } catch (err) {
        console.warn('Gemini grounding search failed, trying fallback:', err);
      }
    }

    // Primary for OpenRouter: use web search plugin (reliable, uses existing API key)
    if (ctx.apiKey && ctx.provider === 'openrouter') {
      try {
        const results = await searchViaOpenRouter(ctx.apiKey, fullQuery);

        if (results.length === 0) {
          return {
            title: `Search: ${query}`,
            output: 'No results found. Try a different search query.',
            metadata: { query, resultCount: 0 },
          };
        }

        const output = results.map((r, i) => {
          const urlLine = r.url ? `\n   ${r.url}` : '';
          return `${i + 1}. ${r.title}${urlLine}\n   ${r.snippet}`;
        }).join('\n\n');

        return {
          title: `Search: ${query}`,
          output: `Found ${results.length} results:\n\n${output}`,
          metadata: { query, site, resultCount: results.length, source: 'openrouter' },
        };
      } catch (err) {
        // OpenRouter failed, fall through to SearXNG
        console.warn('OpenRouter web search failed, trying SearXNG fallback:', err);
      }
    }

    // Fallback: SearXNG public instances
    try {
      const results = await searchViaSearXNG(fullQuery);

      if (results.length === 0) {
        return {
          title: `Search: ${query}`,
          output: 'No results found. Try a different search query.',
          metadata: { query, resultCount: 0 },
        };
      }

      const output = results.map((r, i) => {
        return `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`;
      }).join('\n\n');

      return {
        title: `Search: ${query}`,
        output: `Found ${results.length} results:\n\n${output}`,
        metadata: { query, site, resultCount: results.length, source: 'searxng' },
      };
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      throw new Error(`Web search failed: ${msg}`);
    }
  },
});
