#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Import Anastasis core modules
import { discoverJsFiles } from "anastasis/dist/core/discovery-orchestrator.js";
import { discoverEndpoints } from "anastasis/dist/core/endpoint-discovery.js";
import {
  parseEndpoints,
  parseEndpointsFromUrl,
  parseEndpointsFromUrls,
  extractParams,
  isTreeSitterAvailable,
} from "anastasis/dist/parsers/index.js";
import {
  discoverAndReconstruct,
} from "anastasis/dist/parsers/sourcemap-reconstructor.js";

const server = new McpServer({
  name: "anastasis",
  version: "1.0.0",
});

// ─── Tool 1: scan_domain ───────────────────────────────────────────────────────
// Full domain scan — the main use case. Combines JS discovery + parsing + API docs.

server.tool(
  "scan_domain",
  {
    domain: z.string().describe("Target domain to scan (e.g., example.com)"),
    mode: z.enum(["quick", "standard", "deep"]).default("standard").describe("Scan depth: quick (API docs only), standard (JS + API), deep (full params + schemas)"),
    concurrency: z.number().int().min(1).max(50).default(10).describe("Number of parallel requests"),
    include_subdomains: z.boolean().default(false).describe("Include subdomains in JS discovery"),
  },
  async ({ domain, mode, concurrency, include_subdomains }) => {
    const startTime = Date.now();
    const results: any = {
      domain,
      mode,
      treeSitterAvailable: isTreeSitterAvailable(),
      jsFiles: { count: 0, urls: [] as string[] },
      endpoints: [] as any[],
      apiDocs: [] as any[],
      paramSpecs: [] as any[],
      sources: {} as Record<string, number>,
      stats: {} as any,
    };

    try {
      // Phase 1: Discover JS files (skip for quick mode)
      if (mode !== "quick") {
        const discovery = await discoverJsFiles({
          domain,
          concurrency,
          includeSubdomains: include_subdomains,
        });

        results.jsFiles.count = discovery.totalUrls;
        results.jsFiles.urls = discovery.urls.map((u: any) => u.url);

        // Track sources
        for (const src of discovery.sources) {
          if (src.urls?.length > 0) {
            results.sources[src.source] = src.urls.length;
          }
        }

        // Phase 2: Parse JS files for endpoints
        if (discovery.totalUrls > 0) {
          const parseOpts: any = {
            extractParams: mode === "deep" || mode === "standard",
            buildSchemas: mode === "deep",
            reconstructSourceMaps: true,
          };

          const parseResult = await parseEndpointsFromUrls(
            results.jsFiles.urls,
            parseOpts,
            undefined,
            concurrency,
          );

          results.endpoints.push(
            ...parseResult.endpoints.map((ep: any) => ({
              path: ep.path,
              method: ep.method || "GET",
              source: ep.source || "ast",
              confidence: ep.confidence,
              queryParams: ep.queryParams,
              context: ep.context,
            }))
          );

          // Collect param specs
          if (parseResult.paramExtractionResult?.specs) {
            results.paramSpecs = parseResult.paramExtractionResult.specs.map((spec: any) => ({
              path: spec.path,
              method: spec.method,
              pathParams: spec.pathParams,
              queryParams: spec.queryParams,
              bodyParams: spec.bodyParams,
              cookieParams: spec.cookieParams,
              headers: spec.headers,
              auth: spec.auth,
              contentType: spec.contentType,
              confidence: spec.confidence,
            }));
          }

          results.stats = {
            regexFound: parseResult.stats?.regexFound || 0,
            astFound: parseResult.stats?.astFound || 0,
            sourceMapFound: parseResult.stats?.sourceMapFound || 0,
            totalParsed: parseResult.endpoints.length,
          };
        }
      }

      // Phase 3: Discover API documentation endpoints
      const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
      const apiResult = await discoverEndpoints({
        baseUrl,
        concurrency: Math.min(concurrency, 20),
        timeout: mode === "quick" ? 30000 : 60000,
      });

      results.apiDocs = apiResult.endpoints.map((ep: any) => ({
        path: ep.path,
        method: ep.method || "GET",
        source: ep.source,
        confidence: ep.confidence,
      }));

      // Merge API doc endpoints with JS-discovered endpoints (dedup by method:path)
      const seen = new Set(results.endpoints.map((e: any) => `${e.method}:${e.path}`));
      for (const ep of results.apiDocs) {
        const key = `${ep.method}:${ep.path}`;
        if (!seen.has(key)) {
          results.endpoints.push(ep);
          seen.add(key);
        }
      }

      // Summary
      results.summary = {
        totalEndpoints: results.endpoints.length,
        totalJsFiles: results.jsFiles.count,
        totalApiDocEndpoints: results.apiDocs.length,
        endpointsWithParams: results.paramSpecs.length,
        duration: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
        byMethod: results.endpoints.reduce((acc: any, ep: any) => {
          acc[ep.method] = (acc[ep.method] || 0) + 1;
          return acc;
        }, {}),
        bySource: results.endpoints.reduce((acc: any, ep: any) => {
          acc[ep.source || "unknown"] = (acc[ep.source || "unknown"] || 0) + 1;
          return acc;
        }, {}),
      };

      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({
          error: error.message,
          domain,
          mode,
          partial: results,
        }, null, 2) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 2: discover_js_files ─────────────────────────────────────────────────
// Just the discovery phase — find all JS files for a domain from 23+ passive sources.

server.tool(
  "discover_js_files",
  {
    domain: z.string().describe("Target domain (e.g., example.com)"),
    concurrency: z.number().int().min(1).max(50).default(10).describe("Parallel request limit"),
    include_subdomains: z.boolean().default(false).describe("Include subdomains"),
  },
  async ({ domain, concurrency, include_subdomains }) => {
    try {
      const result = await discoverJsFiles({
        domain,
        concurrency,
        includeSubdomains: include_subdomains,
      });

      const output = {
        domain,
        totalFiles: result.totalUrls,
        files: result.urls.map((u: any) => ({
          url: u.url,
          source: u.source,
        })),
        sourceSummary: result.sources
          .filter((s: any) => s.urls?.length > 0)
          .map((s: any) => ({
            source: s.source,
            found: s.urls.length,
            duration: s.duration ? `${(s.duration / 1000).toFixed(1)}s` : undefined,
          })),
        inlineScripts: result.inlineScripts?.length || 0,
        duration: `${(result.duration / 1000).toFixed(1)}s`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message, domain }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 3: parse_js_file ─────────────────────────────────────────────────────
// Parse a single JS file URL or raw content for endpoints.

server.tool(
  "parse_js_file",
  {
    url: z.string().optional().describe("URL of the JavaScript file to parse"),
    content: z.string().optional().describe("Raw JavaScript content to parse (instead of URL)"),
    extract_params: z.boolean().default(true).describe("Extract parameter types and constraints"),
    build_schemas: z.boolean().default(false).describe("Build nested body schemas"),
  },
  async ({ url, content, extract_params, build_schemas }) => {
    if (!url && !content) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: "Provide either url or content" }) }],
        isError: true,
      };
    }

    try {
      let result: any;

      if (url) {
        result = await parseEndpointsFromUrl(url, {
          extractParams: extract_params,
          buildSchemas: build_schemas,
          reconstructSourceMaps: true,
        });
      } else {
        result = parseEndpoints(content!, {
          extractParams: extract_params,
          buildSchemas: build_schemas,
        });
      }

      const output: any = {
        endpoints: result.endpoints.map((ep: any) => ({
          path: ep.path,
          method: ep.method || "GET",
          source: ep.source || "ast",
          confidence: ep.confidence,
          queryParams: ep.queryParams,
          context: ep.context,
        })),
        stats: {
          total: result.endpoints.length,
          regexFound: result.stats?.regexFound || 0,
          astFound: result.stats?.astFound || 0,
          sourceMapFound: result.stats?.sourceMapFound || 0,
          treeSitterAvailable: isTreeSitterAvailable(),
        },
      };

      if (result.paramExtractionResult?.specs) {
        output.paramSpecs = result.paramExtractionResult.specs.map((spec: any) => ({
          path: spec.path,
          method: spec.method,
          pathParams: spec.pathParams,
          queryParams: spec.queryParams,
          bodyParams: spec.bodyParams,
          headers: spec.headers,
          auth: spec.auth,
          confidence: spec.confidence,
        }));
      }

      if (result.discoveredChunks?.length) {
        output.discoveredChunks = result.discoveredChunks;
      }

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message, url }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 4: check_api_docs ────────────────────────────────────────────────────
// Probe a domain for API documentation (Swagger, GraphQL, WADL, WSDL, etc.)

server.tool(
  "check_api_docs",
  {
    domain: z.string().describe("Target domain (e.g., example.com)"),
    sources: z.array(z.string()).optional().describe("Specific sources to check: swagger, graphql, wadl, wsdl, well-known, api-probe, sitemap"),
    timeout: z.number().int().default(60000).describe("Timeout in ms per source"),
  },
  async ({ domain, sources, timeout }) => {
    try {
      const baseUrl = domain.startsWith("http") ? domain : `https://${domain}`;
      const result = await discoverEndpoints({
        baseUrl,
        sources: sources as any,
        timeout,
        concurrency: 20,
      });

      const output = {
        domain,
        totalEndpoints: result.endpoints.length,
        endpoints: result.endpoints.map((ep: any) => ({
          path: ep.path,
          method: ep.method || "GET",
          source: ep.source,
          confidence: ep.confidence,
          params: ep.params,
        })),
        jsFilesFromManifests: result.jsFiles?.map((f: any) => f.url) || [],
        sourceResults: result.sources?.map((s: any) => ({
          source: s.source,
          count: s.count,
          duration: s.duration ? `${(s.duration / 1000).toFixed(1)}s` : undefined,
          error: s.error,
        })) || [],
        duration: `${(result.totalDuration / 1000).toFixed(1)}s`,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message, domain }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 5: extract_sourcemap ─────────────────────────────────────────────────
// Recover original source files from a JS file's sourcemap.

server.tool(
  "extract_sourcemap",
  {
    url: z.string().describe("URL of the JavaScript file to check for sourcemaps"),
  },
  async ({ url }) => {
    try {
      // Fetch the JS content first
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          Accept: "*/*",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${url}`);
      }

      const content = await response.text();
      const result = await discoverAndReconstruct(url, content);

      if (!result) {
        return {
          content: [{ type: "text", text: JSON.stringify({
            url,
            sourcemapFound: false,
            message: "No sourcemap found for this file",
          }) }],
        };
      }

      const output = {
        url,
        sourcemapFound: true,
        sourcemapUrl: result.sourcemapUrl,
        sourceFiles: result.sources?.map((s: any) => ({
          path: s.path,
          language: s.language,
          size: s.content?.length || 0,
          preview: s.content?.slice(0, 500),
        })) || [],
        totalFiles: result.sources?.length || 0,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message, url }) }],
        isError: true,
      };
    }
  }
);

// ─── Tool 6: parse_multiple_js ─────────────────────────────────────────────────
// Parse multiple JS file URLs in parallel.

server.tool(
  "parse_multiple_js",
  {
    urls: z.array(z.string()).describe("Array of JS file URLs to parse"),
    extract_params: z.boolean().default(true).describe("Extract parameter types"),
    concurrency: z.number().int().min(1).max(50).default(10).describe("Parallel request limit"),
  },
  async ({ urls, extract_params, concurrency }) => {
    try {
      const result = await parseEndpointsFromUrls(
        urls,
        {
          extractParams: extract_params,
          reconstructSourceMaps: true,
        },
        undefined,
        concurrency,
      );

      const output: any = {
        filesProcessed: urls.length,
        totalEndpoints: result.endpoints.length,
        endpoints: result.endpoints.map((ep: any) => ({
          path: ep.path,
          method: ep.method || "GET",
          source: ep.source || "ast",
          confidence: ep.confidence,
        })),
        stats: {
          regexFound: result.stats?.regexFound || 0,
          astFound: result.stats?.astFound || 0,
          sourceMapFound: result.stats?.sourceMapFound || 0,
          byMethod: result.stats?.byMethod || {},
        },
      };

      if (result.paramExtractionResult?.specs) {
        output.paramSpecs = result.paramExtractionResult.specs.map((spec: any) => ({
          path: spec.path,
          method: spec.method,
          pathParams: spec.pathParams,
          queryParams: spec.queryParams,
          bodyParams: spec.bodyParams,
          headers: spec.headers,
          auth: spec.auth,
        }));
      }

      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: "text", text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  }
);

// ─── Start server ──────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
