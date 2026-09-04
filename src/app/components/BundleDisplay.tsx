import { formatPrice } from '../formatting';
import type { BundleDisplaySurface, BundleDisplayTier } from '../models';
import { Skeleton, SkeletonReveal } from './Skeleton';

type BundleDisplayProps = {
  surface: BundleDisplaySurface;
};

export function BundleDisplay({ surface }: BundleDisplayProps) {
  return (
    <section className="surface">
      <header className="surface-header stacked">
        <p className="surface-kicker">Bundle Display</p>
        <h3>{surface.title}</h3>
      </header>

      {surface.isLoading ? (
        <div className="bundle-loading-grid">
          <article className="bundle-loading-card" role="status" aria-label="Loading bundle">
            <SkeletonReveal delay={0.1}>
              <Skeleton className="skeleton-line skeleton-bundle-title" />
            </SkeletonReveal>
            <SkeletonReveal delay={0.3}>
              <div className="skeleton-tabs">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="skeleton-tab" />
                ))}
              </div>
            </SkeletonReveal>
            <SkeletonReveal delay={0.5}>
              <Skeleton className="skeleton-line skeleton-bundle-description" />
            </SkeletonReveal>
            <SkeletonReveal delay={0.58}>
              <Skeleton className="skeleton-line skeleton-bundle-description short" />
            </SkeletonReveal>
            <div className="slot-grid bundle-skeleton-slots">
              {Array.from({ length: 3 }, (_, index) => (
                <SkeletonReveal key={index} delay={0.75 + index * 0.18}>
                  <div className="slot skeleton-slot">
                    <Skeleton className="skeleton-slot-image" />
                    <Skeleton className="skeleton-line skeleton-slot-label" />
                    <Skeleton className="skeleton-line skeleton-slot-name" />
                    <Skeleton className="skeleton-line skeleton-slot-price" />
                  </div>
                </SkeletonReveal>
              ))}
            </div>
          </article>
        </div>
      ) : (
        surface.bundles.map((bundle) => (
          <article key={bundle.bundleId} className="bundle-card">
            <div className="bundle-head">
              <h4>{bundle.label}</h4>
              <p>{bundle.description}</p>
            </div>

            <div className="slot-grid">
              {bundle.slots.map((slot) => {
                const price = slotPrice(slot.product);
                return (
                  <div key={`${slot.surfaceRef}:${slot.categoryLabel}`} className="slot">
                    {slot.product?.ec_image && (
                      <img
                        className="slot-image"
                        src={slot.product.ec_image}
                        alt={slot.product.ec_name}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                    <span className="slot-label">{slot.categoryLabel}</span>
                    <strong>{slot.product?.ec_name || 'Pending selection'}</strong>
                    <small>{slot.product?.ec_brand || '—'}</small>
                    {price !== null && <span className="slot-price">{formatPrice(price)}</span>}
                    {slot.product?.description && <p>{slot.product.description}</p>}
                  </div>
                );
              })}
            </div>

            <footer className="bundle-total">
              <span className="bundle-total-label">Bundle total</span>
              <strong className="bundle-total-value">{formatPrice(bundleTotal(bundle))}</strong>
            </footer>
          </article>
        ))
      )}
    </section>
  );
}

function slotPrice(
  product: { ec_promo_price?: number; ec_price?: number } | null | undefined,
): number | null {
  if (!product) {
    return null;
  }
  const value = product.ec_promo_price ?? product.ec_price;
  return typeof value === 'number' && value > 0 ? value : null;
}

function bundleTotal(bundle: BundleDisplayTier): number {
  return bundle.slots.reduce((sum, slot) => sum + (slotPrice(slot.product) ?? 0), 0);
}
