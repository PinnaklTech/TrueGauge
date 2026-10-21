import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getMe, type EffectiveSettings } from "@/lib/api";
import {
  DEFAULT_EFFECTIVE,
  formatDate,
  formatDateTime,
  formatTime,
  weekStartsOn,
} from "@/lib/format-settings";

type FormatContextValue = {
  settings: EffectiveSettings;
  ready: boolean;
  refresh: () => Promise<void>;
  formatDate: (v: Date | string | number | null | undefined) => string;
  formatDateTime: (v: Date | string | number | null | undefined) => string;
  formatTime: (v: Date | string | number | null | undefined) => string;
  weekStartsOn: 0 | 1;
};

const FormatContext = createContext<FormatContextValue | null>(null);

export function FormatSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<EffectiveSettings>(DEFAULT_EFFECTIVE);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      if (me.effective_settings) {
        setSettings({ ...DEFAULT_EFFECTIVE, ...me.effective_settings });
      }
    } catch {
      /* keep defaults */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUpdate = () => {
      void refresh();
    };
    window.addEventListener("tg-user-profile-updated", onUpdate);
    window.addEventListener("tg-org-profile-updated", onUpdate);
    return () => {
      window.removeEventListener("tg-user-profile-updated", onUpdate);
      window.removeEventListener("tg-org-profile-updated", onUpdate);
    };
  }, [refresh]);

  const value = useMemo<FormatContextValue>(
    () => ({
      settings,
      ready,
      refresh,
      formatDate: (v) => formatDate(v, settings),
      formatDateTime: (v) => formatDateTime(v, settings),
      formatTime: (v) => formatTime(v, settings),
      weekStartsOn: weekStartsOn(settings.week_start),
    }),
    [settings, ready, refresh],
  );

  return <FormatContext.Provider value={value}>{children}</FormatContext.Provider>;
}

export function useWorkspaceFormat() {
  const ctx = useContext(FormatContext);
  if (!ctx) {
    return {
      settings: DEFAULT_EFFECTIVE,
      ready: false,
      refresh: async () => undefined,
      formatDate: (v: Date | string | number | null | undefined) => formatDate(v, DEFAULT_EFFECTIVE),
      formatDateTime: (v: Date | string | number | null | undefined) =>
        formatDateTime(v, DEFAULT_EFFECTIVE),
      formatTime: (v: Date | string | number | null | undefined) => formatTime(v, DEFAULT_EFFECTIVE),
      weekStartsOn: weekStartsOn(DEFAULT_EFFECTIVE.week_start) as 0 | 1,
    };
  }
  return ctx;
}
