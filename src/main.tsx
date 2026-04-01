import ReactDOM from 'react-dom/client';
import { AuthProvider } from './context/AuthContext';
import { SplitSessionProvider } from './context/SplitSessionContext';
import { AppRouter } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <SplitSessionProvider>
      <AppRouter />
    </SplitSessionProvider>
  </AuthProvider>
);
