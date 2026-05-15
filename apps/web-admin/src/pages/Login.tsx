import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginWithGoogle, loginAsDev, loginWithSeed } from '../api/auth';
import { Spinner } from '../components/ui/Spinner';
import { Toaster } from '../components/ui/Toast';
import { toast } from '../store/toast';

export default function Login() {
  const navigate = useNavigate();
  const [loading, setLoading]       = useState(false);
  const [showDemo, setShowDemo]     = useState(false);
  const [demoUser, setDemoUser]     = useState('');
  const [demoPass, setDemoPass]     = useState('');
  const [showPass, setShowPass]     = useState(false);

  const handleSeedLogin = async () => {
    if (!demoUser || !demoPass) { toast.error('Enter username and password'); return; }
    setLoading(true);
    try {
      await loginWithSeed(demoUser, demoPass);
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    try {
      await loginWithGoogle();
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleDevLogin = async () => {
    setLoading(true);
    try {
      await loginAsDev();
      navigate('/dashboard');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Dev login failed — is the API server running?';
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 flex items-center justify-center"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 15% 15%, rgba(124,58,237,.25) 0%, transparent 55%), ' +
            'radial-gradient(ellipse 70% 70% at 85% 85%, rgba(34,211,238,.12) 0%, transparent 55%), #05050A',
        }}
      >
        {/* Blobs */}
        <div
          className="absolute pointer-events-none"
          style={{
            width: 400, height: 400, borderRadius: '50%',
            background: 'radial-gradient(circle,rgba(124,58,237,.15),transparent 70%)',
            top: -100, left: -100, filter: 'blur(40px)',
          }}
        />
        <div
          className="absolute pointer-events-none"
          style={{
            width: 300, height: 300, borderRadius: '50%',
            background: 'radial-gradient(circle,rgba(34,211,238,.1),transparent 70%)',
            bottom: -50, right: -50, filter: 'blur(40px)',
          }}
        />

        {/* Card */}
        <div
          className="relative w-[420px] animate-fade-up"
          style={{
            padding: 40,
            background: 'rgba(255,255,255,.04)',
            border: '1px solid rgba(255,255,255,.1)',
            borderRadius: 24,
            backdropFilter: 'blur(20px)',
          }}
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <div
              className="inline-flex items-center justify-center w-14 h-14 grad-bg rounded-2xl mb-3.5 text-[28px]"
              style={{ boxShadow: '0 0 32px rgba(124,58,237,.5)' }}
            >
              ⚡
            </div>
            <div className="text-2xl font-black tracking-tight grad-text">EDGE GYM</div>
            <div className="text-slate-500 text-[13px] mt-1">Control Panel · v1.0</div>
          </div>

          {/* Google Sign-In */}
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2.5 bg-white text-gray-800 rounded-[10px] py-3 px-5 font-semibold text-sm transition-shadow hover:shadow-[0_4px_20px_rgba(255,255,255,.15)] disabled:opacity-60"
          >
            {loading ? (
              <Spinner size={18} className="text-gray-500" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
            )}
            Continue with Google
          </button>

          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-white/[0.08]" />
            <span className="text-xs text-dimmed">or</span>
            <div className="flex-1 h-px bg-white/[0.08]" />
          </div>

          {/* Demo / Seed login */}
          {!showDemo ? (
            <button
              onClick={() => setShowDemo(true)}
              className="w-full text-center text-xs text-slate-500 hover:text-slate-400 transition-colors py-1"
            >
              Demo / Client Login →
            </button>
          ) : (
            <div className="space-y-3">
              <div>
                <input
                  type="text"
                  placeholder="Username (e.g. GYMDEMO)"
                  value={demoUser}
                  onChange={(e) => setDemoUser(e.target.value)}
                  autoComplete="username"
                  className="w-full px-4 py-2.5 rounded-[10px] text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-purple-500/50 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
              </div>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  placeholder="Password"
                  value={demoPass}
                  onChange={(e) => setDemoPass(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleSeedLogin()}
                  autoComplete="current-password"
                  className="w-full px-4 py-2.5 rounded-[10px] text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-purple-500/50 transition-colors"
                  style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                  tabIndex={-1}
                >
                  {showPass ? (
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  ) : (
                    <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  )}
                </button>
              </div>
              <button
                onClick={() => void handleSeedLogin()}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-[10px] py-2.5 px-5 font-semibold text-sm transition-all disabled:opacity-60"
                style={{ background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)', color: '#c4b5fd' }}
              >
                {loading ? <Spinner size={16} className="text-purple-400" /> : null}
                Sign In
              </button>
              <button onClick={() => setShowDemo(false)} className="w-full text-xs text-slate-600 hover:text-slate-400 text-center py-1">
                ← Back to Google Login
              </button>
            </div>
          )}

          {/* Dev login — only shown in local Vite dev mode */}
          {import.meta.env.DEV && !showDemo && (
            <button
              onClick={() => void handleDevLogin()}
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-[10px] py-2.5 px-5 font-semibold text-sm transition-all disabled:opacity-60 mt-2"
              style={{ background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)', color: '#10b981' }}
            >
              {loading ? <Spinner size={16} className="text-emerald-400" /> : '🧪'}
              Dev Login (local only)
            </button>
          )}

          <p className="text-center text-xs text-dimmed mt-4">
            Secured by EDGE · Only authorized gym staff may sign in
          </p>
        </div>
      </div>
      <Toaster />
    </>
  );
}
