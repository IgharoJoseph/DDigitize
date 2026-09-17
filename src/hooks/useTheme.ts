import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "ddigitize-theme";
export type Theme = "dark" | "light";

/** Theme is read after hydration only — the server cannot see local storage. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY) as Theme | null;
    const initial: Theme = stored ?? "dark";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
  }, []);

  const apply = useCallback((next: Theme) => {
    setTheme(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  const toggle = useCallback(() => {
    apply(theme === "dark" ? "light" : "dark");
  }, [apply, theme]);

  return { theme, setTheme: apply, toggle, isDark: theme === "dark" };
}
