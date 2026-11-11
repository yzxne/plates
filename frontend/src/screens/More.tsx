import { useState } from 'preact/hooks';
import { clearToken } from '../api';
import { ConnectionCard } from '../components/ConnectionCard';
import { IconChevron } from '../components/Icons';
import { PendingCard } from '../components/PendingCard';
import { Settings } from './Settings';

export function More({ onLogout }: { onLogout: () => void }) {
  const [view, setView] = useState<'menu' | 'settings'>('menu');
  if (view === 'settings') return <Settings onBack={() => setView('menu')} />;

  function logout() {
    if (!confirm('Log out of Plates on this device?')) return;
    clearToken();
    onLogout();
  }

  return (
    <section>
      <header class="screen-head"><h1>More</h1></header>
      <PendingCard />
      <ConnectionCard />
      <div class="list card">
        <button class="row" onClick={() => setView('settings')}>
          <span>Settings</span><IconChevron size={18} />
        </button>
        <div class="row disabled"><span>Strategy</span><small>Phase 5</small></div>
        <div class="row disabled"><span>Weight</span><small>Phase 5</small></div>
        <div class="row disabled"><span>AI usage</span><small>Phase 6</small></div>
        <div class="row disabled"><span>Exports</span><small>Phase 7</small></div>
        <div class="row disabled"><span>Imports</span><small>Phase 7</small></div>
      </div>
      <button class="btn link danger center" onClick={logout}>Log out</button>
      <p class="muted center tiny">Food data: USDA FoodData Central · Open Food Facts (ODbL)</p>
    </section>
  );
}
