/**
 * Web tools for Neo coding assistant
 * Provides web fetching and search capabilities
 */
import { z } from 'zod';
import { defineTool } from '../tool';

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

export const WebSearchTool = defineTool('web_search', {
  description: `Search the web for information.

Usage notes:
- Returns summarized search results
- Useful for finding documentation, tutorials, etc.
- Limited to text-based queries

Note: This tool simulates search by fetching from known documentation sites.
For full web search, integrate with a search API.`,
  parameters: z.object({
    query: z.string().describe('The search query'),
    site: z.string().optional().describe('Limit search to a specific site (e.g., "docs.python.org")'),
  }),
  async execute(params, _ctx) {
    const { query, site } = params;

    // Build search URL - using DuckDuckGo HTML interface
    let searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    if (site) {
      searchUrl = `https://html.duckduckgo.com/html/?q=site:${site}+${encodeURIComponent(query)}`;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetch(searchUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Neo/1.0 (AI Coding Assistant)',
          'Accept': 'text/html',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`);
      }

      const html = await response.text();

      // Extract search results from DuckDuckGo HTML
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      
      // Pattern for DuckDuckGo result links
      const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
      const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([^<]*)/gi;

      let match;
      while ((match = resultPattern.exec(html)) !== null && results.length < 10) {
        const url = match[1];
        const title = match[2].trim();
        
        // Find corresponding snippet
        const snippetMatch = snippetPattern.exec(html);
        const snippet = snippetMatch ? htmlToText(snippetMatch[1]) : '';

        if (url && title) {
          results.push({ title, url, snippet });
        }
      }

      if (results.length === 0) {
        return {
          title: `Search: ${query}`,
          output: 'No results found. Try a different search query.',
          metadata: { query, resultCount: 0 },
        };
      }

      // Format results
      const output = results.map((r, i) => {
        return `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`;
      }).join('\n\n');

      return {
        title: `Search: ${query}`,
        output: `Found ${results.length} results:\n\n${output}`,
        metadata: {
          query,
          site,
          resultCount: results.length,
        },
      };
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error(`Search timed out`);
      }
      const error = err instanceof Error ? err.message : String(err);
      throw new Error(`Search failed: ${error}`);
    }
  },
});
