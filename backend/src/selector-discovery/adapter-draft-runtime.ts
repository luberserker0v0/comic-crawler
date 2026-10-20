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
  const hostRequire = createRequire(absoluteSourcePath);
  const loadLocalModule = createLocalModuleLoader(hostRequire);
  return instantiateDraftModule(source, absoluteSourcePath,
    createProjectRequire(absoluteSourcePath, hostRequire, loadLocalModule));
}

function createLocalModuleLoader(hostRequire: NodeJS.Require): (path: string) => unknown {
  const cache = new Map<string, Record<string, unknown>>();
  const loader = (path: string) => loadLocalModule(path, hostRequire, cache, loader);
  return loader;
}

function loadLocalModule(requestedPath: string, hostRequire: NodeJS.Require,
  cache: Map<string, Record<string, unknown>>, loader: (path: string) => unknown): unknown {
  const path = resolveLocalModulePath(requestedPath);
  if (isAdapterBasePath(path)) return adapterBaseExports();
  if (extname(path) === '.json' || extname(path) === '.js') return hostRequire(path);
  const cached = cache.get(path);
  if (cached) return cached;
  const exports: Record<string, unknown> = {};
  cache.set(path, exports);
  const loaded = evaluateTypeScriptModule(readFileSync(path, 'utf-8'), path,
    createProjectRequire(path, hostRequire, loader), exports);
  cache.set(path, loaded);
  return loaded;
}

function adapterBaseExports() {
  return { AdapterBase, CommonCapability, VerificationCapability, MetadataCapability,
    ChapterImagesCapability };
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
  const output = transpileDraft(source, fileName);
  ensureNoSyntaxErrors(output.diagnostics);
  const sandbox = createSandbox(fileName, draftRequire, initialExports);
  vm.runInNewContext(output.outputText, sandbox,
    { filename: fileName.replace(/\.ts$/, '.js'), timeout: 1000 });
  return { ...sandbox.exports, ...(sandbox.module.exports as Record<string, unknown>) };
}

function transpileDraft(source: string, fileName: string) {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
      esModuleInterop: true, strict: true,
    },
    fileName, reportDiagnostics: true,
  });
}

function ensureNoSyntaxErrors(diagnostics: readonly ts.Diagnostic[] | undefined): void {
  const errors = (diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(`Adapter draft TypeScript syntax error: ${errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ')}`);
}

function createSandbox(fileName: string, draftRequire: (id: string) => unknown,
  exports: Record<string, unknown>) {
  return { exports, module: { exports }, require: draftRequire, URL, console,
    __filename: fileName, __dirname: dirname(fileName) };
}

function createDraftRequire(): (id: string) => unknown {
  return (id: string): unknown => {
    if (id === '../../base' || id.endsWith('/base')) {
      return adapterBaseExports();
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
