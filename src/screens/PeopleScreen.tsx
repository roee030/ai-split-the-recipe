import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { UserPlus, ChevronRight, X } from 'lucide-react';
import { useSession } from '../context/SplitSessionContext';
import { ScreenContainer } from '../components/common/ScreenContainer';
import { Avatar } from '../components/common/Avatar';
import { BackButton } from '../components/common/BackButton';
import { getPersonInitials } from '../utils/colorPalette';

type Mode = 'pick' | 'whole' | 'some';


export function PeopleScreen() {
  const { session, setScreen, addPerson, removePerson, updatePersonName } = useSession();
  const { people } = session;
  const [newName, setNewName] = useState('');
  const [mode, setMode] = useState<Mode>('pick');

  useEffect(() => {
    if (mode !== 'pick' && people.length === 0) {
      addPerson('Me');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function handleAdd(name = newName.trim()) {
    if (!name) return;
    addPerson(name);
    setNewName('');
  }

  function handleQuickAdd(count: number) {
    const currentGuestCount = people.length;
    for (let i = 1; i <= count; i++) {
      addPerson(`Guest ${currentGuestCount + i}`);
    }
  }

  const mePerson = people[0];
  const guests = people.slice(1);
  const continueLabel = mode === 'whole' ? 'Start Splitting' : 'Split My Share';

  // Stage 1: mode picker
  if (mode === 'pick') {
    return (
      <ScreenContainer>
        {/* Header */}
        <div className="px-5 pt-12 pb-6">
          <div className="flex items-center justify-between mb-6">
            <BackButton screen="people" />
            <p className="text-xs font-semibold text-muted">SplitSnap</p>
          </div>
          <h2 className="font-display text-4xl font-bold text-primary leading-tight mb-2">
            Who's<br />Joining?
          </h2>
          <p className="text-muted text-sm">
            Choose how you want to settle this ledger. Start splitting with people.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-32 space-y-4">
          {/* Mode cards */}
          <div className="grid grid-cols-3 gap-2">
            {/* Just me */}
            <motion.button
              onClick={() => {
                if (people.length === 0) addPerson('Me');
                setScreen('claim');
              }}
              className="flex flex-col items-center gap-2 p-4 bg-surface border-2 border-border rounded-2xl text-center"
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-2xl">👤</span>
              <p className="text-xs font-semibold text-primary">Just Me</p>
              <p className="text-[10px] text-muted leading-tight">Solo claim of the entire bill</p>
            </motion.button>

            {/* Whole table */}
            <motion.button
              onClick={() => setMode('whole')}
              className="flex flex-col items-center gap-2 p-4 bg-surface border-2 border-border rounded-2xl text-center"
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-2xl">👥</span>
              <p className="text-xs font-semibold text-primary">Whole Table</p>
              <p className="text-[10px] text-muted leading-tight">Everyone splits together</p>
            </motion.button>

            {/* Some of us */}
            <motion.button
              onClick={() => setMode('some')}
              className="flex flex-col items-center gap-2 p-4 border-2 rounded-2xl text-center border-accent bg-accent/5"
              whileTap={{ scale: 0.97 }}
            >
              <span className="text-2xl">✂️</span>
              <p className="text-xs font-semibold text-accent">Some of us</p>
              <p className="text-[10px] text-accent/60 leading-tight">Pick guests to split</p>
            </motion.button>
          </div>
        </div>
      </ScreenContainer>
    );
  }

  // Stage 2: people-adding UI
  return (
    <ScreenContainer>
      {/* Header */}
      <div className="px-5 pt-12 pb-6">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => setMode('pick')}
            className="flex items-center gap-0.5 text-sm font-medium text-muted hover:text-primary transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            <span>Change mode</span>
          </button>
          <p className="text-xs font-semibold text-muted">SplitSnap</p>
        </div>
        <h2 className="font-display text-4xl font-bold text-primary leading-tight mb-2">
          Who's<br />Joining?
        </h2>
        <p className="text-muted text-sm">
          {mode === 'whole' ? 'Add everyone at the table.' : 'Add the people splitting with you.'}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-5 pb-36 space-y-5">
        {/* The Ledger section */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-display text-xs font-bold text-primary uppercase tracking-widest">
              The Ledger
            </h3>
            <span className="text-xs text-muted font-medium">{people.length} {people.length === 1 ? 'person' : 'people'} added</span>
          </div>

          <div className="bg-surface border border-border rounded-2xl overflow-hidden">
            <AnimatePresence mode="popLayout">
              {/* Me person */}
              {mePerson && (
                <motion.div
                  key={mePerson.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 px-4 py-3.5 border-b border-border"
                >
                  <Avatar initials={getPersonInitials(mePerson.name || 'Me')} color={mePerson.color} size="md" />
                  <input
                    className="flex-1 text-sm font-medium text-primary bg-transparent outline-none"
                    value={mePerson.name}
                    onChange={(e) => updatePersonName(mePerson.id, e.target.value)}
                    placeholder="Your name"
                  />
                  <span className="text-[10px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Primary
                  </span>
                </motion.div>
              )}

              {/* Guests */}
              {guests.map((person) => (
                <motion.div
                  key={person.id}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="flex items-center gap-3 px-4 py-3.5 border-b border-border last:border-b-0"
                >
                  <Avatar initials={getPersonInitials(person.name || '?')} color={person.color} size="md" />
                  <input
                    className="flex-1 text-sm font-medium text-primary bg-transparent outline-none"
                    value={person.name}
                    onChange={(e) => updatePersonName(person.id, e.target.value)}
                    placeholder="Name"
                  />
                  <button onClick={() => removePerson(person.id)} className="text-muted p-1">
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Add guest input */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
              <UserPlus className="w-4 h-4 text-muted flex-shrink-0" />
              <input
                className="flex-1 text-sm text-primary bg-transparent outline-none placeholder:text-muted"
                placeholder="Add guest by name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
              {newName.trim() && (
                <motion.button
                  onClick={() => handleAdd()}
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="text-accent font-semibold text-sm"
                >
                  Add
                </motion.button>
              )}
            </div>
          </div>
        </div>

        {/* Quick add */}
        <div>
          <p className="text-xs text-muted font-medium mb-2">Quick add</p>
          <div className="flex gap-2">
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => handleQuickAdd(n)}
                className="px-3 py-1.5 bg-surface border border-border rounded-full text-xs text-muted font-medium"
              >
                +{n} guests
              </button>
            ))}
          </div>
        </div>

        {/* Frequent splitters placeholder */}
        <div>
          <h3 className="font-display text-xs font-bold text-primary uppercase tracking-widest mb-2">Frequent Splitters</h3>
          <p className="text-xs text-muted">—</p>
        </div>
      </div>

      {/* CTA */}
      <div className="fixed bottom-0 left-0 right-0 p-5 bg-bg/95 backdrop-blur-md border-t border-border">
        <motion.button
          onClick={() => setScreen('claim')}
          className="w-full flex items-center justify-center gap-2 py-4 bg-accent text-white font-bold rounded-2xl shadow-lg shadow-accent/30"
          whileTap={{ scale: 0.97 }}
        >
          {continueLabel}
          <ChevronRight className="w-5 h-5" />
        </motion.button>
      </div>
    </ScreenContainer>
  );
}
