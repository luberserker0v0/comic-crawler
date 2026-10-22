import { useI18n } from '../../../text/i18n';

export type AgentSection = 'site-adapters' | 'build-jobs' | 'deleted-adapters';

export function SectionTabs(props: {
  activeSection: AgentSection;
  setActiveSection: (section: AgentSection) => void;
}) {
  const { text } = useI18n();
  const { activeSection, setActiveSection } = props;
  const tabs: Array<[AgentSection, string]> = [['site-adapters', text.agent.siteAdaptersTab],
    ['build-jobs', text.agent.buildJobsTab], ['deleted-adapters', text.agent.deletedAdaptersTab]];
  return <div className="flex flex-wrap gap-2 rounded-2xl bg-white p-2 shadow">
    {tabs.map(([section, label]) => <SectionTab key={section} section={section} label={label}
      active={activeSection === section} setActiveSection={setActiveSection} />)}
  </div>;
}

function SectionTab(props: { section: AgentSection; label: string; active: boolean; setActiveSection(section: AgentSection): void }) {
  const color = props.active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100';
  return <button type="button" onClick={() => props.setActiveSection(props.section)}
    className={`rounded-xl px-4 py-2 text-sm font-medium transition ${color}`}>{props.label}</button>;
}
