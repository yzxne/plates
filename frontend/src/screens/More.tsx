import { useState } from 'preact/hooks';
import { api, clearToken, errorMessage, setToken } from '../api';
import { showToast } from '../toast';
import { AiUsageCard } from '../components/AiUsageCard';
import { ConnectionCard } from '../components/ConnectionCard';
import { IconBack, IconChevron } from '../components/Icons';
import { NotificationsCard } from '../components/NotificationsCard';
import { PendingCard } from '../components/PendingCard';
import { ShortcutsCard } from '../components/ShortcutsCard';
import { DataScreen } from './DataScreen';
import { SavedFoods } from './SavedFoods';
import { Settings } from './Settings';

/** Settings hub, opened from the gear icon on Today (brief v2: not a tab). */
export function More({ onLogout, onClose }: { onLogout: () => void; onClose: () => void }) {
  const [view, setView] = useState<'menu' | 'settings' | 'foods' | 'data'>('menu');

  async function logoutOthers() {
    if (!confirm('Sign out Plates on every other phone or computer? Use this if a device is lost. This one stays signed in.')) return;
    try {
      const r = await api<{ token: string }>('POST', '/auth/logout-others');
      setToken(r.token);
      showToast('Other devices will be signed out within about a minute', 'info');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

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
        {view === 'data' && <DataScreen onBack={() => setView('menu')} />}
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
              <button class="row" onClick={() => setView('data')}>
                <span class="row-text"><span>Import & export</span><small class="muted">Excel backup, weekly summary, Hevy & Cal AI imports</small></span>
                <IconChevron size={18} />
              </button>
            </div>
            <AiUsageCard />
            <NotificationsCard />
            <ShortcutsCard />
            <ConnectionCard />
            <div class="link-row">
              <button class="btn link" onClick={logoutOthers}>Sign out other devices</button>
              <button class="btn link danger" onClick={logout}>Log out</button>
            </div>
            <p class="muted center tiny">Food data: USDA FoodData Central · Open Food Facts (ODbL)</p>
          </section>
        )}
      </div>
    </div>
  );
}
