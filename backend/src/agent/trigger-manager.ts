import type { ExtractionFailureContext, TriggerFailureRecord } from './types';

export interface TriggerManagerConfig {
  threshold?: number;
  cooldownMs?: number;
}

export interface TriggerEvaluation {
  adapterId: string;
  triggerKey: string;
  count: number;
  threshold: number;
  triggered: boolean;
  inCooldown: boolean;
  activeSession: boolean;
  cooldownRemainingMs: number;
}

interface SessionLock {
  sessionId: string;
  startedAt: Date;
}

export class TriggerManager {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly failureRecords = new Map<string, TriggerFailureRecord>();
  private readonly cooldowns = new Map<string, number>();
  private readonly activeSessions = new Map<string, SessionLock>();

  constructor(config: TriggerManagerConfig = {}) {
    this.threshold = config.threshold ?? 3;
    this.cooldownMs = config.cooldownMs ?? 24 * 60 * 60 * 1000;
  }

  getThreshold(): number {
    return this.threshold;
  }

  recordFailure(context: ExtractionFailureContext, occurredAt = new Date()): TriggerEvaluation {
    const triggerKey = this.buildTriggerKey(context);
    const cooldownUntil = this.cooldowns.get(triggerKey) ?? 0;
    const activeSession = this.activeSessions.has(context.adapterId);
    const inCooldown = cooldownUntil > occurredAt.getTime();
    const existingRecord = this.failureRecords.get(triggerKey);
    const count = (existingRecord?.count ?? 0) + 1;
    this.failureRecords.set(triggerKey, createFailureRecord(context, triggerKey, count, existingRecord, occurredAt));
    const triggered = count >= this.threshold && !inCooldown && !activeSession;
    if (triggered) this.activateCooldown(triggerKey, occurredAt);
    return { adapterId: context.adapterId, triggerKey, count, threshold: this.threshold, triggered,
      inCooldown, activeSession, cooldownRemainingMs: inCooldown ? cooldownUntil - occurredAt.getTime() : 0 };
  }

  private activateCooldown(triggerKey: string, occurredAt: Date): void {
    this.cooldowns.set(triggerKey, occurredAt.getTime() + this.cooldownMs);
    this.failureRecords.delete(triggerKey);
  }

  startSession(adapterId: string, sessionId: string, startedAt = new Date()): boolean {
    if (this.activeSessions.has(adapterId)) {
      return false;
    }

    this.activeSessions.set(adapterId, { sessionId, startedAt });
    return true;
  }

  finishSession(adapterId: string): void {
    this.activeSessions.delete(adapterId);
  }

  hasActiveSession(adapterId: string): boolean {
    return this.activeSessions.has(adapterId);
  }

  getFailureRecord(triggerKey: string): TriggerFailureRecord | null {
    return this.failureRecords.get(triggerKey) ?? null;
  }

  getFailureRecords(adapterId?: string): TriggerFailureRecord[] {
    const records = Array.from(this.failureRecords.values());

    if (!adapterId) {
      return records;
    }

    return records.filter((record) => record.adapterId === adapterId);
  }

  getCooldownRemainingMs(triggerKey: string, now = new Date()): number {
    const cooldownUntil = this.cooldowns.get(triggerKey) ?? 0;
    return Math.max(0, cooldownUntil - now.getTime());
  }

  buildTriggerKey(context: Pick<ExtractionFailureContext, 'adapterId' | 'pageType' | 'selectorName'>): string {
    return `${context.adapterId}:${context.pageType}:${context.selectorName ?? 'unknown'}`;
  }
}

function createFailureRecord(context: ExtractionFailureContext, triggerKey: string, count: number,
  existing: TriggerFailureRecord | undefined, occurredAt: Date): TriggerFailureRecord {
  return {
    adapterId: context.adapterId, triggerKey, pageType: context.pageType,
    selectorName: context.selectorName, count,
    firstOccurredAt: existing?.firstOccurredAt ?? occurredAt,
    lastOccurredAt: occurredAt, lastMessage: context.message,
  };
}
