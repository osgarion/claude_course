/** Cena varianty produktu - port ProductVariant.price property. */

export interface PricedVariant {
  price_override_cents: number | null;
}

export interface PricedProduct {
  price_cents: number;
}

/**
 * Varianta bez price_override padá zpět na cenu produktu.
 *
 * POZOR: rozhoduje `=== null`, ne pravdivostní test - price_override_cents
 * rovné 0 je platná cena (zdarma) a MUSÍ přebít cenu produktu. `||` by ji
 * tady tiše zahodilo.
 */
export function effectivePriceCents(
  product: PricedProduct,
  variant: PricedVariant | null | undefined,
): number {
  if (variant && variant.price_override_cents !== null) {
    return variant.price_override_cents;
  }
  return product.price_cents;
}
