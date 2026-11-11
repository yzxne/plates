import { useState } from 'preact/hooks';
import { clearToken } from '../api';
import { AiUsageCard } from '../components/AiUsageCard';
import { ConnectionCard } from '../components/ConnectionCard';
import { IconBack, IconChevron } from '../components/Icons';
import { NotificationsCard } from '../components/NotificationsCard';
import { PendingCard } from '../components/PendingCard';
import { SavedFoods } from './SavedFoods';
import { Settings } from './Settings';

/** Settings hub, opened from the gear icon on Today (brief v2: not a tab). */
export function More({ onLogout, onClose }: { onLogout: () => void; onClose: () => void }) {
  const [view, setView] = useState<'menu' | 'settings' | 'foods'>('menu');

  function logout() {
    if (!confirm('Log out of Plates on this device?')) return;
    clearToken();
    onLogout();
  }

  return (
    <div class="overlay settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="overlay-body">
        {view === 'settings' && <Settings onBack={() => setView('menu')} />}
        {view === 'foods' && <SavedFoods onBack={() => setView('menu')} />}
        {view === 'menu' && (
          <section>
            <header class="screen-head with-back">
              <button class="icon-btn" aria-label="Close settings" onClick={onClose}><IconBack /></button>
              <h1>Settings</h1>
            </header>
            <PendingCard />
            <div class="list card">
              <button class="row" onClick={() => setView('settings')}>
                <span class="row-text"><span>Profile, goals & meal times</span><small class="muted">Body, goal, training days, meal windows, cafeteria</small></span>
                <IconChevron size={18} />
              </button>
              <button class="row" onClick={() => setView('foods')}><span>Saved foods</span><IconChevron size={18} /></button>
              <div class="row disabled"><span>Exports</span><small>Phase 7</small></div>
              <div class="row disabled"><span>Imports</span><small>Phase 7</small></div>
            </div>
            <AiUsageCard />
            <NotificationsCard />
            <ConnectionCard />
            <button class="btn link danger center" onClick={logout}>Log out</button>
            <p class="muted center tiny">Food data: USDA FoodData Central · Open Food Facts (ODbL)</p>
          </section>
        )}
      </div>
    </div>
  );
}
