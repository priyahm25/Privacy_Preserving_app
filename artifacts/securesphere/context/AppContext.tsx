import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth, useClerk, useUser } from '@clerk/expo';
import { CURRENT_USER, User } from '@/data/mockData';
import { provisionDeviceKey } from '@/lib/deviceKeys';

const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

interface AppContextType {
  isAuthenticated: boolean;
  hasCompletedOnboarding: boolean;
  isLoading: boolean;
  currentUser: User;
  darkMode: boolean;
  notificationCount: number;
  /** False until the Clerk account has a matching row in Postgres. */
  isProfileSynced: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  completeOnboarding: () => Promise<void>;
  toggleDarkMode: () => void;
  decrementNotifications: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const { signOut } = useClerk();

  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isAppLoading, setIsAppLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(true);
  const [notificationCount, setNotificationCount] = useState(2);
  const [isProfileSynced, setIsProfileSynced] = useState(false);

  useEffect(() => {
    const loadAppSettings = async () => {
      try {
        const onboarding = await AsyncStorage.getItem('hasCompletedOnboarding');
        setHasCompletedOnboarding(onboarding === 'true');
      } finally {
        setIsAppLoading(false);
      }
    };

    loadAppSettings();
  }, []);

  /**
   * Mirror the Clerk account into Postgres.
   *
   * Clerk owns identity, but every server-side feature - inviting teammates,
   * listing teammates, sharing a file - joins against the `users` table and
   * returns "User not found" when the row is missing. Nothing else calls this
   * endpoint, so without it a freshly signed-up account can authenticate
   * successfully and still have every one of those features fail.
   *
   * Runs on each sign-in; the endpoint upserts, so repeating it is harmless.
   */
  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      setIsProfileSynced(false);
      return;
    }

    const email = user.primaryEmailAddress?.emailAddress;
    if (!email) {
      return;
    }

    let cancelled = false;

    const syncProfile = async () => {
      try {
        const token = await getToken();
        if (!token || cancelled) {
          return;
        }

        const response = await fetch(`${API_BASE_URL}/api/teammates/sync-user`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email,
            name: user.fullName || user.firstName || null,
          }),
        });

        if (cancelled) {
          return;
        }

        if (response.ok) {
          await provisionDeviceKey(user.id, (path, init = {}) => {
            const headers = new Headers(init.headers ?? {});
            headers.set('Authorization', `Bearer ${token}`);
            if (!headers.has('Content-Type') && init.body !== undefined) headers.set('Content-Type', 'application/json');
            return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
          });
          setIsProfileSynced(true);
        } else {
          console.warn('Profile sync failed with status', response.status);
          setIsProfileSynced(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Profile sync request failed:', err);
          setIsProfileSynced(false);
        }
      }
    };

    syncProfile();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, user?.id]);

  const currentUser: User = {
    ...CURRENT_USER,
    id: user?.id ?? CURRENT_USER.id,
    name: user?.fullName || user?.firstName || CURRENT_USER.name,
    email: user?.primaryEmailAddress?.emailAddress ?? CURRENT_USER.email,
  };

  // These are temporary safeguards. The real Clerk logic is added
  // directly to your existing login and register buttons next.
  const login = async (_email: string, _password: string) => {
    throw new Error('Use Clerk sign-in flow');
  };

  const register = async (_name: string, _email: string, _password: string) => {
    throw new Error('Use Clerk sign-up flow');
  };

  const logout = async () => {
    try {
      await signOut();
    } catch (err) {
      console.warn('Sign out error in AppContext:', err);
    }
  };

  const completeOnboarding = async () => {
    setHasCompletedOnboarding(true);
    await AsyncStorage.setItem('hasCompletedOnboarding', 'true');
  };

  const toggleDarkMode = () => setDarkMode((previous) => !previous);

  const decrementNotifications = () =>
    setNotificationCount((previous) => Math.max(0, previous - 1));

  return (
    <AppContext.Provider
      value={{
        isAuthenticated: Boolean(isSignedIn),
        hasCompletedOnboarding,
        isLoading: isAppLoading || !isLoaded,
        currentUser,
        darkMode,
        notificationCount,
        isProfileSynced,
        login,
        logout,
        register,
        completeOnboarding,
        toggleDarkMode,
        decrementNotifications,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);

  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }

  return context;
}
