import { useCallback, useEffect, useRef, useState } from 'react';
import { clearToken } from '../lib/authToken';
import { apiRequest } from '../lib/api';
import { useAuthStore, type AuthContextPayload, type AuthUser } from '../stores/authStore';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
  auto_select?: boolean;
  button_auto_select?: boolean;
  cancel_on_tap_outside?: boolean;
  use_fedcm_for_prompt?: boolean;
  use_fedcm_for_button?: boolean;
}

interface GoogleButtonConfiguration {
  type: 'standard';
  theme: 'outline';
  size: 'large';
  text: 'signin_with';
  shape: 'rectangular';
  width: number;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfiguration) => void;
          prompt: () => void;
          renderButton: (element: HTMLElement, config: GoogleButtonConfiguration) => void;
          disableAutoSelect: () => void;
          revoke: (email: string, callback?: () => void) => void;
        };
      };
    };
  }
}

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

interface UseGoogleSSOOptions {
  initialize?: boolean;
  oneTap?: boolean;
}

export function useGoogleSSO(options: UseGoogleSSOOptions = {}) {
  const shouldInitialize = options.initialize ?? true;
  const shouldPromptOneTap = options.oneTap ?? false;
  const { setUser, logout: storeLogout } = useAuthStore();
  const initializedRef = useRef(false);
  const buttonContainerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gsiReady, setGsiReady] = useState(false);

  const handleCredentialResponse = useCallback(
    async (response: GoogleCredentialResponse) => {
      setError(null);
      try {
        const result = await apiRequest<{
          success: boolean;
          user: AuthUser;
          message?: string;
          error?: string;
        } & AuthContextPayload>(
          '/api/auth/validate',
          { method: 'POST', redirectOnUnauthorized: false, authToken: response.credential },
        );
        if (result.success && result.user) {
          clearToken();
          setUser(result.user, result);
        } else {
          setError(result.message || result.error || 'Login failed');
          clearToken();
        }
      } catch (err: unknown) {
        console.error('Login failed:', err);
        setError(err instanceof Error ? err.message : 'Login failed. Please try again.');
        clearToken();
      }
    },
    [setUser],
  );

  const renderButton = useCallback(() => {
    if (!window.google || !buttonContainerRef.current) return;
    buttonContainerRef.current.innerHTML = '';
    window.google.accounts.id.renderButton(buttonContainerRef.current, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'rectangular',
      width: 300,
    });
  }, []);

  const initGoogle = useCallback(() => {
    if (!shouldInitialize || !window.google || initializedRef.current) return;

    if (!GOOGLE_CLIENT_ID) {
      setError('Google Sign-In is not configured. Missing VITE_GOOGLE_CLIENT_ID.');
      setGsiReady(true);
      return;
    }

    initializedRef.current = true;

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      button_auto_select: false,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true,
      use_fedcm_for_button: true,
    });

    renderButton();
    if (shouldPromptOneTap) {
      window.google.accounts.id.prompt();
    }
  }, [handleCredentialResponse, renderButton, shouldInitialize, shouldPromptOneTap]);

  useEffect(() => {
    if (!shouldInitialize) return;

    if (window.google) {
      const readyTimer = window.setTimeout(() => {
        initGoogle();
        setGsiReady(true);
      }, 0);
      return () => window.clearTimeout(readyTimer);
    } else {
      const interval = setInterval(() => {
        if (window.google) {
          clearInterval(interval);
          initGoogle();
          setGsiReady(true);
        }
      }, 100);

      // Timeout after 5 seconds if GSI never loads
      const timeout = setTimeout(() => {
        clearInterval(interval);
        if (!window.google) {
          setError('Google Sign-In failed to load. Check your browser extensions or network.');
        }
      }, 5000);

      return () => { clearInterval(interval); clearTimeout(timeout); };
    }
  }, [initGoogle, shouldInitialize]);

  const logout = useCallback(() => {
    const user = useAuthStore.getState().user;
    if (user && window.google) {
      window.google.accounts.id.disableAutoSelect();
      window.google.accounts.id.revoke(user.email, () => {});
    }
    void apiRequest('/api/auth/logout', {
      method: 'POST',
      redirectOnUnauthorized: false,
    }).catch(() => {});
    clearToken();
    storeLogout();
    initializedRef.current = false;
  }, [storeLogout]);

  return { buttonContainerRef, logout, error, gsiReady };
}
