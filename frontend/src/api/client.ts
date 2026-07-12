import axios, { AxiosInstance } from 'axios';
import type {
  AdapterListItem,
  AdapterCapabilityDetailResponse,
  AdapterImplementationResponse,
  AdapterDraftDetailResponse,
  AdapterDraftListResponse,
  AdapterFunctionSourceResponse,
  AdapterFunctionTestRequest,
  AdapterFunctionTestResponse,
  CompleteHumanVerificationRequest,
  DomReadinessCheckRequest,
  DomReadinessCheckResponse,
  AdapterResolveRequest,
  AdapterResolveResponse,
  ApiResponse,
  ChallengeHandoffJobSummary,
  ConfigResponse,
  CreateSelectorDiscoveryRequest,
  CreateSelectorDiscoverySnapshotRequest,
  CreateTaskRequest,
  CreateTaskResponse,
  FixtureCaptureRequest,
  FixtureCaptureResponse,
  FixtureDetailResponse,
  FixtureFunctionTestRequest,
  MessageResponse,
  OpenVerificationBrowserRequest,
  SaveAdapterDraftContentRequest,
  SelectorDiscoveryConfigRequest,
  SelectorDiscoveryJobSummary,
  SelectorDiscoverySettingsSummary,
  TaskDetailResponse,
  TaskListResponse,
  TaskPriorityOrderResponse,
} from '@comiccrawler/shared';

export type { ApiResponse } from '@comiccrawler/shared';

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
  domReadiness: '/api/dom-readiness',
  fixtures: '/api/fixtures',
  adapterDrafts: '/api/adapter-drafts',
  status: '/api/status',
} as const;

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

  async getTasks(): Promise<ApiResponse<TaskListResponse>> {
    const response = await this.client.get(API_ENDPOINTS.tasks);
    return response.data;
  }

  async getTaskPriorityOrder(): Promise<ApiResponse<TaskPriorityOrderResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.tasks}/priority-order`);
    return response.data;
  }

  async updateTaskPriorityOrder(taskIds: string[]): Promise<ApiResponse<TaskPriorityOrderResponse>> {
    const response = await this.client.put(`${API_ENDPOINTS.tasks}/priority-order`, { taskIds });
    return response.data;
  }

  async getTask(id: string): Promise<ApiResponse<TaskDetailResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.tasks}/${id}`);
    return response.data;
  }

  async createTask(url: string, options?: Omit<CreateTaskRequest, 'url'>): Promise<ApiResponse<CreateTaskResponse>> {
    const response = await this.client.post(API_ENDPOINTS.tasks, { url, ...options });
    return response.data;
  }

  async pauseTask(id: string): Promise<ApiResponse<MessageResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.tasks}/${id}/pause`);
    return response.data;
  }

  async resumeTask(id: string): Promise<ApiResponse<MessageResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.tasks}/${id}/resume`);
    return response.data;
  }

  async cancelTask(id: string): Promise<ApiResponse<MessageResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.tasks}/${id}/cancel`);
    return response.data;
  }

  async deleteTask(id: string): Promise<ApiResponse<MessageResponse>> {
    const response = await this.client.delete(`${API_ENDPOINTS.tasks}/${id}`);
    return response.data;
  }

  async getConfig(): Promise<ApiResponse<ConfigResponse>> {
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

  async updateSelectorDiscoveryConfig(config: SelectorDiscoveryConfigRequest): Promise<ApiResponse<SelectorDiscoverySettingsSummary>> {
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

  async getAdapters(): Promise<ApiResponse<AdapterListItem[]>> {
    const response = await this.client.get(API_ENDPOINTS.adapters);
    return response.data;
  }

  async resolveAdapter(input: AdapterResolveRequest): Promise<ApiResponse<AdapterResolveResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.adapters}/resolve`, input);
    return response.data;
  }

  async getAdapterCapabilities(id: string): Promise<ApiResponse<AdapterCapabilityDetailResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.adapters}/${id}/capabilities`);
    return response.data;
  }

  async getAdapterImplementation(id: string): Promise<ApiResponse<AdapterImplementationResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.adapters}/${id}/implementation`);
    return response.data;
  }

  async getAdapterFunctionSource(id: string, functionId: string): Promise<ApiResponse<AdapterFunctionSourceResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.adapters}/${id}/functions/${functionId}/source`);
    return response.data;
  }

  async testAdapterFunction(
    id: string,
    functionId: string,
    input: AdapterFunctionTestRequest
  ): Promise<ApiResponse<AdapterFunctionTestResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.adapters}/${id}/functions/${functionId}/test`, input);
    return response.data;
  }

  async checkDomReadiness(input: DomReadinessCheckRequest): Promise<ApiResponse<DomReadinessCheckResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.domReadiness}/check`, input);
    return response.data;
  }

  async captureFixture(input: FixtureCaptureRequest): Promise<ApiResponse<FixtureCaptureResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.fixtures}/capture`, input);
    return response.data;
  }

  async getFixture(domain: string, id: string, includeHtml = false): Promise<ApiResponse<FixtureDetailResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.fixtures}/${domain}/${id}`, {
      params: { includeHtml },
    });
    return response.data;
  }

  async testFixtureFunction(
    domain: string,
    id: string,
    input: FixtureFunctionTestRequest
  ): Promise<ApiResponse<any>> {
    const response = await this.client.post(`${API_ENDPOINTS.fixtures}/${domain}/${id}/test-adapter-function`, input);
    return response.data;
  }

  async getAdapterDrafts(): Promise<ApiResponse<AdapterDraftListResponse>> {
    const response = await this.client.get(API_ENDPOINTS.adapterDrafts);
    return response.data;
  }

  async createAdapterDraft(adapterId: string): Promise<ApiResponse<AdapterDraftDetailResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.adapters}/${adapterId}/drafts`);
    return response.data;
  }

  async getAdapterDraft(draftId: string): Promise<ApiResponse<AdapterDraftDetailResponse>> {
    const response = await this.client.get(`${API_ENDPOINTS.adapterDrafts}/${draftId}`);
    return response.data;
  }

  async saveAdapterDraftContent(
    draftId: string,
    input: SaveAdapterDraftContentRequest
  ): Promise<ApiResponse<AdapterDraftDetailResponse>> {
    const response = await this.client.put(`${API_ENDPOINTS.adapterDrafts}/${draftId}/content`, input);
    return response.data;
  }

  async resetAdapterDraft(draftId: string): Promise<ApiResponse<AdapterDraftDetailResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.adapterDrafts}/${draftId}/reset`);
    return response.data;
  }

  async discardAdapterDraft(draftId: string): Promise<ApiResponse<MessageResponse>> {
    const response = await this.client.delete(`${API_ENDPOINTS.adapterDrafts}/${draftId}`);
    return response.data;
  }

  async testAdapterDraftFunction(
    draftId: string,
    functionId: string,
    input: AdapterFunctionTestRequest
  ): Promise<ApiResponse<AdapterFunctionTestResponse>> {
    const response = await this.client.post(`${API_ENDPOINTS.adapterDrafts}/${draftId}/functions/${functionId}/test`, input);
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

  async createSelectorDiscovery(input: CreateSelectorDiscoveryRequest): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(API_ENDPOINTS.selectorDiscovery, input);
    return response.data;
  }

  async createSelectorDiscoveryFromSnapshot(input: CreateSelectorDiscoverySnapshotRequest): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/snapshot`, input);
    return response.data;
  }

  async getSelectorDiscovery(id: string): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.get(`${API_ENDPOINTS.selectorDiscovery}/${id}`);
    return response.data;
  }

  async promoteSelectorDiscovery(id: string): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/promote`);
    return response.data;
  }

  async shadowPromoteSelectorDiscovery(id: string): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/shadow-promote`);
    return response.data;
  }

  async rejectSelectorDiscovery(id: string): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/reject`);
    return response.data;
  }

  async revalidateSelectorDiscovery(id: string): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/revalidate`);
    return response.data;
  }

  async validateSelectorDiscoveryCandidate(id: string): Promise<ApiResponse<SelectorDiscoveryJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.selectorDiscovery}/${id}/validate`);
    return response.data;
  }

  async getChallengeDiscovery(id: string): Promise<ApiResponse<ChallengeHandoffJobSummary>> {
    const response = await this.client.get(`${API_ENDPOINTS.challengeDiscovery}/${id}`);
    return response.data;
  }

  async retryChallengeDiscovery(id: string): Promise<ApiResponse<ChallengeHandoffJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/retry`);
    return response.data;
  }

  async promoteChallengeDiscovery(id: string): Promise<ApiResponse<ChallengeHandoffJobSummary>> {
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
    options?: OpenVerificationBrowserRequest
  ): Promise<ApiResponse<ChallengeHandoffJobSummary>> {
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

  async completeChallengeDiscoveryHumanVerification(
    id: string,
    input?: CompleteHumanVerificationRequest
  ): Promise<ApiResponse<ChallengeHandoffJobSummary>> {
    const response = await this.client.post(`${API_ENDPOINTS.challengeDiscovery}/${id}/complete-human-verification`, input ?? {});
    return response.data;
  }

  async getStatus(): Promise<ApiResponse<any>> {
    const response = await this.client.get(API_ENDPOINTS.status);
    return response.data;
  }
}

export const api = new ApiClient();
