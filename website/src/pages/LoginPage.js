import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../lib/auth';
import '../styles/LoginPage.css';

export default function LoginPage({ onLogin }) {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [err, setErr] = useState(null);
    const navigate = useNavigate();

    async function handleSubmit(e) {
        e.preventDefault();
        setErr(null);
        try {
            const user = await login(username, password);

            // Process and store allowed permissions
            const allowedPermissions = Object.entries(user.permissions || {})
                .filter(([_, v]) => Number(v) === 1)
                .map(([k]) => String(k).toLowerCase());
            localStorage.setItem("allowedPermissions", JSON.stringify(allowedPermissions));

            if (onLogin) onLogin(user);
            if (user.first_time_login) {
                navigate('/first-time-password', { replace: true });
            } else {
                navigate('/home', { replace: true });
            }
        } catch (e) {
            setErr(e.message || 'Login failed');
        }
    }

    return (
        <div className="login-root">
            <div className="login-card">
                <h2 className="login-title">Welcome Back</h2>
                <p className="login-sub">Sign in to continue to your dashboard</p>

                {err && <div className="login-error">{err}</div>}

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label>Email</label>
                        <input
                            type="email"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            placeholder="Enter your email"
                        />
                    </div>

                    <div className="form-group">
                        <label>Password</label>
                        <div className="password-wrapper">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                onPaste={e => e.preventDefault()} // Disable paste
                                required
                                placeholder="Enter your password"
                            />
                            <button
                                type="button"
                                className="show-password-btn"
                                onClick={() => setShowPassword(!showPassword)}
                                aria-label="Toggle password visibility"
                            >
                                {showPassword ? '🔓' : '🔒'}
                            </button>
                        </div>
                    </div>

                    <button type="submit" className="btn login-btn">
                        Login
                    </button>
                </form>
            </div>
        </div>
    );
}
