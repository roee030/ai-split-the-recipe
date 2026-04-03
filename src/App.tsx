import { useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useSession } from './context/SplitSessionContext';
import { monitoring } from './monitoring';
import { useDirection } from './hooks/useDirection';
import { HomeScreen } from './screens/HomeScreen';
import { ProcessingScreen } from './screens/ProcessingScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { ClaimScreen } from './screens/ClaimScreen';
import { TipScreen } from './screens/TipScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { RoundRobinScreen } from './screens/RoundRobinScreen';
import { PrivacyScreen } from './screens/PrivacyScreen';
import { TermsScreen } from './screens/TermsScreen';
import { SettingsScreen } from './screens/SettingsScreen';

export function AppRouter() {
  useDirection(); // applies dir + lang to <html> element
  const { screen } = useSession();

  useEffect(() => {
    monitoring.page(screen);
  }, [screen]);

  return (
    <AnimatePresence mode="wait">
      {screen === 'home' && <HomeScreen key="home" />}
      {screen === 'processing' && <ProcessingScreen key="processing" />}
      {screen === 'review' && <ReviewScreen key="review" />}
      {screen === 'people' && <PeopleScreen key="people" />}
      {screen === 'claim' && <ClaimScreen key="claim" />}
      {screen === 'tip' && <TipScreen key="tip" />}
      {screen === 'summary' && <SummaryScreen key="summary" />}
      {screen === 'roundrobin' && <RoundRobinScreen key="roundrobin" />}
      {screen === 'privacy' && <PrivacyScreen key="privacy" />}
      {screen === 'terms' && <TermsScreen key="terms" />}
      {screen === 'settings' && <SettingsScreen key="settings" />}
    </AnimatePresence>
  );
}
