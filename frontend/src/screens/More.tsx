import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, clearToken, errorMessage, setToken } from '../api';
import { showToast } from '../toast';
import { AiUsageCard } from '../components/AiUsageCard';
import { ConnectionCard } from '../components/ConnectionCard';
import { IconBack, IconChevron } from '../components/Icons';
import { NotificationsCard } from '../components/NotificationsCard';
import { PendingCard } from '../components/PendingCard';
import { ShortcutsCard } from '../components/ShortcutsCard';
import { getSettings } from '../settingsStore';
import { DataScreen } from './DataScreen';
import { SavedFoods } from './SavedFoods';
import { Settings } from './Settings';

type View = 'menu' | 'settings' | 'foods' | 'data' | 'ai' | 'notify' | 'shortcuts' | 'google';

const GOAL: Record<string, string> = { lose: 'Losing', maintain: 'Maintaining', gain: 'Gaining' };

/** Settings hub (gear on Today): one grouped list; each row opens its own page. */
export function More({ onLogout, onClose }: { onLogout: () => void; onClose: () => void }) {
  const [view, setView] = useState<View>('menu');
  const [ai, setAi] = useState('');
  const back = () => setView('menu');

  useEffect(() => {
    if (view !== 'menu') return;
    api<{ month_total: number; cap: number; configured: boolean }>('GET', '/ai/usage')
      .then((u) => setAi(u.configured ? `$${u.month_total.toFixed(2)} of $${u.cap.toFixed(2)} this month` : 'Not set up'))
      .catch(() => setAi(''));
  }, [view]);

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

  const s = getSettings();
  const profile = [GOAL[s.goal_type ?? ''] ?? '', s.goal_type && s.goal_type !== 'maintain' ? `${s.goal_rate_lb_per_week} lb/week` : '', s.training_days ? `trains ${s.training_days.split(',').length}×/week` : '']
    .filter(Boolean).join(' · ');

  return (
    <div class="overlay settings-overlay" role="dialog" aria-modal="true" aria-label="Settings">
      <div class="overlay-body">
        {view === 'settings' && <Settings onBack={back} />}
        {view === 'foods' && <SavedFoods onBack={back} />}
        {view === 'data' && <DataScreen onBack={back} />}
        {view === 'ai' && <SubPage title="AI estimates" onBack={back}><AiUsageCard /></SubPage>}
        {view === 'notify' && <SubPage title="Notifications" onBack={back}><NotificationsCard /></SubPage>}
        {view === 'shortcuts' && <SubPage title="iPhone Shortcuts" onBack={back}><ShortcutsCard /></SubPage>}
        {view === 'google' && <SubPage title="Google Sheet" onBack={back}><ConnectionCard /></SubPage>}
        {view === 'menu' && (
          <section>
            <header class="screen-head with-back">
              <button class="icon-btn" aria-label="Close settings" onClick={onClose}><IconBack /></button>
              <h1>Settings</h1>
            </header>
            <PendingCard />

            <h3 class="group-label">You</h3>
            <div class="list card">
              <Row title="Profile & goals" sub={profile || 'Body, goal, training days, meal times'} onClick={() => setView('settings')} />
              <Row title="Saved foods" sub="Your foods, favorites" onClick={() => setView('foods')} />
            </div>

            <h3 class="group-label">Connections</h3>
            <div class="list card">
              <Row title="Google Sheet" sub="Where your data lives" onClick={() => setView('google')} />
              <Row title="Notifications" sub="Rest timer alerts" onClick={() => setView('notify')} />
              <Row title="iPhone Shortcuts" sub="Health, Siri, reminders" onClick={() => setView('shortcuts')} />
            </div>

            <h3 class="group-label">Data</h3>
            <div class="list card">
              <Row title="Import & export" sub="Backups, Excel, weekly summary, imports" onClick={() => setView('data')} />
              <Row title="AI estimates" sub={ai || 'Spending and monthly cap'} onClick={() => setView('ai')} />
            </div>

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

function Row({ title, sub, onClick }: { title: string; sub?: string; onClick: () => void }) {
  return (
    <button class="row" onClick={onClick}>
      <span class="row-text"><span>{title}</span>{sub && <small class="muted clip">{sub}</small>}</span>
      <IconChevron size={18} />
    </button>
  );
}

/** A settings page holding one existing card; the card's own title is hidden (the page title says it). */
function SubPage({ title, onBack, children }: { title: string; onBack: () => void; children: ComponentChildren }) {
  return (
    <section class="subpage">
      <header class="screen-head with-back">
        <button class="icon-btn" aria-label="Back" onClick={onBack}><IconBack /></button>
        <h1>{title}</h1>
      </header>
      {children}
    </section>
  );
}
