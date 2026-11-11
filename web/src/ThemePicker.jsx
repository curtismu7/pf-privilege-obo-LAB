import React, { useEffect, useState } from "react";

// Theme picker (owner rule 2026-11-06): the auto/light/dark select in every app's
// header. Sets data-theme on <html> only; the vendored tokens do the rest.
export default function ThemePicker() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("pf-obo-theme") || "auto";
    } catch {
      return "auto";
    }
  });

  useEffect(() => {
    if (theme === "auto") {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
    try {
      localStorage.setItem("pf-obo-theme", theme);
    } catch {}
  }, [theme]);

  return (
    <label className="shell-theme" htmlFor="theme-select">
      Theme
      <select id="theme-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="auto">Auto</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
