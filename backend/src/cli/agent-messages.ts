export const agentCliMessages = {
  description: 'Manage agent review, promotion, and rollback flow',
  commands: {
    status: {
      description: 'Show agent state for one adapter or all adapters',
      adapterArgument: 'Adapter ID',
      allOption: 'Show all registered adapters',
      summaryHeaders: ['Adapter', 'Session', 'Active', 'Candidate', 'Versions'],
      noState: 'No agent state found for this adapter.',
    },
    promote: {
      description: 'Promote a candidate version to active',
      adapterArgument: 'Adapter ID',
      versionOption: 'Candidate version to promote',
      success: (adapterId: string, version: string) => `Promoted ${adapterId} to ${version}`,
    },
    reject: {
      description: 'Reject a candidate version',
      adapterArgument: 'Adapter ID',
      versionOption: 'Candidate version to reject',
      success: (adapterId: string, version: string) => `Rejected candidate ${version} for ${adapterId}`,
    },
    rollback: {
      description: 'Rollback the active version to a previous or target version',
      adapterArgument: 'Adapter ID',
      versionOption: 'Target version to rollback to',
      success: (adapterId: string, version: string) => `Rolled back ${adapterId} to ${version}`,
    },
  },
} as const;
