import React from 'react';
import type { RouteDef } from '../../lib/router';
import { Empty, PageHeader } from '../../ui/kit';

function ChatPlaceholder() {
  return (
    <>
      <PageHeader title="Chat" />
      <Empty title="Coming soon" />
    </>
  );
}

/** Routes owned by the chat feature. auth: true = requires login; chrome: false = no app shell. */
export const routes: RouteDef[] = [{ path: '/chat', element: ChatPlaceholder, auth: true }];
