import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useGoogleSSO } from '../hooks/useGoogleSSO';
import { Recycle, AlertCircle, Loader2 } from 'lucide-react';

export function LoginPage() {
  const { isAuthenticated } = useAuthStore();
  const { buttonContainerRef, error, gsiReady } = useGoogleSSO();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-gray-50">
      {/* Background decoration */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-b from-emerald-100/60 to-transparent rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-gradient-to-tl from-teal-50 to-transparent rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm mx-auto px-4 animate-zoom-in">
        <div className="bg-white/90 backdrop-blur-xl rounded-2xl shadow-xl shadow-gray-900/10 border border-white/60 p-8">
          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <div className="w-14 h-14 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl flex items-center justify-center mb-4
                            shadow-lg shadow-emerald-500/25">
              <Recycle className="text-white" size={26} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Welcome back</h1>
            <p className="text-sm text-gray-400 mt-1">Sign in to Cirtell</p>
          </div>

          {/* Error */}
          {error && (
            <div className="animate-slide-up mb-5 flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Loading */}
          {!gsiReady && !error && (
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-5">
              <Loader2 size={16} className="animate-spin" />
              Preparing sign-in…
            </div>
          )}

          {/* Google SSO button */}
          <div className="flex justify-center" ref={buttonContainerRef} />

          <div className="mt-8 pt-5 border-t border-gray-100">
            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              By signing in, you agree to the processing of your Google account data.
              Only authorized accounts may access this platform.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
