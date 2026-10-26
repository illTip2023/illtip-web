import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function SettingsPlaceholder() {
  return (
    <>
      <PageHeader title="Settings" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the settings feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/settings', element: SettingsPlaceholder, auth: true }];
