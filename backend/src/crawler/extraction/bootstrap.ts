import { ExtractionOrchestrator } from './orchestrator';
import { DomExtractionStrategy } from './strategies/dom';

export function createDefaultExtractionOrchestrator(): ExtractionOrchestrator {
  const orchestrator = new ExtractionOrchestrator();
  orchestrator.register(new DomExtractionStrategy());
  orchestrator.setDefault('dom');
  return orchestrator;
}
