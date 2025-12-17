import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import '../styles/Navbar.css';
import { getStoredUser, logout } from '../lib/auth';

const Navbar = ({ currentUser, onLogout }) => {
    const navigate = useNavigate();
    const user = currentUser || getStoredUser();

    function handleLogout() {
        logout();
        if (onLogout) onLogout();
        navigate('/login', { replace: true });
    }

    function hasTablePermission(tableName) {
        if (!user || !user.permissions) return false;
        return user.permissions[tableName] === 1;
    }

    return (
        <nav className="navbar">
            <div className="navbar-brand">
                <Link to={user ? '/home' : '/login'} className="brand-link">
                    SQL Interactinator
                </Link>
            </div>

            {user && (
            <ul className="navbar-links">
                <li>
                    <Link to="/home">Home</Link>
                </li>
                <li>
                    <Link to="/search">Search</Link>
                </li>
                <li>
                    <Link to="/insert">Add/Edit</Link>
                </li>
                {hasTablePermission('employees') && (
                    <li>
                        <Link to="/manage-users">Manage Users</Link>
                    </li>
                )}
                <li className="logout-item">
                    <button onClick={handleLogout} className="logout-btn">
                        Logout
                    </button>
                </li>
            </ul>
            )}
        </nav>
    );
};

export default Navbar;
