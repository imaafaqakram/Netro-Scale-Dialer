'use client';

import React, { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { SignalWireProvider } from '@/contexts/SignalWireContext';
import { AccessibilityProvider } from '@/contexts/AccessibilityContext';

/**
 * SignalWireProvider only wraps authenticated pages — the login page doesn't need a
 * softphone device. AccessibilityProvider (theme/font/contrast/motion) wraps everything,
 * login included, so preferences apply consistently across the whole app.
 */
export function ClientProviders({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const isAuthPage = pathname === '/login';

    return (
        <AccessibilityProvider>
            {isAuthPage ? children : <SignalWireProvider>{children}</SignalWireProvider>}
        </AccessibilityProvider>
    );
}
