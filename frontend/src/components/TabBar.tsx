import { IconDashboard, IconFoodLog, IconMore, IconPlus, IconTrain } from './Icons';

export type TabId = 'dashboard' | 'food' | 'train' | 'more';

interface Props {
  current: TabId;
  onSelect: (t: TabId) => void;
  onAdd: () => void;
}

const TABS: { id: TabId; label: string; Icon: (p: { size?: number }) => preact.JSX.Element }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: IconDashboard },
  { id: 'food', label: 'Food Log', Icon: IconFoodLog },
  { id: 'train', label: 'Train', Icon: IconTrain },
  { id: 'more', label: 'More', Icon: IconMore },
];

export function TabBar({ current, onSelect, onAdd }: Props) {
  const button = (t: (typeof TABS)[number]) => (
    <button
      key={t.id}
      class={`tab ${current === t.id ? 'active' : ''}`}
      aria-current={current === t.id ? 'page' : undefined}
      onClick={() => onSelect(t.id)}
    >
      <t.Icon />
      <span>{t.label}</span>
    </button>
  );
  return (
    <nav class="tabbar" aria-label="Main">
      {button(TABS[0]!)}
      {button(TABS[1]!)}
      <button class="tab add" aria-label="Add" onClick={onAdd}>
        <span class="add-circle"><IconPlus size={26} /></span>
      </button>
      {button(TABS[2]!)}
      {button(TABS[3]!)}
    </nav>
  );
}
