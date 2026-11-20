import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing.jsx';
import Login from './pages/Login.jsx';
import Consent from './pages/Consent.jsx';
import Study from './pages/Study.jsx';
import Console, { ConsoleLogin } from './pages/admin/Console.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/consent" element={<Consent />} />
        <Route path="/study" element={<Study />} />
        <Route path="/console/login" element={<ConsoleLogin />} />
        <Route path="/console" element={<Console />} />
        <Route path="/console/participants/:id" element={<Console />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
