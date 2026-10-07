import { useI18n } from '../../../text/i18n';

export type AgentSection = 'site-adapters' | 'build-jobs' | 'deleted-adapters';

export function SectionTabs(props: {
  activeSection: AgentSection;
  setActiveSection: (section: AgentSection) => void;
}) {
  const { text } = useI18n();
  const { activeSection, setActiveSection } = props;

  return (
    <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow">
      <button
        type="button"
        onClick={() => setActiveSection('site-adapters')}
        className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
          activeSection === 'site-adapters'
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        {text.agent.siteAdaptersTab}
      </button>
      <button
        type="button"
        onClick={() => setActiveSection('build-jobs')}
        className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
          activeSection === 'build-jobs'
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        {text.agent.buildJobsTab}
      </button>
      <button
        type="button"
        onClick={() => setActiveSection('deleted-adapters')}
        className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
          activeSection === 'deleted-adapters'
            ? 'bg-slate-900 text-white'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        {text.agent.deletedAdaptersTab}
      </button>
    </div>
  );
}
