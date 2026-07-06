import type { EventBus } from '../events/bus';
import type { IStorage } from '../storage/types';
import { ComicError, ErrorType } from '../error/types';
import { TriggerManager, type TriggerManagerConfig } from './trigger-manager';
import type { AgentTriggerProgress, ExtractionFailureContext, TriggerFailureRecord } from './types';

const RECORDS_KEY = 'agent/trigger-records';
const COOLDOWNS_KEY = 'agent/trigger-cooldowns';

interface PersistedTriggerState {
  records: TriggerFailureRecord[];
  cooldowns: Array<{ triggerKey: string; until: number }>;
}

export class AgentTriggerMonitor {
  private readonly triggerManager: TriggerManager;
  private readonly storage?: IStorage;

  constructor(eventBus?: EventBus, storage?: IStorage, config?: TriggerManagerConfig) {
    this.triggerManager = new TriggerManager(config);
    this.storage = storage;

    eventBus?.on('task:failed', async ({ error }) => {
      await this.handleTaskFailure(error);
    });
  }

  async initialize(): Promise<void> {
    if (!this.storage) {
      return;
    }

    const records = (await this.storage.read<TriggerFailureRecord[]>(RECORDS_KEY)) ?? [];
    const cooldowns = (await this.storage.read<Array<{ triggerKey: string; until: number }>>(COOLDOWNS_KEY)) ?? [];

    for (const record of records) {
      (this.triggerManager as any).failureRecords.set(record.triggerKey, {
        ...record,
        firstOccurredAt: new Date(record.firstOccurredAt),
        lastOccurredAt: new Date(record.lastOccurredAt),
      });
    }

    for (const cooldown of cooldowns) {
      (this.triggerManager as any).cooldowns.set(cooldown.triggerKey, cooldown.until);
    }
  }

  getProgress(adapterId: string): AgentTriggerProgress | null {
    const records = this.triggerManager.getFailureRecords(adapterId);
    if (records.length === 0) {
      return null;
    }

    const record = [...records].sort((left, right) => right.lastOccurredAt.getTime() - left.lastOccurredAt.getTime())[0]!;
    const threshold = this.triggerManager.getThreshold();
    const cooldownRemainingMs = this.triggerManager.getCooldownRemainingMs(record.triggerKey);

    return {
      adapterId,
      triggerKey: record.triggerKey,
      pageType: record.pageType,
      selectorName: record.selectorName,
      count: record.count,
      threshold,
      remainingFailures: Math.max(0, threshold - record.count),
      inCooldown: cooldownRemainingMs > 0,
      cooldownRemainingMs,
      activeSession: this.triggerManager.hasActiveSession(adapterId),
      lastMessage: record.lastMessage,
      firstOccurredAt: record.firstOccurredAt,
      lastOccurredAt: record.lastOccurredAt,
    };
  }

  getThreshold(): number {
    return this.triggerManager.getThreshold();
  }

  private async handleTaskFailure(error: Error): Promise<void> {
    if (!(error instanceof ComicError) || error.type !== ErrorType.PARSING_ERROR) {
      return;
    }

    if (!this.isExtractionFailureContext(error.context)) {
      return;
    }

    this.triggerManager.recordFailure(error.context);
    await this.persist();
  }

  private isExtractionFailureContext(context: Record<string, unknown>): context is ExtractionFailureContext {
    return (
      typeof context.adapterId === 'string' &&
      typeof context.parseMode === 'string' &&
      typeof context.repairMode === 'string' &&
      typeof context.pageType === 'string' &&
      typeof context.url === 'string' &&
      typeof context.message === 'string'
    );
  }

  private async persist(): Promise<void> {
    if (!this.storage) {
      return;
    }

    const state: PersistedTriggerState = {
      records: this.triggerManager.getFailureRecords(),
      cooldowns: this.triggerManager
        .getFailureRecords()
        .map((record) => ({
          triggerKey: record.triggerKey,
          until: Date.now() + this.triggerManager.getCooldownRemainingMs(record.triggerKey),
        }))
        .filter((cooldown) => cooldown.until > Date.now()),
    };

    await this.storage.write(RECORDS_KEY, state.records);
    await this.storage.write(COOLDOWNS_KEY, state.cooldowns);
  }
}
