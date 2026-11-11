import { useSyncExternalStore } from 'react';
import { createDarkTheme, createLightTheme } from '@fluentui/react-components';
const brand = {10:'#071914',20:'#102e26',30:'#174437',40:'#1b5344',50:'#206451',60:'#25755f',70:'#216951',80:'#25725b',90:'#3f886f',100:'#58b69f',110:'#74c3af',120:'#91d0bf',130:'#b0ddcf',140:'#cce8df',150:'#e2f1eb',160:'#f2f8f5'};
export const lightTheme = { ...createLightTheme(brand), fontFamilyBase: '"Geist Variable", sans-serif', borderRadiusMedium: '8px', borderRadiusLarge: '12px' };
export const darkTheme = { ...createDarkTheme(brand), fontFamilyBase: '"Geist Variable", sans-serif', borderRadiusMedium: '8px', borderRadiusLarge: '12px' };
const themeEvent = 'hanu-theme-changed';
const systemScheme = () => matchMedia('(prefers-color-scheme: dark)');
function readDark() {
  const saved = localStorage.getItem('hanu-theme');
  return saved ? saved === 'dark' : systemScheme().matches;
}
function subscribe(notify: () => void) {
  const scheme = systemScheme();
  const onStorage = (event: StorageEvent) => { if (event.key === 'hanu-theme' || !event.key) notify(); };
  scheme.addEventListener('change', notify);
  window.addEventListener(themeEvent, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    scheme.removeEventListener('change', notify);
    window.removeEventListener(themeEvent, notify);
    window.removeEventListener('storage', onStorage);
  };
}
function toggleTheme() {
  localStorage.setItem('hanu-theme', readDark() ? 'light' : 'dark');
  window.dispatchEvent(new Event(themeEvent));
}
export function useTheme() {
  return { dark: useSyncExternalStore(subscribe, readDark), toggleTheme };
}
