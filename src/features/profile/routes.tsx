import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function ProfilePlaceholder() {
  return (
    <>
      <PageHeader title="Profile" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the profile feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/profile', element: ProfilePlaceholder, auth: true }];
