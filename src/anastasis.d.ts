declare module "anastasis/dist/core/discovery-orchestrator.js" {
  export function discoverJsFiles(options: {
    domain: string;
    targetUrl?: string;
    includeSubdomains?: boolean;
    concurrency?: number;
    sources?: string[];
    useBrowserCrawler?: boolean;
  }): Promise<{
    domain: string;
    totalUrls: number;
    urls: Array<{ url: string; source: string; foundAt: string }>;
    sources: Array<{ source: string; urls: string[]; error?: string; duration?: number }>;
    inlineScripts?: Array<{ content: string; url: string }>;
    duration: number;
  }>;

  export function discoverJsFilesWithProgress(
    options: any,
    onSourceStart?: (source: string) => void,
    onSourceComplete?: (source: string, result: any) => void
  ): Promise<any>;
}

declare module "anastasis/dist/core/endpoint-discovery.js" {
  export function discoverEndpoints(options: {
    baseUrl: string;
    sources?: string[];
    timeout?: number;
    concurrency?: number;
  }): Promise<{
    endpoints: Array<{
      path: string;
      method?: string;
      source: string;
      confidence?: number;
      params?: any;
    }>;
    jsFiles?: Array<{ url: string }>;
    sources?: Array<{ source: string; count: number; duration?: number; error?: string }>;
    totalDuration: number;
  }>;
}

declare module "anastasis/dist/parsers/index.js" {
  export function parseEndpoints(content: string, options?: {
    extractParams?: boolean;
    buildSchemas?: boolean;
    includeQueryParams?: boolean;
    minConfidence?: number;
    deduplicatePaths?: boolean;
    extractMethods?: boolean;
    preprocess?: boolean;
    useFrameworkParsers?: boolean;
    reconstructSourceMaps?: boolean;
  }): {
    endpoints: Array<{
      path: string;
      method: string;
      source?: string;
      confidence: number;
      queryParams?: string[];
      context?: string;
      headers?: any;
    }>;
    tree: any;
    stats: {
      regexFound: number;
      astFound: number;
      sourceMapFound?: number;
      totalParsed?: number;
    };
    discoveredChunks?: any[];
    extractedContext?: any;
    paramExtractionResult?: {
      specs: Array<{
        path: string;
        method: string;
        pathParams: any[];
        queryParams: any[];
        bodyParams: any[];
        cookieParams?: any[];
        headers?: any[];
        auth?: any;
        contentType?: string;
        confidence?: number;
      }>;
    };
  };

  export function parseEndpointsFromUrl(
    url: string,
    options?: any,
    onSourceFetched?: (url: string, content: string) => void
  ): Promise<ReturnType<typeof parseEndpoints>>;

  export function parseEndpointsFromUrls(
    urls: string[],
    options?: any,
    onProgress?: (url: string, result: any) => void,
    concurrency?: number,
    onSourceFetched?: (url: string, content: string) => void
  ): Promise<{
    endpoints: Array<any>;
    stats: {
      regexFound: number;
      astFound: number;
      sourceMapFound?: number;
      byMethod?: Record<string, number>;
    };
    paramExtractionResult?: {
      specs: Array<any>;
    };
  }>;

  export function extractParams(endpoints: any[], options?: any): any;
  export function isTreeSitterAvailable(): boolean;
}

declare module "anastasis/dist/parsers/sourcemap-reconstructor.js" {
  export function discoverAndReconstruct(url: string, content: string): Promise<{
    sourcemapUrl?: string;
    sources?: Array<{
      path: string;
      content?: string;
      language?: string;
    }>;
  } | null>;
}
