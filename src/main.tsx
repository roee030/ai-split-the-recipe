import ReactDOM from 'react-dom/client';
import { SplitSessionProvider } from './context/SplitSessionContext';
import { AppRouter } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <SplitSessionProvider>
    <AppRouter />
  </SplitSessionProvider>
);
