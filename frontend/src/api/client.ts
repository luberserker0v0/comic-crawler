import axios, { AxiosInstance } from 'axios';

const API_TIMEOUT_MS = 15 * 60 * 1000;

const API_ENDPOINTS = {
  tasks: '/api/tasks',
  adapters: '/api/adapters',
  agentAdapters: '/api/agent/adapters',
  config: '/api/config',
  search: '/api/search',
  selectorDiscovery: '/api/selector-discovery',
  challengeDiscovery: '/api/challenge-discovery',
  selectorDiscoveryConfig: '/api/config/selector-discovery',
  status: '/api/status',
} as const;

export interface ApiResponse<T> {
  data: T;
  error?: string;
}

export function getApiErrorMessage(error: any): string {
  const status = error.response?.status;
  const data = error.response?.data;
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  if (typeof data?.message === 'string' && data.message.trim()) {
    return data.message;
  }
  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }
  if (status === 502) {
    return 'API returned HTTP 502. The backend may be unavailable, crashed, or the dev proxy target may be wrong. Check the backend terminal log and runtime port settings.';
  }
  if (status) {
    return `API request failed with HTTP ${status}.`;
  }
  return error.message ?? String(error);
}

export class ApiClient {
  private client: AxiosInstance;

  constructor(baseURL = '') {
    this.client = axios.create({
      baseURL,
      timeout: API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API Error:', error.response?.data ?? error.message);
        return Promise.reject(error);
      }
    );
  }

  async getTasks(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.tasks);
    return response.data;
  }

  async getTaskPriorityOrder(): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.tasks}/priority-order`);
    return response.data;
  }

  async updateTaskPriorityOrder(taskIds: string[]): Promise<ApiResponse<any>> {
    const response = await this.client.put(`${API_ENDPOINTS.tasks}/priority-order`, { taskIds });
    return response.data;
  }

  async getTask(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.tasks}/${id}`);
    return response.data;
  }

  async createTask(url: string, options?: { adapterId?: string; mode?: 'all' | 'chapters'; chapters?: string[]; chapterUrls?: string[]; priority?: number }): Promise<ApiResponse<any>> {
    const response = await this.client.post(API_ENDPOINTS.tasks, { url, ...options });
    return response.data;
  }

  async pauseTask(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.tasks}/${id}/pause`);
    return response.data;
  }

  async resumeTask(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.tasks}/${id}/resume`);
    return response.data;
  }

  async cancelTask(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.tasks}/${id}/cancel`);
    return response.data;
  }

  async deleteTask(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.delete(`${API_ENDPOINTS.tasks}/${id}`);
    return response.data;
  }

  async getConfig(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.config);
    return response.data;
  }

  async updateConfig(config: Record<string, unknown>): Promise<ApiResponse<any>> {
    const response = await this.client.put(API_ENDPOINTS.config, config);
    return response.data;
  }

  async resetConfig(): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.config}/reset`);
    return response.data;
  }

  async browseDownloadDirectory(): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.config}/download-directory/browse`);
    return response.data;
  }

  async openDownloadDirectory(directory?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.config}/download-directory/open`, { directory });
    return response.data;
  }

  async getSelectorDiscoveryConfig(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.selectorDiscoveryConfig);
    return response.data;
  }

  async getSelectorDiscoveryBundleStatus(): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.selectorDiscoveryConfig}/bundle-status`);
    return response.data;
  }

  async getSelectorDiscoveryBundleEvaluations(): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.selectorDiscoveryConfig}/bundle-evaluations`);
    return response.data;
  }

  async updateSelectorDiscoveryConfig(config: { aoBaseUrl: string; providerDocument: unknown; model: string }): Promise<ApiResponse<any>> {
    const response = await this.client.put(API_ENDPOINTS.selectorDiscoveryConfig, config);
    return response.data;
  }

  async testSelectorDiscoveryConfig(): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscoveryConfig}/test`);
    return response.data;
  }

  async clearSelectorDiscoveryProvider(): Promise<ApiResponse<any>> {
    const response = await this.client.delete(`${API_ENDPOINTS.selectorDiscoveryConfig}/provider`);
    return response.data;
  }

  async getAdapters(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.adapters);
    return response.data;
  }

  async resolveAdapter(input: { url: string; mode: 'all' | 'chapters' }): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.adapters}/resolve`, input);
    return response.data;
  }

  async getAgentAdapters(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.agentAdapters);
    return response.data;
  }

  async getAgentAdapter(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.agentAdapters}/${id}`);
    return response.data;
  }

  async promoteAgentCandidate(id: string, version?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.agentAdapters}/${id}/promote`, { version });
    return response.data;
  }

  async rejectAgentCandidate(id: string, version?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.agentAdapters}/${id}/reject`, { version });
    return response.data;
  }

  async rollbackAgentAdapter(id: string, version?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.agentAdapters}/${id}/rollback`, { version });
    return response.data;
  }

  async search(query: string, options?: { adapterId?: string; limit?: number }): Promise<ApiResponse<any>> {
    const response = await this.client.post(API_ENDPOINTS.search, { query, ...options });
    return response.data;
  }

  async createSelectorDiscovery(input: {
    url: string;
    target?: 'full' | 'chapter-only';
    forceDiscovery?: boolean;
  }): Promise<ApiResponse<any>> {
    const response = await this.client.post(API_ENDPOINTS.selectorDiscovery, input);
    return response.data;
  }

  async createSelectorDiscoveryFromSnapshot(input: {
    url: string;
    html: string;
    finalUrl?: string;
    target?: 'chapter-only';
  }): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/snapshot`, input);
    return response.data;
  }

  async getSelectorDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.selectorDiscovery}/${id}`);
    return response.data;
  }

  async promoteSelectorDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/promote`);
    return response.data;
  }

  async shadowPromoteSelectorDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/shadow-promote`);
    return response.data;
  }

  async rejectSelectorDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/reject`);
    return response.data;
  }

  async revalidateSelectorDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/revalidate`);
    return response.data;
  }

  async validateSelectorDiscoveryCandidate(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/validate`);
    return response.data;
  }

  async getChallengeDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.challengeDiscovery}/${id}`);
    return response.data;
  }

  async retryChallengeDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/retry`);
    return response.data;
  }

  async promoteChallengeDiscovery(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/promote`);
    return response.data;
  }

  async openChallengeDiscoveryBrowser(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/open-browser`);
    return response.data;
  }

  async getChallengeBrowserOptions(): Promise<ApiResponse<any>> {
    const response = await this.client.get(`${API_ENDPOINTS.challengeDiscovery}/browser-options`);
    return response.data;
  }

  async browseChallengeBrowserExecutable(): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/browser-options/browse-executable`);
    return response.data;
  }

  async openChallengeDiscoveryExternalBrowser(
    id: string,
    options?: { executablePath?: string; profileId?: string }
  ): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/open-external-browser`, options ?? {});
    return response.data;
  }

  async testChallengeDiscoveryCdp(cdpUrl?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/cdp/test`, { cdpUrl });
    return response.data;
  }

  async inspectChallengeDiscoveryCdpPage(id: string, cdpUrl?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/inspect-cdp-page`, { cdpUrl });
    return response.data;
  }

  async createSelectorDiscoveryFromChallengeCdp(id: string, cdpUrl?: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/create-selector-discovery-from-cdp`, { cdpUrl });
    return response.data;
  }

  async completeChallengeDiscoveryHumanVerification(id: string): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/complete-human-verification`);
    return response.data;
  }

  async getStatus(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.status);
    return response.data;
  }
}

export const api = new ApiClient();
