import { formatPrice } from '../formatting';
import type { ProductResearchCardSurface } from '../models';

type ProductResearchCardProps = {
  surface: ProductResearchCardSurface;
};

export function ProductResearchCard({ surface }: ProductResearchCardProps) {
  const product = surface.product;
  const formattedPrice = product ? formatPrice(product.ec_promo_price ?? product.ec_price) : '';

  return (
    <section className="surface research">
      {surface.isLoading ? (
        <div className="research-loading"></div>
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
