export { ExtractionOrchestrator } from './orchestrator';
export { createDefaultExtractionOrchestrator } from './bootstrap';
export { DomExtractionStrategy } from './strategies/dom';
export { ApiInterceptionStrategy } from './strategies/api';
export { EmbeddedJsonStrategy } from './strategies/json';
export { WebSocketExtractionStrategy } from './strategies/websocket';
export type {
  IExtractionStrategy,
  ExtractionContext,
  ExtractionResult,
  SelectorConfig,
} from './types';
