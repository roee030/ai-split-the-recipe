import './i18n';
import { initSentry, initPostHog } from './monitoring';
import ReactDOM from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CoachMarkProvider } from './context/CoachMarkContext';
import { SplitSessionProvider } from './context/SplitSessionContext';
import { AppRouter } from './App';
import { CoachMarkOverlay } from './components/coach/CoachMarkOverlay';
import { ConsentBanner } from './components/consent/ConsentBanner';
import './index.css';

initSentry();
initPostHog();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <ThemeProvider>
      <CoachMarkProvider>
        <SplitSessionProvider>
          <AppRouter />
          <CoachMarkOverlay />
          <ConsentBanner />
        </SplitSessionProvider>
      </CoachMarkProvider>
    </ThemeProvider>
  </AuthProvider>
);
