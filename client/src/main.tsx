import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { ThemeProvider } from './lib/theme';
import { applyAppEnvMeta } from './lib/appEnv';
import './styles/index.css';

// 挂 React 之前先按环境改写标题（测试/本地环境加前缀），并写入 data-app-env
applyAppEnvMeta();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </ThemeProvider>
  </React.StrictMode>
);
