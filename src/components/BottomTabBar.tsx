import { useNavigate, useLocation } from 'react-router-dom';

const tabs = [
  {
    key: 'coach',
    label: 'Coach',
    path: '/',
    match: (p: string) => p === '/' || p === '/history' || p === '/bookmarks',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    key: 'training',
    label: 'Training',
    path: '/programs',
    match: (p: string) =>
      p.startsWith('/programs') ||
      p === '/training-log' ||
      p.startsWith('/engine') ||
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
  {
    key: 'settings',
    label: 'Settings',
    path: '/settings',
    match: (p: string) => p === '/settings' || p === '/profile' || p === '/checkout',
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export default function BottomTabBar() {
  const navigate = useNavigate();
  const location = useLocation();

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
