// src/components/SettingsModal/AboutTab.tsx - About page with version info and links
import React, { useState } from 'react';
import iconIco from '../../assets/icons/icon.ico';

// App constants - could be imported from package.json later
const APP_VERSION = '0.2.0';
const APP_NAME = 'CapturePlayer';
const GITHUB_URL = 'https://github.com/GalusPeres/CapturePlayer';
const COFFEE_URL = 'https://ko-fi.com/galusperes'; // Replace with your Ko-fi/PayPal link

export default function AboutTab() {
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);

  const openLink = (url: string) => {
    // Use Electron Shell API for external links
    if (window.electronAPI && (window.electronAPI as any).openExternal) {
      (window.electronAPI as any).openExternal(url);
    } else {
      // Fallback for development environment
      window.open(url, '_blank');
    }
  };

  const checkForUpdates = async () => {
    setIsCheckingUpdates(true);
    
    try {
      const response = await fetch('https://api.github.com/repos/GalusPeres/CapturePlayer/releases/latest');
      const data = await response.json();
      
      const latestVersion = data.tag_name; // e.g. "v0.2.0"
      const currentVersion = `v${APP_VERSION}`; // e.g. "v0.2.0"
      
      if (latestVersion === currentVersion) {
        alert('You are running the latest version!');
      } else {
        const updateConfirm = confirm(
          `New version ${latestVersion} is available!\n` +
          `You are running ${currentVersion}.\n\n` +
          `Click OK to download the update.`
        );
        
        if (updateConfirm) {
          openLink(data.html_url); // Opens GitHub release page
        }
      }
    } catch (error) {
      console.error('Update check failed:', error);
      alert('Could not check for updates. Please check your internet connection.');
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  return (
    <>
      {/* App Info Section */}
      <div className="text-center mb-6">
        <div className="flex justify-center items-center mb-4 space-x-3">
          <img src={iconIco} alt="CapturePlayer Icon" className="w-16 h-16" />
          <div className="text-left">
            <h3 className="text-xl font-semibold text-white">{APP_NAME}</h3>
            <p className="text-white/60">Version {APP_VERSION}</p>
          </div>
        </div>
        <div className="text-white/60">
          <p>Built with Electron + React + Vite</p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="space-y-3">
        {/* GitHub Repository */}
        <button
          onClick={() => openLink(GITHUB_URL)}
          className="w-full px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-white rounded-xl focus:outline-none transition-colors flex items-center justify-center space-x-2"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          <span>View on GitHub</span>
        </button>

        {/* Check for Updates */}
        <button
          onClick={checkForUpdates}
          disabled={isCheckingUpdates}
          className="w-full px-4 py-2 bg-gradient-to-br from-blue-600 to-indigo-500 hover:from-blue-700 hover:to-indigo-600 disabled:from-blue-600/30 disabled:to-blue-500/30 border border-blue-500/50 hover:border-blue-600/70 disabled:border-blue-500/20 text-white rounded-xl focus:outline-none transition-all flex items-center justify-center space-x-2"
        >
          {isCheckingUpdates ? (
            <>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
              </svg>
              <span>Checking...</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
              </svg>
              <span>Check for Updates</span>
            </>
          )}
        </button>

        {/* Buy me a Coffee */}
        {/*
        <button
          onClick={() => openLink(COFFEE_URL)}
          className="w-full px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl focus:outline-none transition-colors flex items-center justify-center space-x-2"
        >
          <span className="text-lg">☕</span>
          <span>Buy me a Coffee</span>
        </button>
        */}
      </div>
    </>
  );
}