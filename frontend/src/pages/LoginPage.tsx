import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useGoogleSSO } from '../hooks/useGoogleSSO';
import { AlertCircle, Loader2, Moon, Recycle, Sun } from 'lucide-react';

export function LoginPage() {
  const { isAuthenticated } = useAuthStore();
  const { buttonContainerRef, error, gsiReady } = useGoogleSSO();
  const [isLightMode, setIsLightMode] = useState(
    () => window.localStorage.getItem('cirtell-login-theme') === 'light',
  );

  const toggleLoginTheme = () => {
    const nextMode = !isLightMode;
    setIsLightMode(nextMode);
    window.localStorage.setItem('cirtell-login-theme', nextMode ? 'light' : 'dark');
  };

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row overflow-hidden bg-midnight">
      <div className="hidden lg:flex lg:w-[58%] relative flex-col justify-end overflow-hidden bg-[#0c0c0c]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(37,149,123,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(37,149,123,0.08)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/50" />

        <div className="relative z-10 p-8 pb-12 max-w-xl">
          <div className="w-12 h-12 rounded-apple-xl bg-signal-teal/15 border border-signal-teal/20 flex items-center justify-center mb-8">
            <Recycle className="text-verified-green" size={24} />
          </div>
          <h2 className="font-display text-[40px] font-light leading-[1.15] text-white/85 tracking-tight">
            Smarter <span className="font-semibold text-white">inventory</span>,
            <br />
            powered by <span className="text-signal-teal font-medium">circular intelligence</span>
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/40 max-w-sm">
            Track materials, reduce waste, and unlock the full value of your circular economy operations.
          </p>
        </div>
      </div>

      <div
        className={'relative flex min-h-screen flex-1 flex-col transition-colors duration-300 lg:w-[42%] ' +
          (isLightMode ? 'bg-white' : 'bg-[#111111]')}
      >
        <button
          type="button"
          onClick={toggleLoginTheme}
          className={'absolute right-5 top-5 z-20 inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-teal focus-visible:ring-offset-2 ' +
            (isLightMode
              ? 'border-gray-200 bg-gray-50 text-gray-400 hover:bg-gray-100 hover:text-gray-700'
              : 'border-white/10 bg-white/[0.04] text-white/35 hover:bg-white/[0.08] hover:text-white/70 focus-visible:ring-offset-[#111111]')}
          aria-label={isLightMode ? 'Use dark login theme' : 'Use light login theme'}
          title={isLightMode ? 'Use dark mode' : 'Use light mode'}
        >
          {isLightMode ? <Moon size={16} aria-hidden="true" /> : <Sun size={16} aria-hidden="true" />}
        </button>

        <div className="flex flex-1 flex-col justify-center px-6 lg:px-12 xl:px-16">
          <div className="w-full max-w-[400px] mx-auto">
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-apple-md bg-deep-teal flex items-center justify-center">
                  <Recycle className="text-verified-green" size={20} />
                </div>
                <span className={'font-display text-xl font-semibold ' + (isLightMode ? 'text-gray-900' : 'text-white')}>Cirtell</span>
              </div>
              <h1 className={'mb-2 text-[28px] font-semibold tracking-tight ' + (isLightMode ? 'text-gray-900' : 'text-white')}>
                Welcome back
              </h1>
              <p className={'text-caption leading-relaxed ' + (isLightMode ? 'text-gray-500' : 'text-white/45')}>
                Sign in to access your circular economy dashboard and inventory insights.
              </p>
            </div>

            {error && (
              <div className={'mb-5 flex items-start gap-2.5 rounded-apple-md border px-4 py-3 text-caption ' +
                (isLightMode ? 'border-red-200 bg-red-50 text-red-700' : 'border-red-500/20 bg-red-500/10 text-red-300')}
              >
                <AlertCircle size={16} className="shrink-0 mt-0.5 opacity-70" />
                <span>{error}</span>
              </div>
            )}

            {!gsiReady && !error && (
              <div className={'mb-5 flex items-center justify-center gap-2 text-caption ' + (isLightMode ? 'text-gray-500' : 'text-white/45')}>
                <Loader2 size={16} className="animate-spin" />
                Preparing sign-in...
              </div>
            )}

            <div className={'rounded-apple-lg border p-5 ' + (isLightMode ? 'border-gray-200 bg-gray-50' : 'border-white/[0.08] bg-white/[0.04]')}>
              <div className="flex justify-center" ref={buttonContainerRef} />
            </div>

            <div className={'mt-5 border-t pt-5 ' + (isLightMode ? 'border-gray-200' : 'border-white/[0.08]')}>
              <p className={'text-center text-micro leading-relaxed ' + (isLightMode ? 'text-gray-400' : 'text-white/35')}>
                By signing in, you agree to the processing of your Google account data.
                Only authorized accounts may access this platform.
              </p>
            </div>
          </div>
        </div>

        <footer className="py-5 px-6 lg:px-8 text-center">
          <p className={'text-micro tracking-wide ' + (isLightMode ? 'text-gray-400' : 'text-white/35')}>
            (c) {new Date().getFullYear()} Cirtell - Inventory Intelligence
          </p>
        </footer>
      </div>
    </div>
  );
}
