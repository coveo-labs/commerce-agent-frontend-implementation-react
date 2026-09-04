import { Fragment } from 'react';
import { formatPrice } from '../formatting';
import type { ComparisonTableSurface } from '../models';
import { Skeleton, SkeletonReveal } from './Skeleton';

type ComparisonTableProps = {
  surface: ComparisonTableSurface;
};

export function ComparisonTable({ surface }: ComparisonTableProps) {
  const gridColumns = `minmax(120px, auto) repeat(${surface.products.length}, minmax(0, 1fr))`;

  return (
    <section className="surface">
      <header className="surface-header stacked">
        <p className="surface-kicker">Comparison Table</p>
        <h3>{surface.heading}</h3>
      </header>

      {surface.isLoading ? (
        <div className="loading-table" role="status" aria-label="Loading comparison">
          <div className="comparison-skeleton-grid">
            <SkeletonReveal delay={0.1}>
              <Skeleton className="skeleton-line skeleton-table-label" />
            </SkeletonReveal>
            {Array.from({ length: 3 }, (_, index) => (
              <SkeletonReveal key={index} delay={0.2 + index * 0.12}>
                <Skeleton className="skeleton-line skeleton-table-heading" />
              </SkeletonReveal>
            ))}
            {Array.from({ length: 5 }, (_, rowIndex) => (
              <Fragment key={rowIndex}>
                <SkeletonReveal delay={0.55 + rowIndex * 0.18}>
                  <Skeleton className="skeleton-line skeleton-table-label" />
                </SkeletonReveal>
                {Array.from({ length: 3 }, (_, columnIndex) => (
                  <SkeletonReveal
                    key={columnIndex}
                    delay={0.62 + rowIndex * 0.18 + columnIndex * 0.07}
                  >
                    <Skeleton
                      className={rowIndex === 0 ? 'skeleton-table-image' : 'skeleton-line skeleton-table-value'}
                    />
                  </SkeletonReveal>
                ))}
              </Fragment>
            ))}
          </div>
        </div>
      ) : (
        <div className="comparison-grid" style={{ gridTemplateColumns: gridColumns }}>
          <div className="comparison-cell comparison-corner"></div>
          {surface.products.map((product) => (
            <div key={product.ec_product_id} className="comparison-cell comparison-head">
              {product.ec_image && (
                <img
                  className="comparison-image"
                  src={product.ec_image}
                  alt={product.ec_name}
                  loading="lazy"
                  decoding="async"
                />
              )}
              <span className="comparison-brand">{product.ec_brand}</span>
              <strong>{product.ec_name}</strong>
            </div>
          ))}

          {surface.attributes.map((attribute) => (
            <Fragment key={attribute}>
              <div className="comparison-cell comparison-label">{formatLabel(attribute)}</div>
              {surface.products.map((product) => (
                <div key={product.ec_product_id} className="comparison-cell">
                  {product[attribute] || '—'}
                </div>
              ))}
            </Fragment>
          ))}

          <div className="comparison-cell comparison-label">Price</div>
          {surface.products.map((product) => (
            <div key={product.ec_product_id} className="comparison-cell comparison-price">
              {formatPrice(product.ec_promo_price ?? product.ec_price)}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function formatLabel(value: string): string {
  return value.replace(/_/g, ' ');
}
