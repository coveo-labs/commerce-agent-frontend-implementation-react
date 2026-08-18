import { useRef } from 'react';
import { productCta } from '../discovery-config';
import { formatPrice } from '../formatting';
import type { ProductCarouselSurface, ProductRecord } from '../models';

type ProductCarouselProps = {
  surface: ProductCarouselSurface;
};

const PLACEHOLDERS = Array.from({ length: 4 }, (_, index) => index);

// ===========================================================================
// PRODUCT CTA → PDP logic
// ---------------------------------------------------------------------------
// This is the wiring between a product tile and its PDP link. All the actual
// decisions (URL pattern, label, new-tab, analytics) live in `productCta` in
// discovery-config.ts — the helpers below just delegate. Integrators should NOT
// need to edit this component: change the `productCta.buildPdpUrl`
// placeholder in the config instead.
// ===========================================================================

const ctaTarget = productCta.openInNewTab ? '_blank' : undefined;
/** Security best-practice rel when opening PDPs in a new tab. */
const ctaRel = productCta.openInNewTab ? 'noopener noreferrer' : undefined;

export function ProductCarousel({ surface }: ProductCarouselProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  const scrollBy = (direction: 1 | -1) => {
    const el = gridRef.current;
    if (!el) {
      return;
    }
    const distance = Math.max(el.clientWidth - 80, 240);
    el.scrollBy({ left: distance * direction, behavior: 'smooth' });
  };

  return (
    <section className="surface">
      <header className="surface-header">
        <div>
          <p className="surface-kicker">Product Carousel</p>
          <h3>{surface.heading}</h3>
        </div>
        {!surface.isLoading && surface.products.length > 0 && (
          <div className="carousel-controls">
            <span className="carousel-count">{surface.products.length} results</span>
            <button
              type="button"
              className="carousel-arrow"
              aria-label="Scroll previous"
              onClick={() => scrollBy(-1)}
            >
              ‹
            </button>
            <button
              type="button"
              className="carousel-arrow"
              aria-label="Scroll next"
              onClick={() => scrollBy(1)}
            >
              ›
            </button>
          </div>
        )}
      </header>

      {surface.isLoading ? (
        <div className="loading-grid">
          {PLACEHOLDERS.map((index) => (
            <div key={index} className="loading-card"></div>
          ))}
        </div>
      ) : (
        <div
          className="carousel-grid"
          ref={gridRef}
          style={{
            gridTemplateRows: surface.products.length >= 8 ? 'repeat(2, minmax(0, 1fr))' : '1fr',
          }}
        >
          {surface.products.map((item) => (
            // PRODUCT TILE = PDP link. The whole tile is the CTA: its href +
            // click behaviour are driven entirely by the productCta config in
            // discovery-config.ts — this markup stays as-is.
            <a
              key={item.ec_product_id}
              className="product-card"
              href={productCta.buildPdpUrl(item)}
              target={ctaTarget}
              rel={ctaRel}
              onClick={() => onCtaClick(item)}
            >
              {item.ec_image ? (
                <img
                  className="product-image"
                  src={item.ec_image}
                  alt={item.ec_name}
                  loading="lazy"
                  decoding="async"
                  onError={onImageError}
                />
              ) : (
                <div
                  className="swatch"
                  style={{
                    background: item.accent || 'linear-gradient(135deg, #e2e5f0, #b8bfd6)',
                  }}
                ></div>
              )}
              <p className="brand">{item.ec_brand}</p>
              <h4>{item.ec_name}</h4>
              <div className="footer">
                <span className="price-group">
                  <strong>{formatPrice(item.ec_promo_price ?? item.ec_price)}</strong>
                  {item.ec_promo_price && <span className="sale-tag">Sale price</span>}
                </span>
                <span className="view-details">
                  {productCta.label}
                  <span className="product-cta-arrow" aria-hidden="true">
                    →
                  </span>
                </span>
              </div>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/** Fire the optional analytics hook on click (navigation still proceeds). */
function onCtaClick(product: ProductRecord): void {
  productCta.onSelect?.(product);
}

function onImageError(event: React.SyntheticEvent<HTMLImageElement>): void {
  event.currentTarget.dataset['broken'] = 'true';
}
