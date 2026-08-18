// Dispatches each RenderableCommerceSurface to its renderer (the React
// equivalent of the Angular NgComponentOutlet dispatcher).
import type { RenderableCommerceSurface } from '../models';
import { BundleDisplay } from './BundleDisplay';
import { ComparisonSummary } from './ComparisonSummary';
import { ComparisonTable } from './ComparisonTable';
import { NextActionsBar } from './NextActionsBar';
import { ProductCarousel } from './ProductCarousel';
import { ProductResearchCard } from './ProductResearchCard';

type SurfaceOutletProps = {
  surface: RenderableCommerceSurface;
  onQuickAction: (action: string) => void;
};

export function SurfaceOutlet({ surface, onQuickAction }: SurfaceOutletProps) {
  switch (surface.componentType) {
    case 'ProductCarousel':
      return <ProductCarousel surface={surface} />;
    case 'ComparisonTable':
      return <ComparisonTable surface={surface} />;
    case 'ComparisonSummary':
      return <ComparisonSummary surface={surface} />;
    case 'BundleDisplay':
      return <BundleDisplay surface={surface} />;
    case 'NextActionsBar':
      return <NextActionsBar surface={surface} onSelectAction={onQuickAction} />;
    case 'ProductResearchCard':
      return <ProductResearchCard surface={surface} />;
    default:
      return null;
  }
}
