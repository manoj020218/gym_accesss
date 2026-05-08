import React from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Toaster } from '../ui/Toast';

interface LayoutProps {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function Layout({ title, actions, children }: LayoutProps) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden" style={{ marginLeft: 228 }}>
        <Header title={title} actions={actions} />
        <main className="flex-1 overflow-y-auto p-6 bg-bg">
          {children}
        </main>
      </div>
      <Toaster />
    </div>
  );
}
