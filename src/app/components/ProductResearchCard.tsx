import { formatPrice } from '../formatting';
import type { ProductResearchCardSurface } from '../models';
import { Skeleton, SkeletonReveal } from './Skeleton';

type ProductResearchCardProps = {
  surface: ProductResearchCardSurface;
};

export function ProductResearchCard({ surface }: ProductResearchCardProps) {
  const product = surface.product;
  const formattedPrice = product ? formatPrice(product.ec_promo_price ?? product.ec_price) : '';

  return (
    <section className="surface research">
      {surface.isLoading ? (
        <div className="research-loading" role="status" aria-label="Loading product research">
          <SkeletonReveal delay={0.1}>
            <article className="research-product">
              <Skeleton className="skeleton-research-image" />
              <Skeleton className="skeleton-line skeleton-research-product-name" />
              <Skeleton className="skeleton-line skeleton-research-price" />
            </article>
          </SkeletonReveal>
          <article className="research-content">
            <SkeletonReveal delay={0.35}>
              <section className="research-summary-card skeleton-research-summary">
                <Skeleton className="skeleton-research-icon" />
                <div className="skeleton-research-copy">
                  <Skeleton className="skeleton-line skeleton-research-heading" />
                  <Skeleton className="skeleton-line skeleton-research-subheading" />
                </div>
              </section>
            </SkeletonReveal>
            <div className="skeleton-research-lines">
              {Array.from({ length: 5 }, (_, index) => (
                <SkeletonReveal key={index} delay={0.55 + index * 0.1}>
                  <Skeleton className={`skeleton-line skeleton-research-line line-${index + 1}`} />
                </SkeletonReveal>
              ))}
            </div>
          </article>
        </div>
      ) : (
        <div className="research-grid">
          <article className="research-product">
            {product?.ec_image && (
              <img
                className="research-product-image"
                src={product.ec_image}
                alt={product.ec_name}
                loading="lazy"
                decoding="async"
              />
            )}
            <div className="research-product-meta">
              <strong>{product?.ec_name}</strong>
              <span className="price">{formattedPrice}</span>
            </div>
          </article>

          <article className="research-content">
            <section className="research-summary-card">
              <header className="research-summary-header">
                <div className="research-icon" aria-hidden="true">
                  ✦
                </div>
                <div className="research-summary-meta">
                  <h4>AI-Generated Summary</h4>
                  <p>Generated based on product specs</p>
                </div>
              </header>
              <p className="research-summary-text">{surface.summary}</p>
            </section>

            {surface.bullets.length > 0 && (
              <>
                <h5>Key Features</h5>
                <ul className="research-bullets">
                  {surface.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              </>
            )}
          </article>
        </div>
      )}
    </section>
  );
}
