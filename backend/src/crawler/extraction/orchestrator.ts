import type { IExtractionStrategy, ExtractionContext, ExtractionResult } from './types';
import { ComicError, ErrorType } from '../../error/types';

export class ExtractionOrchestrator {
  private strategies = new Map<string, IExtractionStrategy>();
  private defaultStrategy?: IExtractionStrategy;

  register(strategy: IExtractionStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  setDefault(name: string): void {
    const strategy = this.strategies.get(name);
    if (!strategy) {
      throw new ComicError(
        `Strategy "${name}" is not registered`,
        ErrorType.CONFIG_ERROR
      );
    }
    this.defaultStrategy = strategy;
  }

  async execute(context: ExtractionContext, strategyName?: string): Promise<ExtractionResult> {
    const strategy = strategyName
      ? this.strategies.get(strategyName)
      : this.defaultStrategy;

    if (!strategy) {
      throw new ComicError(
        `No extraction strategy available${strategyName ? `: "${strategyName}"` : ''}`,
        ErrorType.CONFIG_ERROR
      );
    }

    const [metadata, chapters, images] = await Promise.all([
      strategy.extractMetadata(context).catch(() => undefined),
      strategy.extractChapters(context).catch(() => undefined),
      strategy.extractImages(context).catch(() => undefined),
    ]);

    return {
      metadata,
      chapters,
      images,
    };
  }

  async validate(context: ExtractionContext, strategyName?: string): Promise<boolean> {
    const strategy = strategyName
      ? this.strategies.get(strategyName)
      : this.defaultStrategy;

    if (!strategy?.validate) return false;

    return strategy.validate(context);
  }

  listStrategies(): string[] {
    return Array.from(this.strategies.keys());
  }

  getStrategy(name: string): IExtractionStrategy | undefined {
    return this.strategies.get(name);
  }
}
