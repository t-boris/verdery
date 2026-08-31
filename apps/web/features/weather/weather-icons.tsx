import type { ReactNode } from 'react';

function WeatherIcon({ children }: { readonly children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function TemperatureIcon() {
  return (
    <WeatherIcon>
      <path d="M8 4a2 2 0 0 1 4 0v7.2a4 4 0 1 1-4 0Z" />
      <path d="M10 6v7" />
    </WeatherIcon>
  );
}

export function RainIcon() {
  return (
    <WeatherIcon>
      <path d="M5 12.5a3.5 3.5 0 0 1 .7-6.9A4.8 4.8 0 0 1 15 7a2.8 2.8 0 0 1 0 5.5Z" />
      <path d="m7 15-1 2M11 15l-1 2M15 15l-1 2" />
    </WeatherIcon>
  );
}

export function WindIcon() {
  return (
    <WeatherIcon>
      <path d="M3 7h9.5a2 2 0 1 0-1.8-2.8M3 10h13a2 2 0 1 1-1.8 2.8M3 13h5" />
    </WeatherIcon>
  );
}

export function HumidityIcon() {
  return (
    <WeatherIcon>
      <path d="M10 2.8c3.2 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 1.8-5 5-9Z" />
      <path d="M8 13.5c.5.7 1.2 1 2 1" />
    </WeatherIcon>
  );
}
