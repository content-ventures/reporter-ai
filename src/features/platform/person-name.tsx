'use client';

import { Avatar, Badge, Button, MetaList } from '@content-ventures/design-system/v3';

/**
 * A person in a table cell: avatar and name. With `onOpen` it is the ghost button the Logs use
 * (it opens the person); without, a quiet line for secondary columns.
 */
export function PersonName({ name, avatarUrl, you = false, onOpen }: { name: string; avatarUrl?: string; you?: boolean; onOpen?: () => void }) {
  const avatar = <Avatar key="avatar" name={name} src={avatarUrl} size="xs" decorative />;
  const badge = you ? <Badge key="you" tone="blue" size="sm">Você</Badge> : null;
  if (onOpen) {
    return (
      <MetaList
        size="md"
        separator=""
        wrap={false}
        items={[<Button key="open" variant="ghost" size="sm" onClick={onOpen}>{avatar}{name}</Button>, badge]}
      />
    );
  }
  return <MetaList size="sm" separator="" wrap={false} items={[avatar, name, badge]} />;
}
