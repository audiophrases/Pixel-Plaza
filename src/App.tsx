import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Game from './pages/Game';
import Studio from './pages/Studio';
import Teacher from './pages/Teacher';
import MissionStudio from './pages/MissionStudio';

function App() {
  return (
    <BrowserRouter>
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
