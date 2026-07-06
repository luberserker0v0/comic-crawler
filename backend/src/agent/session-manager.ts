import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { AgentSession } from './types';

export class SessionManager {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async load(adapterId: string): Promise<AgentSession | null> {
    const sessionPath = this.getSessionPath(adapterId);
    try {
      const content = await fs.readFile(sessionPath, 'utf-8');
      return JSON.parse(content) as AgentSession;
    } catch {
      return null;
    }
  }

  async save(adapterId: string, session: AgentSession): Promise<void> {
    const sessionPath = this.getSessionPath(adapterId);
    await fs.mkdir(join(sessionPath, '..'), { recursive: true });
    await fs.writeFile(sessionPath, JSON.stringify(session, null, 2));
  }

  async create(
    adapterId: string,
    maxAttempts = 5,
    options?: Pick<AgentSession, 'sessionId' | 'pageType' | 'repairMode' | 'triggerKey' | 'sourceVersion'>
  ): Promise<AgentSession> {
    const session: AgentSession = {
      adapterId,
      status: 'in_progress',
      currentAttempt: 0,
      maxAttempts,
      sessionId: options?.sessionId,
      pageType: options?.pageType,
      repairMode: options?.repairMode,
      triggerKey: options?.triggerKey,
      sourceVersion: options?.sourceVersion,
      startedAt: new Date(),
    };

    await this.save(adapterId, session);
    return session;
  }

  async updateAttempt(adapterId: string, attempt: number, error?: string): Promise<void> {
    const session = await this.load(adapterId);
    if (!session) return;

    session.currentAttempt = attempt;

    if (error) {
      session.lastFailure = {
        reason: error,
        timestamp: new Date(),
      };
    }

    await this.save(adapterId, session);
  }

  async complete(adapterId: string, version: string): Promise<void> {
    const session = await this.load(adapterId);
    if (!session) return;

    session.status = 'completed';
    session.lastSuccess = {
      version,
      timestamp: new Date(),
    };
    session.completedAt = new Date();

    await this.save(adapterId, session);
  }

  async awaitReview(adapterId: string, version: string): Promise<void> {
    const session = await this.load(adapterId);
    if (!session) return;

    session.status = 'awaiting_review';
    session.candidateVersion = version;

    await this.save(adapterId, session);
  }

  async fail(adapterId: string): Promise<void> {
    const session = await this.load(adapterId);
    if (!session) return;

    session.status = 'failed';
    session.completedAt = new Date();

    await this.save(adapterId, session);
  }

  async rollback(adapterId: string): Promise<void> {
    const session = await this.load(adapterId);
    if (!session) return;

    session.status = 'rolled_back';
    session.completedAt = new Date();

    await this.save(adapterId, session);
  }

  private getSessionPath(adapterId: string): string {
    return join(this.workspacePath, adapterId, 'session.json');
  }
}
