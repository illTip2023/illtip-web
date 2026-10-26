import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function NotificationsPlaceholder() {
  return (
    <>
      <PageHeader title="Notifications" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the notifications feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/notifications', element: NotificationsPlaceholder, auth: true }];
