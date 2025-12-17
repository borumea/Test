import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStoredUser } from '../lib/auth';
import { apiRequest } from '../lib/api';
import '../styles/ManageUsersPage.css';

export default function ManageUsersPage() {
    const currentUser = getStoredUser();
    const [employees, setEmployees] = useState([]);
    const [newUser, setNewUser] = useState('');
    const [oneTimePw, setOneTimePw] = useState('');
    const [newPermissions, setNewPermissions] = useState({});
    const [selectedUser, setSelectedUser] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState(null);
    const [success, setSuccess] = useState(null);
    const [activeTab, setActiveTab] = useState('update');
    const [adminPw, setAdminPw] = useState('');
    const [showPw, setShowPw] = useState(false);
    const navigate = useNavigate();
    const [showOneTimePw, setShowOneTimePw] = useState(false);
    const [viewsMetadata, setViewsMetadata] = useState([]);
    const [singleTableViews, setSingleTableViews] = useState(new Set());

    useEffect(() => {
        if (!currentUser || !currentUser.permissions?.employees) {
            navigate('/home', { replace: true });
        }
    }, [currentUser, navigate]);

    function generateRandomPw() {
        const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
        let pw = '';
        for (let i = 0; i < 12; i++) {
            pw += charset.charAt(Math.floor(Math.random() * charset.length));
        }
        setOneTimePw(pw);
    }

    /**
     * Load all employees from the backend
     */
    async function loadEmployees() {
        setLoading(true);
        setErr(null);
        try {
            const res = await apiRequest('auth/employees', {
                method: 'GET',
            });

            if (!res.ok) {
                throw new Error('Failed to fetch employees');
            }

            const data = await res.json();
            setEmployees(data);

            // Initialize default permissions structure from first employee
            if (data.length > 0) {
                const permissionKeys = Object.keys(data[0]).filter(
                    k => !['username', 'emp_id', 'password', 'first_time_login'].includes(k)
                );
                const defaults = Object.fromEntries(permissionKeys.map(k => [k, 0]));
                setNewPermissions(defaults);
            }
        } catch (e) {
            console.error('Load employees error:', e);
            setErr('Failed to load employees');
        } finally {
            setLoading(false);
        }
    }

    /**
     * Load views metadata to identify single-table views for automatic permission derivation
     */
    async function loadViewsMetadata() {
        try {
            const res = await apiRequest('views/list', {
                method: 'GET',
            });

            if (!res.ok) {
                throw new Error('Failed to fetch views metadata');
            }

            const data = await res.json();
            setViewsMetadata(data.rows || []);

            // Identify single-table views (views with exactly one base table)
            // These views will have their permissions automatically derived from base table access
            const singleViews = new Set();
            (data.rows || []).forEach(view => {
                const baseTables = view.base_tables || [];
                if (baseTables.length === 1) {
                    // Store the lowercase permission column name
                    singleViews.add(view.name.toLowerCase());
                }
            });
            setSingleTableViews(singleViews);
        } catch (e) {
            console.error('Failed to load views metadata:', e);
            // Non-fatal error - continue without view metadata
        }
    }

    useEffect(() => {
        loadEmployees();
        loadViewsMetadata();
    }, []);

    function toggleNewPermission(col) {
        setNewPermissions(prev => {
            const updated = { ...prev, [col]: prev[col] ? 0 : 1 };
            // Calculate derived permissions for single-table views
            return calculateDerivedPermissions(updated);
        });
    }

    function togglePermission(col) {
        if (!selectedUser) return;
        const updated = { ...selectedUser, [col]: selectedUser[col] ? 0 : 1 };
        // Calculate derived permissions for single-table views
        const withDerived = calculateDerivedPermissions(updated);
        setSelectedUser(withDerived);
    }

    function isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    /**
     * Calculate permissions for single-table views based on base table access
     * Single-table views automatically inherit their base table's permission
     * Multi-table views remain independent and must be managed separately
     * 
     * @param {Object} basePermissions - Current permissions object
     * @returns {Object} Updated permissions with derived view permissions
     */
    function calculateDerivedPermissions(basePermissions) {
        const derived = { ...basePermissions };

        viewsMetadata.forEach(view => {
            const baseTables = view.base_tables || [];

            // Only process single-table views
            if (baseTables.length === 1) {
                const viewPermKey = view.name.toLowerCase();
                const baseTablePermKey = baseTables[0].toLowerCase();

                // Inherit base table permission
                if (basePermissions[baseTablePermKey]) {
                    derived[viewPermKey] = basePermissions[baseTablePermKey];
                } else {
                    derived[viewPermKey] = 0;
                }
            }
            // Multi-table views (baseTables.length > 1) are not auto-managed
        });

        return derived;
    }

    /**
     * Save user (create new or update existing)
     * 
     * @param {boolean} isNew - Whether this is a new user creation
     */
    async function handleSave(isNew) {
        setErr(null);
        setSuccess(null);

        if (!adminPw) {
            return setErr('Please verify your password.');
        }

        const targetUser = isNew ? newUser : selectedUser?.username;
        if (!targetUser) {
            return setErr('Username required.');
        }

        if (isNew && !isValidEmail(targetUser)) {
            return setErr('Please enter a valid email address.');
        }

        try {
            // Extract permissions (exclude non-permission fields)
            const permissions = isNew
                ? newPermissions
                : Object.fromEntries(
                    Object.entries(selectedUser).filter(
                        ([k, v]) =>
                            !['username', 'emp_id', 'password', 'first_time_login'].includes(k) &&
                            typeof v === 'number'
                    )
                );

            const payload = {
                creator: currentUser.username,
                adminPassword: adminPw,
                username: targetUser,
                oneTimePassword: isNew ? oneTimePw : undefined,
                permissions: calculateDerivedPermissions(permissions),
            };

            const res = await apiRequest('auth/create-or-update-user', {
                method: 'POST',
                body: payload
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save user');
            }

            setSuccess(`User ${isNew ? 'created' : 'updated'} successfully.`);

            // Reset form
            setAdminPw('');
            if (isNew) {
                setOneTimePw('');
                setNewUser('');
            } else {
                setSelectedUser(null);
            }

            // Reload employee list
            await loadEmployees();
        } catch (e) {
            console.error('Save user error:', e);
            setErr(e.message || 'Failed to save user.');
        }
    }

    /**
     * Delete the selected user
     */
    async function handleDeleteUser() {
        setErr(null);
        setSuccess(null);

        if (!selectedUser) {
            return setErr('No user selected.');
        }

        if (selectedUser.username === currentUser.username) {
            return setErr('You cannot delete your own account.');
        }

        if (!adminPw) {
            return setErr('Please verify your password.');
        }

        // Confirm deletion
        const confirmDelete = window.confirm(
            `Are you sure you want to delete "${selectedUser.username}"?`
        );
        if (!confirmDelete) return;

        try {
            const payload = {
                creator: currentUser.username,
                adminPassword: adminPw,
                username: selectedUser.username,
            };

            const res = await apiRequest('auth/delete-user', {
                method: 'POST',
                body: payload
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to delete user');
            }

            setSuccess(`User "${selectedUser.username}" deleted successfully.`);
            setAdminPw('');
            setSelectedUser(null);

            // Reload employee list
            await loadEmployees();
        } catch (e) {
            console.error('Delete user error:', e);
            setErr(e.message || 'Failed to delete user.');
        }
    }

    const PasswordInput = (
        <div className="password-verify">
            <label>Verify with your password:</label>
            <div className="pw-inline">
                <div className="pw-wrapper">
                    <input
                        type={showPw ? 'text' : 'password'}
                        value={adminPw}
                        onChange={(e) => setAdminPw(e.target.value)}
                        onPaste={(e) => e.preventDefault()}
                        placeholder="Enter your password"
                    />
                    <button
                        type="button"
                        className="pw-toggle"
                        onClick={() => setShowPw(prev => !prev)}
                    >
                        {showPw ? '🔓' : '🔒'}
                    </button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="manage-root" style={{ marginTop: "8vh" }}>
            <div className="manage-container">
                <div className="manage-header">
                    <h1>Manage Users</h1>
                    <p className="sub">Create and update employee accounts & permissions</p>
                </div>

                <div className="tabs">
                    <button
                        className={`tab ${activeTab === 'update' ? 'active' : ''}`}
                        onClick={() => setActiveTab('update')}
                    >
                        Update Users
                    </button>
                    <button
                        className={`tab ${activeTab === 'create' ? 'active' : ''}`}
                        onClick={() => setActiveTab('create')}
                    >
                        Create User
                    </button>
                </div>

                {err && <div className="msg error">{err}</div>}
                {success && <div className="msg success">{success}</div>}

                {loading ? (
                    <p>Loading employees...</p>
                ) : (
                    <>
                        {activeTab === 'update' && (
                            <div className="update-section">
                                <h3>Existing Employees</h3>
                                <div className="table-wrapper">
                                    <table className="user-table">
                                        <thead>
                                            <tr>
                                                {employees.length > 0 &&
                                                    Object.keys(employees[0])
                                                        .filter(c => !['password', 'first_time_login'].includes(c))
                                                        .map(c => <th key={c}>{c}</th>)}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {employees.map(emp => (
                                                <tr
                                                    key={emp.username}
                                                    onClick={() => setSelectedUser(emp)}
                                                    className={selectedUser?.username === emp.username ? 'selected' : ''}
                                                >
                                                    {Object.keys(emp)
                                                        .filter(k => !['password', 'first_time_login'].includes(k))
                                                        .map(k => (
                                                            <td key={k}>{String(emp[k])}</td>
                                                        ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {selectedUser && (
                                    <div className="edit-card">
                                        <h3>Edit Permissions - {selectedUser.username}</h3>
                                        <div className="checkbox-grid">
                                            {Object.keys(selectedUser)
                                                .filter(c => !['username', 'password', 'first_time_login'].includes(c))
                                                .filter(c => !singleTableViews.has(c))
                                                .map(col => (
                                                    <label key={col} className="perm-item">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedUser[col] === 1}
                                                            onChange={() => togglePermission(col)}
                                                            disabled={selectedUser.username === currentUser.username}
                                                        />
                                                        {col}
                                                    </label>
                                                ))}
                                        </div>

                                        {selectedUser.username === currentUser.username && (
                                            <p className="note" style={{ color: 'gray', fontStyle: 'italic' }}>
                                                You cannot edit your own permissions.
                                            </p>
                                        )}

                                        {PasswordInput}
                                        <div className="actions">
                                            <button
                                                type="button"
                                                className="btn"
                                                onClick={() => handleSave(false)}
                                            >
                                                Save Changes
                                            </button>

                                            <button
                                                type="button"
                                                className="btn danger"
                                                style={{ backgroundColor: '#b30000', marginLeft: '10px' }}
                                                onClick={handleDeleteUser}
                                            >
                                                Delete User
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {activeTab === 'create' && (
                            <div className="create-section">
                                <h3>Create New User</h3>
                                <div className="form-field">
                                    <label>Email</label>
                                    <input
                                        type="email"
                                        value={newUser}
                                        onChange={(e) => setNewUser(e.target.value)}
                                        placeholder="Enter email"
                                    />
                                </div>

                                <div className="form-field">
                                    <label>One-Time Password</label>
                                    <div className="pw-inline">
                                        <div className="pw-wrapper">
                                            <input
                                                type={showOneTimePw ? 'text' : 'password'}
                                                value={oneTimePw}
                                                onChange={(e) => setOneTimePw(e.target.value)}
                                                onPaste={(e) => e.preventDefault()}
                                                placeholder="Enter or generate password"
                                            />
                                            <button
                                                type="button"
                                                className="pw-toggle"
                                                onClick={() => setShowOneTimePw((p) => !p)}
                                            >
                                                {showOneTimePw ? '🔓' : '🔒'}
                                            </button>
                                        </div>
                                        <button
                                            type="button"
                                            className="btn"
                                            onClick={generateRandomPw}
                                        >
                                            Generate
                                        </button>
                                    </div>
                                </div>

                                <h4>Set Permissions</h4>
                                <div className="checkbox-grid">
                                    {Object.keys(newPermissions)
                                        .filter(col => !singleTableViews.has(col))
                                        .map(col => (
                                            <label key={col} className="perm-item">
                                                <input
                                                    type="checkbox"
                                                    checked={newPermissions[col] === 1}
                                                    onChange={() => toggleNewPermission(col)}
                                                />
                                                {col}
                                            </label>
                                        ))}
                                </div>

                                {PasswordInput}
                                <div className="actions">
                                    <button type="button" className="btn" onClick={() => handleSave(true)}>
                                        Create User
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}