/**
 * KeysRequired
 *
 * Route guard that sits between ProtectedRoute (authentication) and
 * ConnectionProvider (crypto initialisation).
 *
 * On mount it opens IndexedDB and checks whether a P-256 ECDH keypair already
 * exists.  If none is found the user is redirected to /keys (KeySetupPage) to
 * generate or import their recovery phrase.  Once setup is complete the user
 * navigates back to /, this component re-mounts, finds the keypair, and
 * renders the protected children as normal.
 *
 * Routing position:
 *   <ProtectedRoute />
 *     <Route path="/keys" element={<KeySetupPage />} />   ← outside this guard
 *     <Route element={<KeysRequired />}>                  ← this component
 *       <Route element={<ConnectionProvider>…</ConnectionProvider>}>
 *         <Route path="/" … />
 *       </Route>
 *     </Route>
 */

import { useEffect, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { CryptKeyStorage } from '@/utils/CryptKeyStorage';

type CheckState = 'loading' | 'ready' | 'needed';

export default function KeysRequired() {
    const [state, setState] = useState<CheckState>('loading');

    useEffect(() => {
        let cancelled = false;

        CryptKeyStorage.open()
            .then(storage => storage.hasKeypair())
            .then(has => {
                if (!cancelled) setState(has ? 'ready' : 'needed');
            })
            .catch(() => {
                // If IDB is unavailable treat it as needing setup
                if (!cancelled) setState('needed');
            });

        return () => { cancelled = true; };
    }, []);

    if (state === 'loading') {
        return (
            <div className="flex h-screen w-screen items-center justify-center bg-background">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
            </div>
        );
    }

    if (state === 'needed') {
        // replace=true prevents the back-button from looping back here
        return <Navigate to="/keys" replace />;
    }

    return <Outlet />;
}
