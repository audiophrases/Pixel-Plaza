import { useEffect, useRef } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import Login from './pages/Login';
import Game from './pages/Game';
import Studio from './pages/Studio';
import Teacher from './pages/Teacher';
import MissionStudio from './pages/MissionStudio';

function StudentFullscreen() {
  const { pathname } = useLocation();
  const attempted = useRef(false);

  useEffect(() => {
    if ((pathname !== '/' && pathname !== '/game') || attempted.current) return;
    const enterFullscreen = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      attempted.current = true;
      document.removeEventListener('click', enterFullscreen, true);
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      // Call within the click itself so the browser still has user activation.
      // A denied request must leave the student's original click working.
      try { void document.documentElement.requestFullscreen().catch(() => {}); } catch { /* unsupported browser */ }
    };
    document.addEventListener('click', enterFullscreen, true);
    return () => document.removeEventListener('click', enterFullscreen, true);
  }, [pathname]);

  return null;
}

function App() {
  return (
    <BrowserRouter>
      <StudentFullscreen />
      <div className="app-container">
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/game" element={<Game />} />
          <Route path="/teacher" element={<Teacher />} />
          <Route path="/studio" element={<Studio />} />
          <Route path="/mission-studio" element={<MissionStudio />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
