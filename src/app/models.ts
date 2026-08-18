// Shared frontend contract types for the React sample.
// These types model the AG-UI event stream, the A2UI operation payloads,
// and the renderable commerce surface shapes used across the app.
export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

export type ProductRecord = {
  ec_product_id: string;
  ec_name: string;
  ec_brand: string;
  ec_price: number;
  ec_promo_price?: number;
  ec_image: string;
  clickUri: string;
  description?: string;
  accent?: string;
  [key: string]: string | number | undefined;
};

export type NextAction = {
  text: string;
  type: 'search' | 'followup';
};

export type BundleSlotConfig = {
  categoryLabel: string;
  surfaceRef: string;
};

export type BundleTierConfig = {
  bundleId: string;
  label: string;
  description: string;
  slots: BundleSlotConfig[];
};

export type StreamTurnInput = {
  threadId: string;
  prompt: string;
  conversationSessionId?: string;
  conversationToken?: string;
};

export type ValueMapEntry = {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueMap?: ValueMapItem[];
};

export type ValueMapItem = {
  valueMap?: ValueMapEntry[];
};

export type BeginRenderingOperation = {
  beginRendering: {
    surfaceId: string;
    root: string;
    catalogId: string;
  };
};

type LiteralOrPath = {
  literalString?: string;
  path?: string;
};

type ProductCardComponent = {
  ProductCard: {
    ec_product_id?: { path: string };
    ec_name?: { path: string };
    ec_brand?: { path: string };
    ec_image?: { path: string };
    ec_price?: { path: string };
    ec_promo_price?: { path: string };
  };
};

type ProductCarouselComponent = {
  ProductCarousel: {
    heading?: LiteralOrPath;
    products?: {
      componentId: string;
      dataBinding: string;
    };
    isLoading?: boolean;
  };
};

type ComparisonTableComponent = {
  ComparisonTable: {
    heading?: LiteralOrPath;
    products?: {
      componentId: string;
      dataBinding: string;
    };
    attributes?: string[];
    isLoading?: boolean;
  };
};

type ComparisonSummaryComponent = {
  ComparisonSummary: {
    text?: LiteralOrPath;
  };
};

type BundleDisplayComponent = {
  BundleDisplay: {
    title?: LiteralOrPath;
    bundles?: BundleTierConfig[];
    isLoading?: boolean;
  };
};

type NextActionsBarComponent = {
  NextActionsBar: {
    actions?: {
      componentId: string;
      dataBinding: string;
    };
    isLoading?: boolean;
  };
};

export type SurfaceComponentPayload =
  | ProductCardComponent
  | ProductCarouselComponent
  | ComparisonTableComponent
  | ComparisonSummaryComponent
  | BundleDisplayComponent
  | NextActionsBarComponent;

export type SurfaceUpdateOperation = {
  surfaceUpdate: {
    surfaceId: string;
    components: Array<{
      id: string;
      component: SurfaceComponentPayload;
    }>;
  };
};

export type DataModelUpdateOperation = {
  dataModelUpdate: {
    surfaceId: string;
    contents: Array<{
      key: string;
      valueMap?: ValueMapItem[];
    }>;
  };
};

export type A2UIOperation =
  | BeginRenderingOperation
  | SurfaceUpdateOperation
  | DataModelUpdateOperation
  | Record<string, unknown>;

export type ActivitySnapshotContent = {
  operations: A2UIOperation[];
};

export type RunStartedEvent = {
  type: 'RUN_STARTED';
  threadId?: string;
  runId?: string;
  conversationSessionId?: string;
  conversationToken?: string;
};

export type RunFinishedEvent = {
  type: 'RUN_FINISHED';
  threadId?: string;
  runId?: string;
  conversationSessionId?: string;
  conversationToken?: string;
};

export type RunErrorEvent = {
  type: 'RUN_ERROR';
  message: string;
  code?: string;
  conversationSessionId?: string;
  conversationToken?: string;
};

export type TextMessageStartEvent = {
  type: 'TEXT_MESSAGE_START';
  messageId: string;
  role?: 'assistant';
};

export type TextMessageContentEvent = {
  type: 'TEXT_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
};

export type TextMessageEndEvent = {
  type: 'TEXT_MESSAGE_END';
  messageId: string;
};

export type ToolCallStartEvent = {
  type: 'TOOL_CALL_START';
  toolCallId?: string;
  toolUseId?: string;
  toolName?: string;
  toolCallName?: string;
};

export type ToolCallArgsEvent = {
  type: 'TOOL_CALL_ARGS';
  toolCallId?: string;
  toolUseId?: string;
  delta?: string;
  argsDelta?: string;
};

export type ToolCallResultEvent = {
  type: 'TOOL_CALL_RESULT';
  toolCallId?: string;
  toolUseId?: string;
  content?: string;
};

export type ToolCallEndEvent = {
  type: 'TOOL_CALL_END';
  toolCallId?: string;
  toolUseId?: string;
};

export type StateSnapshotEvent = {
  type: 'STATE_SNAPSHOT';
  snapshot: Record<string, unknown>;
};

export type ActivitySnapshotEvent = {
  type: 'ACTIVITY_SNAPSHOT';
  messageId?: string;
  activityType?: string;
  content: ActivitySnapshotContent;
  replace?: boolean;
};

export type ReasoningStartEvent = {
  type: 'REASONING_START';
  messageId: string;
};

export type ReasoningMessageStartEvent = {
  type: 'REASONING_MESSAGE_START';
  messageId: string;
  role?: 'assistant';
};

export type ReasoningMessageContentEvent = {
  type: 'REASONING_MESSAGE_CONTENT';
  messageId: string;
  delta: string;
};

export type ReasoningMessageEndEvent = {
  type: 'REASONING_MESSAGE_END';
  messageId: string;
};

export type ReasoningEndEvent = {
  type: 'REASONING_END';
  messageId: string;
};

export type AgUiEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallResultEvent
  | ToolCallEndEvent
  | StateSnapshotEvent
  | ActivitySnapshotEvent
  | ReasoningStartEvent
  | ReasoningMessageStartEvent
  | ReasoningMessageContentEvent
  | ReasoningMessageEndEvent
  | ReasoningEndEvent;

export type CommerceSurfaceComponentType =
  | 'ProductCarousel'
  | 'ComparisonTable'
  | 'ComparisonSummary'
  | 'BundleDisplay'
  | 'NextActionsBar'
  | 'ProductResearchCard'
  | 'ProductCard';

export type ProductCarouselSurface = {
  surfaceId: string;
  componentType: 'ProductCarousel';
  heading: string;
  products: ProductRecord[];
  isLoading: boolean;
};

export type ComparisonTableSurface = {
  surfaceId: string;
  componentType: 'ComparisonTable';
  heading: string;
  attributes: string[];
  products: ProductRecord[];
  isLoading: boolean;
};

export type ComparisonSummarySurface = {
  surfaceId: string;
  componentType: 'ComparisonSummary';
  text: string;
};

export type BundleDisplaySlot = {
  categoryLabel: string;
  surfaceRef: string;
  product: ProductRecord | null;
};

export type BundleDisplayTier = {
  bundleId: string;
  label: string;
  description: string;
  slots: BundleDisplaySlot[];
};

export type BundleDisplaySurface = {
  surfaceId: string;
  componentType: 'BundleDisplay';
  title: string;
  bundles: BundleDisplayTier[];
  isLoading: boolean;
};

export type NextActionsBarSurface = {
  surfaceId: string;
  componentType: 'NextActionsBar';
  actions: NextAction[];
  isLoading: boolean;
};

export type ProductResearchCardSurface = {
  surfaceId: string;
  componentType: 'ProductResearchCard';
  summary: string;
  bullets: string[];
  product: ProductRecord | null;
  isLoading: boolean;
};

export type RenderableCommerceSurface =
  | ProductCarouselSurface
  | ComparisonTableSurface
  | ComparisonSummarySurface
  | BundleDisplaySurface
  | NextActionsBarSurface
  | ProductResearchCardSurface;
