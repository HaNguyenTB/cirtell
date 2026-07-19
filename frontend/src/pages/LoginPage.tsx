import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useGoogleSSO } from '../hooks/useGoogleSSO';
import { AlertCircle, Loader2, Moon, Recycle, ShieldCheck, Sun } from 'lucide-react';

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

  if (isAuthenticated) return <Navigate to="/" replace />;

  const foreground = isLightMode ? 'text-gray-900' : 'text-white';
  const secondary = isLightMode ? 'text-gray-500' : 'text-white/50';
  const muted = isLightMode ? 'text-gray-400' : 'text-white/35';

  return (
    <main className="grid min-h-[100svh] overflow-hidden bg-[#0c0c0c] lg:grid-cols-[minmax(0,1.15fr)_minmax(430px,0.85fr)]">
      <section className="relative hidden min-h-[100svh] overflow-hidden bg-[#0c0c0c] px-10 py-9 lg:flex lg:flex-col lg:justify-between xl:px-14 xl:py-12">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(37,149,123,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(37,149,123,0.07)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/70" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-apple-md bg-deep-teal shadow-lg shadow-black/20">
            <Recycle className="text-verified-green" size={20} />
          </div>
          <span className="font-display text-xl font-semibold text-white">Cirtell</span>
        </div>

        <div className="relative z-10 max-w-[620px] pb-2">
          <div className="mb-6 flex items-center gap-3 text-micro font-semibold uppercase text-verified-green/80">
            <span className="h-px w-8 bg-verified-green/60" />
            Circular inventory intelligence
          </div>
          <h2 className="max-w-[590px] font-display text-[44px] font-light leading-[1.08] text-white/85 xl:text-[52px]">
            See where every part goes,
            <span className="font-semibold text-white"> and what it saves.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[15px] leading-7 text-white/45">
            One operational view for parts, transactions, warehouse stock, projects, and carbon impact.
          </p>
        </div>
      </section>

      <section
        className={'relative flex min-h-[100svh] flex-col overflow-hidden border-white/5 transition-colors duration-300 lg:border-l ' +
          (isLightMode ? 'bg-white' : 'bg-[#111111]')}
      >
        <div
          className={'pointer-events-none absolute inset-0 bg-[linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] bg-[size:64px_64px] transition-colors ' +
            (isLightMode ? 'text-gray-900/[0.025]' : 'text-white/[0.018]')}
        />

        <div className="absolute left-6 top-5 z-20 flex items-center gap-2.5 lg:hidden">
          <div className="flex h-9 w-9 items-center justify-center rounded-apple-md bg-deep-teal">
            <Recycle className="text-verified-green" size={18} />
          </div>
          <span className={'font-display text-lg font-semibold ' + foreground}>Cirtell</span>
        </div>

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

        <div className="relative z-10 flex flex-1 items-center px-6 py-24 sm:px-10 lg:px-12 xl:px-16">
          <div className="mx-auto w-full max-w-[420px]">
            <header className="mb-9">
              <p className="mb-3 text-micro font-semibold uppercase text-signal-teal">Secure workspace access</p>
              <h1 className={'font-display text-[32px] font-semibold leading-tight ' + foreground}>Welcome back</h1>
              <p className={'mt-3 max-w-sm text-caption leading-6 ' + secondary}>
                Sign in to continue to your Cirtell workspace.
              </p>
            </header>

            {error && (
              <div className={'mb-5 flex items-start gap-2.5 rounded-apple-md border px-4 py-3 text-caption ' +
                (isLightMode ? 'border-red-200 bg-red-50 text-red-700' : 'border-red-500/20 bg-red-500/10 text-red-300')}
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0 opacity-70" />
                <span>{error}</span>
              </div>
            )}

            <div className={'rounded-apple-lg border p-5 shadow-sm transition-colors ' +
              (isLightMode ? 'border-gray-200 bg-gray-50/80' : 'border-white/[0.09] bg-white/[0.045]')}
            >
              <div className="flex min-h-10 items-center justify-center">
                {!gsiReady && !error && (
                  <div className={'flex items-center gap-2 text-caption ' + secondary}>
                    <Loader2 size={16} className="animate-spin" />
                    Preparing sign-in...
                  </div>
                )}
                <div className={gsiReady ? 'flex justify-center' : 'hidden'} ref={buttonContainerRef} />
              </div>
            </div>

            <div className={'mt-6 flex items-start gap-3 border-t pt-5 ' + (isLightMode ? 'border-gray-200' : 'border-white/[0.08]')}>
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-signal-teal" aria-hidden="true" />
              <p className={'text-micro leading-5 ' + muted}>
                Access is limited to authorized Google accounts. Account data is processed only for authentication.
              </p>
            </div>
          </div>
        </div>

        <footer className="relative z-10 px-6 py-5 text-center">
          <p className={'text-micro ' + muted}>
            &copy; {new Date().getFullYear()} Cirtell. Inventory intelligence.
          </p>
        </footer>
      </section>
    </main>
  );
}
