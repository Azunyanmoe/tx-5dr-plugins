/// <reference types="@tx5dr/plugin-api/bridge" />
import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) {
  throw new Error('app_not_found');
}

createRoot(app).render(<App />);
