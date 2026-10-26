import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function WalletPlaceholder() {
  return (
    <>
      <PageHeader title="Wallet" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the wallet feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/wallet', element: WalletPlaceholder, auth: true }];
