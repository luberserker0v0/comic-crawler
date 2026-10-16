import * as ts from 'typescript';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import type { IComicAdapter } from '@comiccrawler/shared';
import {
  AdapterBase,
  ChapterImagesCapability,
  CommonCapability,
  MetadataCapability,
  VerificationCapability,
} from '../adapter/base';

export function instantiateAdapterImplementationDraft(source: string): IComicAdapter {
  return instantiateDraftModule(source, 'adapter-implementation.ts', createDraftRequire());
}

export function instantiateProjectAdapterDraft(source: string, sourcePath: string): IComicAdapter {
  const absoluteSourcePath = resolve(sourcePath);
  const moduleCache = new Map<string, Record<string, unknown>>();
  const hostRequire = createRequire(absoluteSourcePath);
  const loadLocalModule = (requestedPath: string): unknown => {
    const resolvedPath = resolveLocalModulePath(requestedPath);
    if (isAdapterBasePath(resolvedPath)) {
      return {
        AdapterBase,
        CommonCapability,
        VerificationCapability,
        MetadataCapability,
        ChapterImagesCapability,
      };
    }
    if (extname(resolvedPath) === '.json') return hostRequire(resolvedPath);
    if (extname(resolvedPath) === '.js') return hostRequire(resolvedPath);
    const cached = moduleCache.get(resolvedPath);
    if (cached) return cached;
    const exports: Record<string, unknown> = {};
    moduleCache.set(resolvedPath, exports);
    const loaded = evaluateTypeScriptModule(
      readFileSync(resolvedPath, 'utf-8'),
      resolvedPath,
      createProjectRequire(resolvedPath, hostRequire, loadLocalModule),
      exports
    );
    moduleCache.set(resolvedPath, loaded);
    return loaded;
  };
  return instantiateDraftModule(
    source,
    absoluteSourcePath,
    createProjectRequire(absoluteSourcePath, hostRequire, loadLocalModule)
  );
}

function instantiateDraftModule(source: string, fileName: string, draftRequire: (id: string) => unknown): IComicAdapter {
  const exported = evaluateTypeScriptModule(source, fileName, draftRequire);
  const AdapterClass = Object.values(exported).find((value): value is new () => IComicAdapter =>
    typeof value === 'function' &&
    value.prototype instanceof AdapterBase
  );
  if (!AdapterClass) {
    throw new Error('Adapter draft did not export an AdapterBase subclass.');
  }

  return new AdapterClass();
}

function evaluateTypeScriptModule(
  source: string,
  fileName: string,
  draftRequire: (id: string) => unknown,
  initialExports: Record<string, unknown> = {}
): Record<string, unknown> {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
    fileName,
    reportDiagnostics: true,
  });

  const syntaxErrors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxErrors.length > 0) {
    throw new Error(`Adapter draft TypeScript syntax error: ${syntaxErrors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ')}`);
  }

  const sandbox = {
    exports: initialExports,
    module: { exports: initialExports },
    require: draftRequire,
    URL,
    console,
    __filename: fileName,
    __dirname: dirname(fileName),
  };

  vm.runInNewContext(output.outputText, sandbox, {
    filename: fileName.replace(/\.ts$/, '.js'),
    timeout: 1000,
  });

  return {
    ...sandbox.exports,
    ...(sandbox.module.exports as Record<string, unknown>),
  };
}

function createDraftRequire(): (id: string) => unknown {
  return (id: string): unknown => {
    if (id === '../../base' || id.endsWith('/base')) {
      return {
        AdapterBase,
        CommonCapability,
        VerificationCapability,
        MetadataCapability,
        ChapterImagesCapability,
      };
    }
    if (id === '@comiccrawler/shared') {
      return {};
    }
    throw new Error(`Adapter draft import "${id}" is not allowed.`);
  };
}

function createProjectRequire(
  importerPath: string,
  hostRequire: NodeJS.Require,
  loadLocalModule: (path: string) => unknown
): (id: string) => unknown {
  return (id: string): unknown => {
    if (id.startsWith('.')) return loadLocalModule(resolve(dirname(importerPath), id));
    return hostRequire(id);
  };
}

function resolveLocalModulePath(requestedPath: string): string {
  const candidates = [
    requestedPath,
    `${requestedPath}.ts`,
    `${requestedPath}.js`,
    `${requestedPath}.json`,
    resolve(requestedPath, 'index.ts'),
    resolve(requestedPath, 'index.js'),
  ];
  const sourceCandidate = candidates.find((candidate) => existsSync(candidate));
  if (sourceCandidate) return sourceCandidate;

  const distPath = requestedPath.replace(/([\\/])src([\\/])/, '$1dist$2');
  const distCandidates = [distPath, `${distPath}.js`, resolve(distPath, 'index.js')];
  const distCandidate = distCandidates.find((candidate) => existsSync(candidate));
  if (distCandidate) return distCandidate;
  throw new Error(`Adapter draft import could not be resolved: ${requestedPath}`);
}

function isAdapterBasePath(path: string): boolean {
  return /[\\/]adapter[\\/]base\.(?:ts|js)$/i.test(path);
}
