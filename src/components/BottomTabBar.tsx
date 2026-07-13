import { useNavigate, useLocation } from 'react-router-dom';

interface Tab {
  key: string;
  label: string;
  path: string;
  match: (p: string) => boolean;
  icon: React.ReactNode;
}

const homeTab: Tab = {
  key: 'home',
  label: 'Home',
  path: '/',
  match: (p: string) => p === '/',
  icon: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
};

const engineTab: Tab = {
  key: 'engine',
  label: 'Engine',
  path: '/engine',
  match: (p: string) => p.startsWith('/engine'),
  icon: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 2c1 3 2.5 3.5 3.5 4.5A5 5 0 0 1 17 10c0 2.76-2.24 5-5 5s-5-2.24-5-5c0-1.33.52-2.54 1.37-3.44C9.37 5.56 11 5 12 2z" />
      <path d="M12 15v7" />
      <path d="M8 22h8" />
    </svg>
  ),
};

// The full retail bar (unchanged).
const retailTabs: Tab[] = [
  homeTab,
  {
    key: 'coach',
    label: 'Coach',
    path: '/chat',
    match: (p: string) => p === '/chat' || p === '/history' || p === '/bookmarks',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  engineTab,
  {
    key: 'training',
    label: 'Training',
    path: '/programs',
    match: (p: string) =>
      p.startsWith('/programs') ||
      p.startsWith('/athletedata') ||
      p === '/training-log' ||
      p.startsWith('/ailog') ||
      p === '/workout-review' ||
      p.startsWith('/workout'),
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M9 11l3 3L22 4" />
        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
      </svg>
    ),
  },
  {
    key: 'nutrition',
    label: 'Nutrition',
    path: '/nutrition',
    match: (p: string) => p.startsWith('/nutrition'),
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M17 8c0-5-5-5-5-5s-5 0-5 5c0 3.5 2.5 6 5 8 2.5-2 5-4.5 5-8z" />
        <path d="M12 4v16" />
      </svg>
    ),
  },
];

// The gym-shell bar was retired in the Decision 12a Phase C sweep — this PWA
// serves retail only; gym members live on their gym's member app.

export default function BottomTabBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const tabs = retailTabs;

  return (
    <nav className="bottom-tab-bar">
      {tabs.map((tab) => {
        const active = tab.match(location.pathname);
        return (
          <button
            key={tab.key}
            className={'tab-item' + (active ? ' active' : '')}
            onClick={() => navigate(tab.path)}
          >
            {tab.icon}
            <span className="tab-label">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
