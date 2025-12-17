// src/pages/FirstTimePassword.js
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredUser, changePassword } from '../lib/auth';
import { apiRequest } from '../lib/api';

export default function FirstTimePassword() {
    const navigate = useNavigate();
    const storedUser = getStoredUser();
    const username = storedUser ? storedUser.username : null;

    const [pw1, setPw1] = useState('');
    const [pw2, setPw2] = useState('');
    const [err, setErr] = useState(null);
    const [success, setSuccess] = useState(null);
    const [loading, setLoading] = useState(false);

    // --- handle password change ---
    async function handleSubmit(e) {
        e.preventDefault();
        setErr(null);
        setSuccess(null);
        if (!username) return setErr('No logged-in user found');
        if (!pw1 || !pw2) return setErr('Please enter password twice');
        if (pw1 !== pw2) return setErr('Passwords do not match');
        try {
            setLoading(true);
            await changePassword(username, pw1);
            setSuccess('Password changed successfully. Redirecting...');
            setTimeout(() => navigate('/home', { replace: true }), 1000);
        } catch (e) {
            setErr(e.message || 'Password change failed');
        } finally {
            setLoading(false);
        }
    }

    // --- handle keep current password ---
    async function handleKeepCurrent() {
        setErr(null);
        setSuccess(null);
        if (!username) return setErr('No logged-in user found');
        try {
            setLoading(true);
            // const res = await fetch('/api/auth/keep-current-password', {
            //     method: 'POST',
            //     headers: { 'Content-Type': 'application/json' },
            //     body: JSON.stringify({ username }),
            // });

            const res = await apiRequest('auth/keep-current-password', {
                method: 'POST',
                body: { username }
            });

            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Request failed');
            setSuccess('Keeping your current password. Redirecting...');
            setTimeout(() => navigate('/home', { replace: true }), 1000);
        } catch (e) {
            setErr(e.message || 'Operation failed');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="login-root">
            <div className="login-card">
                <h2 className="login-title">First-Time Login</h2>
                <p className="login-sub">
                    Welcome <strong>{username}</strong>!
                    You can set a new password or keep your current one.
                </p>

                {err && <div className="login-error">{err}</div>}
                {success && <div className="login-success">{success}</div>}

                <form className="login-form" onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>New Password</label>
                        <input
                            type="password"
                            value={pw1}
                            onChange={e => setPw1(e.target.value)}
                            placeholder="Enter new password"
                            disabled={loading}
                        />
                    </div>
                    <div className="form-group">
                        <label>Confirm Password</label>
                        <input
                            type="password"
                            value={pw2}
                            onChange={e => setPw2(e.target.value)}
                            placeholder="Confirm new password"
                            disabled={loading}
                        />
                    </div>
                    <button type="submit button" className="btn login-btn" disabled={loading}>
                        {loading ? 'Processing...' : 'Change Password'}
                    </button>
                </form>

                <div style={{ textAlign: 'center', marginTop: 16 }}>
                    <p style={{ color: 'var(--muted)', fontSize: 14 }}>or</p>
                    <button
                        onClick={handleKeepCurrent}
                        type="button"
                        className="btn login-btn"
                        disabled={loading}
                    >
                        Keep Current Password
                    </button>
                </div>
            </div>
        </div>
    );
}
