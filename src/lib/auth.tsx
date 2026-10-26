import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, loadSession, onSession, saveSession, Session } from './api';
import { normalizeImageDetails, pickDisplayableImageUri } from './images';

type AuthCtx = {
  session: Session | null;
  user: Session['user'] | null;
  login: (email: string, password: string) => Promise<Session>;
  logout: () => void;
  updateUser: (patch: Partial<Session['user']>) => void;
};

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

/** Build a session from the /auth/v2/login (or register) response `data` ({ accessToken, refreshToken, data: user }). */
export function sessionFromAuthResponse(resData: any, fallbackEmail = ''): Session {
  const { accessToken, refreshToken, data: u = {} } = resData || {};
  return {
    user: {
      id: String(u.userId ?? u._id ?? u.email ?? fallbackEmail),
      email: String(u.email ?? fallbackEmail),
      name: String(u.fullName ?? u.userName ?? u.email ?? fallbackEmail),
      emailVerified: u.emailVerified,
      roleSelected: u.roleSelected,
      imageUrl: pickDisplayableImageUri(normalizeImageDetails(u.imageDetails)) ?? '',
      phone: u.phone ?? u.phoneNumber,
    },
    accessToken,
    refreshToken: refreshToken ?? accessToken,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  useEffect(() => {
    const off = onSession(setSession);
    return () => {
      off();
    };
  }, []);

  const value: AuthCtx = {
    session,
    user: session?.user ?? null,
    async login(email, password) {
      const { data: res } = await api.post('/auth/v2/login', { email: email.trim().toLowerCase(), password });
      if (!res?.success || !res?.data) {
        const m = String(res?.message ?? '');
        throw new Error(/invalid|incorrect|credential|password/i.test(m) ? 'Incorrect email or password.' : m || 'Login failed.');
      }
      const s = sessionFromAuthResponse(res.data, email);
      saveSession(s);
      return s;
    },
    logout() {
      saveSession(null);
    },
    updateUser(patch) {
      const s = loadSession();
      if (s) saveSession({ ...s, user: { ...s.user, ...patch } });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
