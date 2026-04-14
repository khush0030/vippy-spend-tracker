import { useState, useCallback, useEffect, useMemo } from "react";

export function useTheme() {
  const [theme, setTheme] = useState("light");
  useEffect(() => {
    const saved = localStorage.getItem("vippy-theme");
    const preferred =
      saved ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light");
    setTheme(preferred);
    document.documentElement.setAttribute("data-theme", preferred);
  }, []);
  const toggle = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("vippy-theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }, [theme]);

  const chartColors = useMemo(
    () => ({
      text: theme === "dark" ? "#a0a09c" : "#6b6b68",
      textLight: theme === "dark" ? "#6b6b68" : "#9b9b97",
      grid: theme === "dark" ? "#333333" : "#e3e3e0",
    }),
    [theme]
  );

  return { theme, toggle, chartColors };
}
