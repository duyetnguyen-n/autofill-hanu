import { useState } from 'react';
import { createDarkTheme, createLightTheme } from '@fluentui/react-components';
const brand = {10:'#071914',20:'#102e26',30:'#174437',40:'#1b5344',50:'#206451',60:'#25755f',70:'#216951',80:'#25725b',90:'#3f886f',100:'#58b69f',110:'#74c3af',120:'#91d0bf',130:'#b0ddcf',140:'#cce8df',150:'#e2f1eb',160:'#f2f8f5'};
export const lightTheme = { ...createLightTheme(brand), fontFamilyBase: '"Geist Variable", sans-serif', borderRadiusMedium: '8px', borderRadiusLarge: '12px' };
export const darkTheme = { ...createDarkTheme(brand), fontFamilyBase: '"Geist Variable", sans-serif', borderRadiusMedium: '8px', borderRadiusLarge: '12px' };
export function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('hanu-theme') ? localStorage.getItem('hanu-theme') === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
  function toggleTheme() { setDark(old => { localStorage.setItem('hanu-theme', old ? 'light' : 'dark'); return !old; }); }
  return { dark, toggleTheme };
}
