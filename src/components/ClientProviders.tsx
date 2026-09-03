'use client';

import React, { ReactNode, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { TwilioProvider } from '@/contexts/TwilioContext';
import { AccessibilityProvider } from '@/contexts/AccessibilityContext';

/**
 * TwilioProvider only wraps authenticated pages — the login page doesn't need a Twilio
 * device. AccessibilityProvider (theme/font/contrast/motion) wraps everything, login
 * included, so preferences apply consistently across the whole app.
 */
export function ClientProviders({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const isAuthPage = pathname === '/login';

    return (
        <AccessibilityProvider>
            {isAuthPage ? children : <TwilioProvider>{children}</TwilioProvider>}
        </AccessibilityProvider>
    );
}
