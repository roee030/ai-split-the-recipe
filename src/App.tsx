import { AnimatePresence } from 'framer-motion';
import { useSession } from './context/SplitSessionContext';
import { HomeScreen } from './screens/HomeScreen';
import { ProcessingScreen } from './screens/ProcessingScreen';
import { ReviewScreen } from './screens/ReviewScreen';
import { PeopleScreen } from './screens/PeopleScreen';
import { ClaimScreen } from './screens/ClaimScreen';
import { TipScreen } from './screens/TipScreen';
import { SummaryScreen } from './screens/SummaryScreen';
import { RoundRobinScreen } from './screens/RoundRobinScreen';

export function AppRouter() {
  const { screen } = useSession();

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
    </AnimatePresence>
  );
}
