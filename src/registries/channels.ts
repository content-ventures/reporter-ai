import { EXPORT_CHANNEL } from '../domain/index.ts';
import type { ChannelId, DeliveryFormat, DeliveryMode, PieceKind } from '../domain/index.ts';
import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Delivery channels. R1 only exports files; CMS drafts (R2), the first social channel (R4) and
 * the R6 channels reuse the same `Delivery` record (mode, externalRef, attempts, idempotency).
 */

export type DisabledFormat = { format: DeliveryFormat | 'zip'; label: string; reason: string };

export type ChannelEntry = {
  id: ChannelId;
  label: string;
  icon: IconKey;
  since: ReleaseId;
  modes: DeliveryMode[];
  /** Piece kinds this channel accepts. */
  pieceKinds: PieceKind[];
  /** Roadmap reference, for "Disponível em breve" hints. */
  feature: string;
  /** Formats designed now but not produced yet (rows shown disabled with the reason). */
  disabledFormats?: DisabledFormat[];
};

export const RENDER_PENDING_REASON = 'Disponível com o render final';

export const CHANNELS: readonly ChannelEntry[] = [
  {
    id: EXPORT_CHANNEL,
    label: 'Exportação',
    icon: 'Download',
    since: 'R1',
    modes: ['download'],
    pieceKinds: ['article', 'carousel'],
    feature: 'F1.6',
    disabledFormats: [
      { format: 'zip', label: 'pacote.zip', reason: RENDER_PENDING_REASON },
      { format: 'docx', label: 'artigo.docx', reason: RENDER_PENDING_REASON },
    ],
  },
  { id: 'cms', label: 'CMS do portal', icon: 'Globe', since: 'R2', modes: ['draft', 'scheduled', 'published'], pieceKinds: ['article'], feature: 'F2.10' },
  { id: 'social', label: 'Canal social', icon: 'Send', since: 'R4', modes: ['scheduled', 'published'], pieceKinds: ['cut', 'carousel', 'post'], feature: 'F4.7' },
  { id: 'spotify', label: 'Spotify', icon: 'Radio', since: 'R6', modes: ['scheduled', 'published'], pieceKinds: ['audio'], feature: 'F6.1' },
  { id: 'email', label: 'E-mail', icon: 'Mail', since: 'R6', modes: ['draft', 'scheduled', 'published'], pieceKinds: ['newsletter'], feature: 'F6.6' },
  { id: 'linkedin', label: 'LinkedIn', icon: 'UsersRound', since: 'R6', modes: ['scheduled', 'published'], pieceKinds: ['post', 'carousel'], feature: 'F6.7' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'MessageCircle', since: 'R6', modes: ['scheduled', 'published'], pieceKinds: ['post'], feature: 'F6.8' },
];

export function channelsFor(release: ReleaseId = CURRENT_RELEASE): ChannelEntry[] {
  return availableIn(CHANNELS, release);
}

export function channelById(id: ChannelId): ChannelEntry | undefined {
  return CHANNELS.find((channel) => channel.id === id);
}
