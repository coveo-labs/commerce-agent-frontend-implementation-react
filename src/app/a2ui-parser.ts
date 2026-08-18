// A2UI-to-React render state adapter.
// This module takes the structured operations emitted by the agent and turns
// them into a small set of renderable commerce surfaces for the template layer.
import type {
  A2UIOperation,
  ActivitySnapshotContent,
  BundleDisplayTier,
  CommerceSurfaceComponentType,
  DataModelUpdateOperation,
  NextAction,
  ProductRecord,
  RenderableCommerceSurface,
  SurfaceUpdateOperation,
  ValueMapEntry,
  ValueMapItem
} from './models';

type SurfaceDraft = {
  order: number;
  surfaceId: string;
  componentType: CommerceSurfaceComponentType;
  heading?: string;
  text?: string;
  title?: string;
  summary?: string;
  bullets?: string[];
  attributes?: string[];
  bundles?: BundleDisplayTier[];
  products: ProductRecord[];
  actions: NextAction[];
  isLoading: boolean;
};

type SurfaceState = {
  orderById: Record<string, number>;
  surfacesById: Record<string, RenderableCommerceSurface>;
};

function readLiteralOrPath(value: unknown): string {
  if (!value || typeof value !== 'object') {
    return '';
  }

  const candidate = value as { literalString?: unknown; path?: unknown };
  if (typeof candidate.literalString === 'string') {
    return candidate.literalString;
  }
  if (typeof candidate.path === 'string') {
    return candidate.path;
  }
  return '';
}

function valueMapToRecord(entries: ValueMapEntry[] | undefined): Record<string, string | number> {
  const record: Record<string, string | number> = {};

  for (const entry of entries ?? []) {
    if (entry.valueString != null) {
      record[entry.key] = entry.valueString;
    } else if (entry.valueNumber != null) {
      record[entry.key] = entry.valueNumber;
    }
  }

  return record;
}

function toProductRecord(item: ValueMapItem): ProductRecord | null {
  if (!item.valueMap) {
    return null;
  }

  const record = valueMapToRecord(item.valueMap);
  const productId = String(record['ec_product_id'] ?? '').trim();
  const productName = String(record['ec_name'] ?? '').trim();

  if (!productId || !productName) {
    return null;
  }

  return {
    ...record,
    ec_product_id: productId,
    ec_name: productName,
    ec_brand: String(record['ec_brand'] ?? ''),
    ec_price: Number(record['ec_price'] ?? 0),
    ec_promo_price:
      typeof record['ec_promo_price'] === 'number'
        ? Number(record['ec_promo_price'])
        : undefined,
    ec_image: String(record['ec_image'] ?? ''),
    clickUri: String(record['clickUri'] ?? '#'),
    description:
      typeof record['description'] === 'string' ? record['description'] : undefined,
    accent: typeof record['accent'] === 'string' ? record['accent'] : undefined
  };
}

function toNextAction(item: ValueMapItem): NextAction | null {
  if (!item.valueMap) {
    return null;
  }

  const record = valueMapToRecord(item.valueMap);
  const text = String(record['text'] ?? '').trim();
  const type = String(record['type'] ?? 'followup').trim();

  if (!text || (type !== 'search' && type !== 'followup')) {
    return null;
  }

  return { text, type };
}

function ensureDraft(
  drafts: Record<string, SurfaceDraft>,
  orderById: Record<string, number>,
  surfaceId: string,
  componentType: CommerceSurfaceComponentType
): SurfaceDraft {
  const existing = drafts[surfaceId];

  if (existing) {
    existing.componentType = componentType;
    return existing;
  }

  const draft: SurfaceDraft = {
    order: orderById[surfaceId] ?? Object.keys(orderById).length,
    surfaceId,
    componentType,
    products: [],
    actions: [],
    isLoading: false
  };

  orderById[surfaceId] = draft.order;
  drafts[surfaceId] = draft;
  return draft;
}

function buildBundleTiers(
  rawBundles: unknown,
  productsBySurface: Record<string, ProductRecord[]>
): BundleDisplayTier[] {
  if (!Array.isArray(rawBundles)) {
    return [];
  }

  return rawBundles
    .filter((bundle): bundle is Record<string, unknown> => !!bundle && typeof bundle === 'object')
    .map((bundle) => ({
      bundleId: String(bundle['bundleId'] ?? ''),
      label: String(bundle['label'] ?? ''),
      description: String(bundle['description'] ?? ''),
      slots: Array.isArray(bundle['slots'])
        ? bundle['slots']
            .filter((slot): slot is Record<string, unknown> => !!slot && typeof slot === 'object')
            .map((slot) => {
              const surfaceRef = String(slot['surfaceRef'] ?? '');
              return {
                categoryLabel: String(slot['categoryLabel'] ?? ''),
                surfaceRef,
                product:
                  productsBySurface[surfaceRef]?.[0] ??
                  ((slot['product'] as ProductRecord | null | undefined) ?? null)
              };
            })
        : []
    }));
}

function draftToSurface(
  draft: SurfaceDraft,
  productsBySurface: Record<string, ProductRecord[]>
): RenderableCommerceSurface | null {
  switch (draft.componentType) {
    case 'ProductCarousel':
      return {
        surfaceId: draft.surfaceId,
        componentType: 'ProductCarousel',
        heading: draft.heading ?? '',
        products: productsBySurface[draft.surfaceId] ?? draft.products,
        isLoading: draft.isLoading
      };
    case 'ComparisonTable':
      return {
        surfaceId: draft.surfaceId,
        componentType: 'ComparisonTable',
        heading: draft.heading ?? '',
        attributes: draft.attributes ?? [],
        products: productsBySurface[draft.surfaceId] ?? draft.products,
        isLoading: draft.isLoading
      };
    case 'ComparisonSummary':
      return {
        surfaceId: draft.surfaceId,
        componentType: 'ComparisonSummary',
        text: draft.text ?? ''
      };
    case 'BundleDisplay':
      return {
        surfaceId: draft.surfaceId,
        componentType: 'BundleDisplay',
        title: draft.title ?? draft.heading ?? '',
        bundles: buildBundleTiers(draft.bundles, productsBySurface),
        isLoading: draft.isLoading
      };
    case 'NextActionsBar':
      return {
        surfaceId: draft.surfaceId,
        componentType: 'NextActionsBar',
        actions: draft.actions,
        isLoading: draft.isLoading
      };
    case 'ProductResearchCard':
      return {
        surfaceId: draft.surfaceId,
        componentType: 'ProductResearchCard',
        summary: draft.summary ?? '',
        bullets: draft.bullets ?? [],
        product:
          (productsBySurface[draft.surfaceId] ?? draft.products)[0] ?? null,
        isLoading: draft.isLoading
      };
    default:
      return null;
  }
}

function collectDrafts(
  operations: A2UIOperation[],
  previous: SurfaceState
): { drafts: Record<string, SurfaceDraft>; productsBySurface: Record<string, ProductRecord[]> } {
  const drafts: Record<string, SurfaceDraft> = {};
  const productsBySurface: Record<string, ProductRecord[]> = {};
  const nextOrderById = { ...previous.orderById };

  for (const existing of Object.values(previous.surfacesById)) {
    const draft = ensureDraft(
      drafts,
      nextOrderById,
      existing.surfaceId,
      existing.componentType
    );

    if (existing.componentType === 'ProductCarousel' || existing.componentType === 'ComparisonTable') {
      draft.heading = existing.heading;
      draft.products = [...existing.products];
      draft.isLoading = existing.isLoading;
      if (existing.componentType === 'ComparisonTable') {
        draft.attributes = [...existing.attributes];
      }
    } else if (existing.componentType === 'ComparisonSummary') {
      draft.text = existing.text;
    } else if (existing.componentType === 'BundleDisplay') {
      draft.title = existing.title;
      draft.bundles = existing.bundles;
      draft.isLoading = existing.isLoading;
    } else if (existing.componentType === 'NextActionsBar') {
      draft.actions = [...existing.actions];
      draft.isLoading = existing.isLoading;
    } else if (existing.componentType === 'ProductResearchCard') {
      draft.summary = existing.summary;
      draft.bullets = [...existing.bullets];
      draft.products = existing.product ? [existing.product] : [];
      draft.isLoading = existing.isLoading;
    }
  }

  for (const operation of operations) {
    if ('surfaceUpdate' in operation && operation.surfaceUpdate) {
      const surfaceUpdate = (operation as SurfaceUpdateOperation).surfaceUpdate;
      const surfaceId = surfaceUpdate.surfaceId;

      for (const component of surfaceUpdate.components) {
        const componentKeys = Object.keys(component.component ?? {});
        if (componentKeys.length !== 1) {
          continue;
        }

        const type = componentKeys[0] as CommerceSurfaceComponentType;
        const payload = (component.component as Record<string, Record<string, unknown>>)[type];

        if (type === 'ProductCard') {
          // ProductCard is a nested protocol component used to describe product
          // bindings. The app renders higher-level surfaces instead.
          continue;
        }

        const nextDraft = ensureDraft(drafts, nextOrderById, surfaceId, type);

        if (type === 'ProductCarousel') {
          nextDraft.heading = readLiteralOrPath(payload?.['heading']);
          nextDraft.isLoading = payload?.['isLoading'] === true;
        } else if (type === 'ComparisonTable') {
          nextDraft.heading = readLiteralOrPath(payload?.['heading']);
          nextDraft.attributes = Array.isArray(payload?.['attributes'])
            ? payload['attributes'].filter((value): value is string => typeof value === 'string')
            : [];
          nextDraft.isLoading = payload?.['isLoading'] === true;
        } else if (type === 'ComparisonSummary') {
          nextDraft.text = readLiteralOrPath(payload?.['text']);
        } else if (type === 'BundleDisplay') {
          nextDraft.title = readLiteralOrPath(payload?.['title']);
          nextDraft.bundles = Array.isArray(payload?.['bundles'])
            ? (payload['bundles'] as BundleDisplayTier[])
            : nextDraft.bundles;
          nextDraft.isLoading = payload?.['isLoading'] === true;
        } else if (type === 'NextActionsBar') {
          nextDraft.isLoading = payload?.['isLoading'] === true;
        } else if (type === 'ProductResearchCard') {
          nextDraft.summary = readLiteralOrPath(payload?.['summary']);
          nextDraft.bullets = Array.isArray(payload?.['bullets'])
            ? (payload['bullets'] as unknown[])
                .map((b) => readLiteralOrPath(b))
                .filter((b): b is string => typeof b === 'string' && b.length > 0)
            : [];
          nextDraft.isLoading = payload?.['isLoading'] === true;
        }
      }
    }

    if ('dataModelUpdate' in operation && operation.dataModelUpdate) {
      const { surfaceId, contents } = (operation as DataModelUpdateOperation).dataModelUpdate;

      for (const entry of contents) {
        if (entry.key === 'items') {
          productsBySurface[surfaceId] = (entry.valueMap ?? [])
            .map((item: ValueMapItem) => toProductRecord(item))
            .filter((item: ProductRecord | null): item is ProductRecord => item !== null);
        }

        if (entry.key === 'actions') {
          const draft = ensureDraft(drafts, nextOrderById, surfaceId, 'NextActionsBar');
          draft.actions = (entry.valueMap ?? [])
            .map((item: ValueMapItem) => toNextAction(item))
            .filter((item: NextAction | null): item is NextAction => item !== null);
        }
      }
    }
  }

  return { drafts, productsBySurface };
}

export function applyActivitySnapshot(
  previous: SurfaceState,
  content: ActivitySnapshotContent
): SurfaceState {
  // Activity snapshots can arrive repeatedly for the same surface. We rebuild
  // the ordered surface map from drafts so later snapshots replace prior state
  // while preserving stable render ordering.
  const { drafts, productsBySurface } = collectDrafts(content.operations, previous);
  const surfacesById: Record<string, RenderableCommerceSurface> = {};

  for (const draft of Object.values(drafts)) {
    const surface = draftToSurface(draft, productsBySurface);
    if (surface) {
      surfacesById[surface.surfaceId] = surface;
    }
  }

  return {
    orderById: { ...previous.orderById, ...Object.fromEntries(
      Object.values(drafts).map((draft) => [draft.surfaceId, draft.order])
    ) },
    surfacesById
  };
}

export function createEmptySurfaceState(): SurfaceState {
  return {
    orderById: {},
    surfacesById: {}
  };
}

export function getRenderableSurfaces(state: SurfaceState): RenderableCommerceSurface[] {
  const all = Object.values(state.surfacesById);
  const realComponentTypes = new Set(
    all
      .filter((surface) => !surface.surfaceId.startsWith('skeleton-'))
      .map((surface) => surface.componentType),
  );
  return all
    .filter(
      (surface) =>
        !surface.surfaceId.startsWith('skeleton-') ||
        !realComponentTypes.has(surface.componentType),
    )
    .sort(
      (left, right) => state.orderById[left.surfaceId] - state.orderById[right.surfaceId],
    );
}
