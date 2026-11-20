import { StoreProvider, useStore } from './state/store.jsx';
import TopBar from './components/TopBar.jsx';
import DetailPanel from './components/DetailPanel.jsx';
import PinsPanel from './components/PinsPanel.jsx';
import WebView from './views/WebView.jsx';
import MapView from './views/MapView.jsx';
import ClustersView from './views/ClustersView.jsx';
import ToolsView from './views/ToolsView.jsx';

function Shell() {
  const { mode, toast, metaError } = useStore();

  if (metaError) {
    return (
      <div className="fatal">
        <h1>The backend is not reachable</h1>
        <p className="mono">{metaError}</p>
        <p className="muted">Start it with <code>run.ps1</code> / <code>run.sh</code>, or <code>uvicorn backend.app:app --port 8000</code> from the repo root.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <TopBar />
      <div className="body">
        <div className="side">
          <DetailPanel />
          <PinsPanel />
        </div>
        <main className="main">
          {mode === 'web' && <WebView />}
          {mode === 'map' && <MapView />}
          {mode === 'clusters' && <ClustersView />}
          {mode === 'tools' && <ToolsView />}
        </main>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
