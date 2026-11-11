import { IconDashboard, IconPlus, IconTrain } from './Icons';

export type TabId = 'today' | 'progress' | 'train';

interface Props {
  current: TabId;
  onSelect: (t: TabId) => void;
  onAdd: () => void;
}

const IconToday = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
  </svg>
);

/** Today · Progress · (+) · Train (brief v2). */
export function TabBar({ current, onSelect, onAdd }: Props) {
  const tab = (id: TabId, label: string, Icon: (p: { size?: number }) => preact.JSX.Element) => (
    <button class={`tab ${current === id ? 'active' : ''}`} aria-current={current === id ? 'page' : undefined} onClick={() => onSelect(id)}>
      <Icon />
      <span>{label}</span>
    </button>
  );
  return (
    <nav class="tabbar four" aria-label="Main">
      {tab('today', 'Today', IconToday)}
      {tab('progress', 'Progress', IconDashboard)}
      <button class="tab add" aria-label="Add food" onClick={onAdd}>
        <span class="add-circle"><IconPlus size={26} /></span>
      </button>
      {tab('train', 'Train', IconTrain)}
    </nav>
  );
}
