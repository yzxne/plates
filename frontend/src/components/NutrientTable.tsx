// Calories, macro tiles and the small facts line. Same look on Add food and Edit food.
import type { Nutrients } from '../../../shared/nutrition';
import { fmt } from '../format';

export function NutrientTable({ n }: { n: Nutrients }) {
  return (
    <div class="nutrients">
      <div class="kcal"><strong>{fmt(n.kcal)}</strong> kcal</div>
      <div class="macro-grid">
        <div><strong>{fmt(n.protein_g, 1)}</strong><span>Protein g</span></div>
        <div><strong>{fmt(n.carbs_g, 1)}</strong><span>Carbs g</span></div>
        <div><strong>{fmt(n.fat_g, 1)}</strong><span>Fat g</span></div>
      </div>
      {(n.fiber_g != null || n.sugar_g != null || n.sodium_mg != null) && (
        <small class="muted">{[
          n.fiber_g != null && `Fiber ${fmt(n.fiber_g, 1)} g`,
          n.sugar_g != null && `Sugar ${fmt(n.sugar_g, 1)} g`,
          n.sodium_mg != null && `Sodium ${fmt(n.sodium_mg)} mg`,
        ].filter(Boolean).join(' · ')}</small>
      )}
    </div>
  );
}
