import { describe, expect, it, vi } from "vite-plus/test";

import { invalidateCustomThemes } from "../themePalette";
import {
  getThemeSnapshot,
  readThemePreference,
  refreshTheme,
  setAppearanceMode,
  setTheme,
} from "./useTheme";

const CUSTOM_THEME = {
  id: "personal",
  label: "Personal",
  appearance: "light",
  colors: { canvas: "#f8fbff", text: "#10243d", accent: "#5b6cff" },
  variants: { dark: { canvas: "#101827" } },
};

function withPreferences(storage: Record<string, string>, prefersDark: boolean, check: () => void) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage[key] ?? null,
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
    },
    matchMedia: () => ({ matches: prefersDark }),
  });
  invalidateCustomThemes();
  refreshTheme();
  try {
    check();
  } finally {
    vi.unstubAllGlobals();
    invalidateCustomThemes();
  }
}

describe("Paperkite theme preference", () => {
  it.each([null, "", "gone-theme", "jetbrains-darcula:light"])(
    "defaults %s to JetBrains Dark without persisting a choice on either OS appearance",
    (preference) => {
      for (const prefersDark of [false, true]) {
        const storage = preference === null ? {} : { "t3code:theme": preference };
        withPreferences(storage, prefersDark, () => {
          expect(readThemePreference()).toBe("jetbrains");
          expect(getThemeSnapshot()).toMatchObject({
            theme: "jetbrains",
            resolvedTheme: "dark",
            followSystem: false,
            appearanceMode: "dark",
          });
          expect(window.localStorage.setItem).not.toHaveBeenCalled();
          expect(window.localStorage.removeItem).not.toHaveBeenCalled();
        });
      }
    },
  );

  it("uses the same dark default without a browser", () => {
    expect(getThemeSnapshot()).toMatchObject({
      theme: "jetbrains",
      resolvedTheme: "dark",
      followSystem: false,
      appearanceMode: "dark",
    });
  });

  it.each([
    { preference: "light", mode: "light", resolved: "light", prefersDark: true },
    { preference: "dark", mode: "dark", resolved: "dark", prefersDark: false },
    { preference: "system", mode: "system", resolved: "light", prefersDark: false },
    { preference: "system", mode: "system", resolved: "dark", prefersDark: true },
    {
      preference: "jetbrains-darcula",
      canonical: "jetbrains",
      mode: "dark",
      resolved: "dark",
      prefersDark: false,
    },
    { preference: "grove", mode: "light", resolved: "light", prefersDark: true },
    {
      preference: "t3-grove",
      canonical: "grove",
      mode: "light",
      resolved: "light",
      prefersDark: true,
    },
    { preference: "t3-chat-dark", mode: "dark", resolved: "dark", prefersDark: false },
    { preference: "personal", mode: "light", resolved: "light", prefersDark: true },
  ])(
    "preserves the saved $preference preference ($resolved)",
    ({ preference, canonical, mode, resolved, prefersDark }) => {
      withPreferences(
        {
          "t3code:theme": preference,
          "t3code:themes:v1": JSON.stringify([CUSTOM_THEME]),
        },
        prefersDark,
        () => {
          expect(getThemeSnapshot()).toMatchObject({
            theme: canonical ?? preference,
            appearanceMode: mode,
            resolvedTheme: resolved,
            followSystem: mode === "system",
          });
          expect(window.localStorage.setItem).not.toHaveBeenCalled();
          expect(window.localStorage.removeItem).not.toHaveBeenCalled();
        },
      );
    },
  );

  it.each([
    {
      preferences: { "t3code:theme-appearance-mode": "light" },
      mode: "light",
      resolved: "light",
      prefersDark: true,
    },
    {
      preferences: { "t3code:theme-appearance-mode": "system" },
      mode: "system",
      resolved: "light",
      prefersDark: false,
    },
    {
      preferences: { "t3code:theme-appearance-mode": "system" },
      mode: "system",
      resolved: "dark",
      prefersDark: true,
    },
    {
      preferences: { "t3code:theme-follow-system": "true" },
      mode: "system",
      resolved: "dark",
      prefersDark: true,
    },
    {
      preferences: { "t3code:theme-follow-system": "false" },
      mode: "dark",
      resolved: "dark",
      prefersDark: false,
    },
    {
      preferences: {
        "t3code:theme-appearance-mode": "corrupt",
        "t3code:theme-follow-system": "corrupt",
      },
      mode: "dark",
      resolved: "dark",
      prefersDark: false,
    },
  ])(
    "honors saved appearance independently of the default palette: $mode ($resolved)",
    ({ preferences, mode, resolved, prefersDark }) => {
      withPreferences(preferences, prefersDark, () => {
        expect(getThemeSnapshot()).toMatchObject({
          theme: "jetbrains",
          appearanceMode: mode,
          resolvedTheme: resolved,
          followSystem: mode === "system",
        });
        expect(window.localStorage.setItem).not.toHaveBeenCalled();
      });
    },
  );

  it.each([{ "t3code:theme-appearance-mode": "system" }, { "t3code:theme-follow-system": "true" }])(
    "preserves saved automatic appearance and mix halves when the base is missing",
    (preferences) => {
      withPreferences(
        {
          ...preferences,
          "t3code:theme-halves:v1": JSON.stringify({ light: "grove", dark: "personal" }),
          "t3code:themes:v1": JSON.stringify([CUSTOM_THEME]),
        },
        false,
        () => {
          expect(getThemeSnapshot()).toMatchObject({
            theme: "jetbrains",
            appearanceMode: "system",
            followSystem: true,
            resolvedTheme: "light",
            themeHalves: { light: "grove", dark: "personal" },
          });
        },
      );
    },
  );

  it.each([
    {
      preferences: { "t3code:theme-appearance-mode": "light" },
      mode: "light",
      prefersDark: true,
      resolved: "light",
    },
    {
      preferences: { "t3code:theme-appearance-mode": "dark" },
      mode: "dark",
      prefersDark: false,
      resolved: "dark",
    },
    {
      preferences: { "t3code:theme-appearance-mode": "system" },
      mode: "system",
      prefersDark: false,
      resolved: "light",
    },
    {
      preferences: { "t3code:theme-appearance-mode": "system" },
      mode: "system",
      prefersDark: true,
      resolved: "dark",
    },
    {
      preferences: { "t3code:theme-follow-system": "true" },
      mode: "system",
      prefersDark: false,
      resolved: "light",
    },
  ])(
    "redirects saved Darcula and both mix halves, preserving $mode / OS dark $prefersDark",
    ({ preferences, mode, prefersDark, resolved }) => {
      const storage = {
        ...preferences,
        "t3code:theme": "jetbrains-darcula",
        "t3code:theme-halves:v1": JSON.stringify({
          light: "jetbrains-darcula",
          dark: "jetbrains-darcula",
        }),
      };
      const before = { ...storage };
      withPreferences(storage, prefersDark, () => {
        expect(getThemeSnapshot()).toMatchObject({
          theme: "jetbrains",
          appearanceMode: mode,
          resolvedTheme: resolved,
          followSystem: mode === "system",
          themeHalves: { light: "jetbrains", dark: "jetbrains" },
        });
        expect(storage).toEqual(before);
        expect(window.localStorage.setItem).not.toHaveBeenCalled();
        expect(window.localStorage.removeItem).not.toHaveBeenCalled();
      });
    },
  );

  it("falls back without overwriting malformed libraries or halves", () => {
    withPreferences(
      {
        "t3code:theme": "personal",
        "t3code:themes:v1": "{broken",
        "t3code:theme-halves:v1": "[broken",
      },
      false,
      () => {
        expect(getThemeSnapshot()).toMatchObject({
          theme: "jetbrains",
          resolvedTheme: "dark",
          themeHalves: null,
        });
        expect(window.localStorage.setItem).not.toHaveBeenCalled();
        expect(window.localStorage.removeItem).not.toHaveBeenCalled();
      },
    );
  });

  it("uses the dark default when storage is unavailable", () => {
    using _log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("storage blocked");
        },
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      matchMedia: () => ({ matches: false }),
    });
    try {
      invalidateCustomThemes();
      refreshTheme();
      expect(getThemeSnapshot()).toMatchObject({ theme: "jetbrains", resolvedTheme: "dark" });
      expect(window.localStorage.setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      withPreferences({}, false, () => {
        setAppearanceMode("dark");
      });
    }
  });

  it("keeps appearance controls and palette changes usable and persistent from the dark default", () => {
    withPreferences({}, false, () => {
      expect(setAppearanceMode("light")).toBe(true);
      refreshTheme();
      expect(getThemeSnapshot()).toMatchObject({ theme: "jetbrains", resolvedTheme: "light" });
      expect(setAppearanceMode("system")).toBe(true);
      expect(getThemeSnapshot()).toMatchObject({ followSystem: true, resolvedTheme: "light" });
      expect(setAppearanceMode("dark")).toBe(true);
      expect(setTheme("grove")).toBe(true);
      refreshTheme();
      expect(getThemeSnapshot()).toMatchObject({ theme: "grove", resolvedTheme: "dark" });
      expect(setAppearanceMode("light")).toBe(true);
      expect(getThemeSnapshot()).toMatchObject({ theme: "grove", resolvedTheme: "light" });
      expect(setAppearanceMode("system")).toBe(true);
      refreshTheme();
      expect(getThemeSnapshot()).toMatchObject({ followSystem: true, resolvedTheme: "light" });
    });
  });
});
