# Anastasis MCP Server

MCP server for JavaScript endpoint discovery and attack surface mapping. Gives Claude (and any MCP client) native tools to discover API endpoints from JavaScript files, probe API documentation, extract parameters, and reconstruct sourcemaps.

Powered by the [Anastasis](https://github.com/0xazanul/Anastasis) engine.

## Install

### Claude Code (recommended)

```bash
claude mcp add anastasis -- npx -y anastasis-mcp-server
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "anastasis": {
      "command": "npx",
      "args": ["-y", "anastasis-mcp-server"]
    }
  }
}
```

### Any MCP Client

```bash
npx -y anastasis-mcp-server
```

Communicates over stdio using the [Model Context Protocol](https://modelcontextprotocol.io).

## Tools

### `scan_domain`

Full domain scan. Discovers JS files from 23+ passive sources, parses them for API endpoints, probes API documentation, extracts parameters.

```
Input:
  domain: "example.com"
  mode: "quick" | "standard" | "deep"  (default: standard)
  concurrency: 1-50  (default: 10)
  include_subdomains: true | false  (default: false)

Output:
  endpoints[], paramSpecs[], jsFiles, apiDocs, sources, stats, summary
```

**Modes:**
- **quick** — API documentation probe only (~30s). Checks Swagger, GraphQL, WADL, WSDL.
- **standard** — JS discovery + AST parsing + API docs (~2-3 min). Default.
- **deep** — Full parameter extraction with nested body schemas (~3-5 min).

### `discover_js_files`

Find all JavaScript files for a domain from 23+ passive sources (Wayback Machine, OTX, URLScan, GAU, CommonCrawl, VirusTotal, HTML parsing, and more).

```
Input:
  domain: "example.com"
  concurrency: 1-50  (default: 10)

Output:
  files[{url, source}], sourceSummary[], inlineScripts count
```

### `parse_js_file`

Parse a single JavaScript file for API endpoints. Provide a URL or raw content.

```
Input:
  url: "https://example.com/app.js"  (or)
  content: "fetch('/api/users')..."
  extract_params: true | false  (default: true)
  build_schemas: true | false  (default: false)

Output:
  endpoints[], paramSpecs[], stats, discoveredChunks[]
```

### `parse_multiple_js`

Parse multiple JavaScript files in parallel.

```
Input:
  urls: ["https://example.com/a.js", "https://example.com/b.js"]
  extract_params: true  (default: true)
  concurrency: 1-50  (default: 10)

Output:
  endpoints[], paramSpecs[], stats
```

### `check_api_docs`

Probe a domain for API documentation — Swagger/OpenAPI, GraphQL introspection, WADL, WSDL, well-known endpoints, API version detection.

```
Input:
  domain: "example.com"
  sources: ["swagger", "graphql", "wadl", "wsdl", "well-known", "api-probe", "sitemap"]
  timeout: 60000  (ms)

Output:
  endpoints[], jsFilesFromManifests[], sourceResults[]
```

### `extract_sourcemap`

Check a JavaScript file for sourcemaps and recover original source files.

```
Input:
  url: "https://example.com/app.js"

Output:
  sourcemapFound, sourcemapUrl, sourceFiles[{path, language, size, preview}]
```

## How It Works

```
Claude: "scan example.com"
    │
    ├── calls scan_domain("example.com", mode="standard")
    │       │
    │       ├── Phase 1: discover_js_files
    │       │   └── 23+ passive sources (Wayback, OTX, URLScan, GAU, ...)
    │       │
    │       ├── Phase 2: Parse JS files
    │       │   ├── Tree-Sitter AST parsing (primary)
    │       │   ├── Acorn fallback (if tree-sitter unavailable)
    │       │   ├── Regex extraction (supplementary)
    │       │   ├── Sourcemap reconstruction
    │       │   └── Webpack chunk following
    │       │
    │       └── Phase 3: API documentation probing
    │           └── Swagger, GraphQL, WADL, WSDL, well-known
    │
    └── Claude analyzes results
        ├── Categorizes endpoints by security relevance
        ├── Identifies IDOR candidates, auth gaps, admin endpoints
        ├── Suggests attack strategies per parameter type
        └── Produces prioritized attack surface report
```

The MCP server imports the [Anastasis engine](https://github.com/0xazanul/Anastasis) directly — no CLI wrapping, no stdout parsing. Claude gets structured JSON from native tool calls.

## Requirements

- **Node.js 18-23** ([nodejs.org](https://nodejs.org))
- **Internet access** for passive source queries

Tree-sitter (C++ native AST parser) compiles automatically during install on most systems. If compilation fails, Anastasis falls back to acorn/acorn-loose with identical functionality.

## Example Output

```json
{
  "summary": {
    "totalEndpoints": 1569,
    "totalJsFiles": 6309,
    "totalApiDocEndpoints": 1067,
    "endpointsWithParams": 227,
    "duration": "195.1s",
    "byMethod": { "GET": 1272, "POST": 53, "PATCH": 20, "DELETE": 24 },
    "bySource": { "ast": 293, "regex": 208, "graphql": 3 }
  }
}
```

## For Bug Bounty Hunters

After `scan_domain` returns, ask Claude:

- "Which endpoints are most likely to have IDOR?"
- "Show me admin endpoints without authentication"
- "Which parameters are SSRF candidates?"
- "Analyze the auth patterns for inconsistencies"
- "What standalone findings can I report right now?"

Claude combines Anastasis's raw data with security analysis to produce actionable results.

## Development

```bash
git clone https://github.com/0xazanul/anastasis-mcp-server.git
cd anastasis-mcp-server
npm install
npm run build
node dist/index.js  # starts MCP server on stdio
```

## License

MIT

## Credits

- [Anastasis Engine](https://github.com/0xazanul/Anastasis) by [@0xazanul](https://github.com/0xazanul)
- [Model Context Protocol](https://modelcontextprotocol.io) by [Anthropic](https://anthropic.com)
