/**
 * Identifier and timestamp aliases. Plain strings keep fixtures, adapters and tests simple;
 * the alias names document intent at every boundary.
 */

export type WorkspaceId = string;
export type PersonId = string;
export type ProductionId = string;
export type SourceId = string;
export type SegmentId = string;
export type PieceId = string;
export type VersionId = string;
export type BlockId = string;
export type SlideId = string;
export type RunId = string;
export type StepId = string;
export type DecisionId = string;
export type ReviewRequestId = string;
export type SuggestionId = string;
export type DeliveryId = string;
export type AssetId = string;
export type FeedbackId = string;
export type ActivityId = string;
export type QuoteId = string;
export type BatchId = string;
export type FlowId = string;
export type TemplateId = string;
export type GateId = string;
export type CheckId = string;
export type ChannelId = string;

/** ISO-8601 instant, always produced by the Clock port (never `new Date()` inside the domain). */
export type IsoDateTime = string;

/** Actor of an automated action that no person triggered directly. */
export const SYSTEM_ACTOR = 'system' as const;
export type ActorId = PersonId | typeof SYSTEM_ACTOR;
