import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import HomePage from './pages/HomePage';
import SearchPage from './pages/SearchPage';
import InsertPage from './pages/InsertPage';
import LoginPage from './pages/LoginPage';
import FirstTimePassword from './pages/FirstTimePassword';
import ManageUsersPage from './pages/ManageUsersPage';
import './App.css';
import { getStoredUser } from './lib/auth';

function App() {
  const [currentUser, setCurrentUser] = useState(getStoredUser());

  return (
    <Router>
      <Navbar currentUser={currentUser} onLogout={() => setCurrentUser(null)} />
      <AppRoutes currentUser={currentUser} onLogin={setCurrentUser} />
    </Router>
  );
}

function AppRoutes({ currentUser, onLogin }) {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          currentUser ? <Navigate to="/home" replace /> : <LoginPage onLogin={onLogin} />
        }
      />
      <Route
        path="/first-time-password"
        element={<FirstTimePassword onLogin={onLogin} />}
      />
      <Route
        path="/home"
        element={currentUser ? <HomePage currentUser={currentUser} /> : <Navigate to="/login" />}
      />
      <Route
        path="/search"
        element={currentUser ? <SearchPage currentUser={currentUser} /> : <Navigate to="/login" />}
      />
      <Route
        path="/insert"
        element={currentUser ? <InsertPage currentUser={currentUser} /> : <Navigate to="/login" />}
      />
      <Route
        path="/update"
        element={currentUser ? <InsertPage currentUser={currentUser} /> : <Navigate to="/login" />}
      />
      <Route
        path="/manage-users"
        element={
          currentUser && currentUser.permissions?.employees
            ? <ManageUsersPage currentUser={currentUser} />
            : <Navigate to="/login" />
        }
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

export default App;
