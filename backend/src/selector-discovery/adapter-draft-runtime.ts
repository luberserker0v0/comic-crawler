import * as ts from 'typescript';
import vm from 'node:vm';
import type { IComicAdapter } from '@comiccrawler/shared';
import {
  AdapterBase,
  ChapterImagesCapability,
  CommonCapability,
  MetadataCapability,
  VerificationCapability,
} from '../adapter/base';

export function instantiateAdapterImplementationDraft(source: string): IComicAdapter {
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
    fileName: 'adapter-implementation.ts',
    reportDiagnostics: true,
  });

  const syntaxErrors = (output.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  if (syntaxErrors.length > 0) {
    throw new Error(`Adapter draft TypeScript syntax error: ${syntaxErrors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('; ')}`);
  }

  const sandbox = {
    exports: {} as Record<string, unknown>,
    module: { exports: {} as Record<string, unknown> },
    require: createDraftRequire(),
    URL,
    console,
  };
  sandbox.module.exports = sandbox.exports;

  vm.runInNewContext(output.outputText, sandbox, {
    filename: 'adapter-implementation.js',
    timeout: 1000,
  });

  const exported = {
    ...sandbox.exports,
    ...(sandbox.module.exports as Record<string, unknown>),
  };
  const AdapterClass = Object.values(exported).find((value): value is new () => IComicAdapter =>
    typeof value === 'function' &&
    value.prototype instanceof AdapterBase
  );
  if (!AdapterClass) {
    throw new Error('Adapter draft did not export an AdapterBase subclass.');
  }

  return new AdapterClass();
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
