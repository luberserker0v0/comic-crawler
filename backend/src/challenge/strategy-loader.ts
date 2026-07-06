import vm from 'node:vm';
import ts from 'typescript';
import type { ChallengeStrategyModule } from './types';
import { validateChallengeStrategyModule, validateChallengeStrategySource } from './strategy-validator';

export function loadChallengeStrategyFromSource(source: string): ChallengeStrategyModule {
  const sourceValidation = validateChallengeStrategySource(source);
  if (!sourceValidation.valid) {
    throw new Error(`Invalid challenge strategy source: ${sourceValidation.errors.join(' ')}`);
  }

  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: false,
    },
  }).outputText;

  const sandbox: { exports: Record<string, unknown>; module: { exports: Record<string, unknown> } } = {
    exports: {},
    module: { exports: {} },
  };
  sandbox.module.exports = sandbox.exports;
  const context = vm.createContext(sandbox, {
    name: 'challenge-strategy',
    codeGeneration: { strings: false, wasm: false },
  });
  new vm.Script(transpiled, { filename: 'challenge-strategy-candidate.js' }).runInContext(context, {
    timeout: 1000,
  });

  const exported = sandbox.module.exports.strategy ?? sandbox.exports.strategy;
  const moduleValidation = validateChallengeStrategyModule(exported);
  if (!moduleValidation.valid) {
    throw new Error(`Invalid challenge strategy module: ${moduleValidation.errors.join(' ')}`);
  }

  return exported as ChallengeStrategyModule;
}
