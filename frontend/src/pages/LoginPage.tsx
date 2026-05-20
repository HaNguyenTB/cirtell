import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useGoogleSSO } from '../hooks/useGoogleSSO';
import { AlertCircle, ArrowLeft, Loader2, Recycle } from 'lucide-react';

export function LoginPage() {
  const { isAuthenticated } = useAuthStore();
  const { buttonContainerRef, error, gsiReady } = useGoogleSSO();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row overflow-hidden bg-midnight">
      <div className="hidden lg:flex lg:w-[58%] relative flex-col justify-between overflow-hidden bg-[#0c0c0c]">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(37,149,123,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(37,149,123,0.08)_1px,transparent_1px)] bg-[size:56px_56px]" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/50" />

        <div className="relative z-10 p-8">
          <a href="/welcome" className="inline-flex items-center gap-1.5 text-caption text-white/40 hover:text-white/70 transition-colors group">
            <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-0.5" />
            Back
          </a>
        </div>

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

      <div className="flex-1 lg:w-[42%] flex flex-col min-h-screen bg-[#111111]">
        <div className="flex items-center p-6 lg:p-8">
          <a href="/welcome" className="inline-flex lg:hidden items-center gap-1.5 text-caption text-white/40 hover:text-white/70 transition-colors">
            <ArrowLeft className="w-4 h-4" />
            Back
          </a>
        </div>

        <div className="flex-1 flex flex-col justify-center px-6 lg:px-12 xl:px-16">
          <div className="w-full max-w-[400px] mx-auto">
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-apple-md bg-deep-teal flex items-center justify-center">
                  <Recycle className="text-verified-green" size={20} />
                </div>
                <span className="font-display text-xl font-semibold text-white">Cirtell</span>
              </div>
              <h1 className="text-[28px] font-semibold tracking-tight mb-2 text-white">Welcome back</h1>
              <p className="text-caption leading-relaxed text-white/45">
                Sign in to access your circular economy dashboard and inventory insights.
              </p>
            </div>

            {error && (
              <div className="px-4 py-3 rounded-apple-md text-caption mb-5 flex items-start gap-2.5 bg-red-500/10 border border-red-500/20 text-red-300">
                <AlertCircle size={16} className="shrink-0 mt-0.5 opacity-70" />
                <span>{error}</span>
              </div>
            )}

            {!gsiReady && !error && (
              <div className="flex items-center justify-center gap-2 text-caption text-white/45 mb-5">
                <Loader2 size={16} className="animate-spin" />
                Preparing sign-in...
              </div>
            )}

            <div className="rounded-apple-lg border border-white/[0.08] bg-white/[0.04] p-5">
              <div className="flex justify-center" ref={buttonContainerRef} />
            </div>

            <div className="mt-5 pt-5 border-t border-white/[0.08]">
              <p className="text-micro text-white/35 text-center leading-relaxed">
                By signing in, you agree to the processing of your Google account data.
                Only authorized accounts may access this platform.
              </p>
            </div>
          </div>
        </div>

        <footer className="py-5 px-6 lg:px-8 text-center">
          <p className="text-micro tracking-wide text-white/35">
            (c) {new Date().getFullYear()} Cirtell - Inventory Intelligence
          </p>
        </footer>
      </div>
    </div>
  );
}
