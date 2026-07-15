/**
 * Převod DB řádků na tvar odpovědi. Peníze jdou na drát jako řetězce
 * ("49.90") stejně jako u DRF, aby frontend nemusel nic přepočítávat a
 * aby se na drátě nikdy neobjevil float.
 */
import { centsToString } from "./domain/money.js";

export function serializeProduct(row: any) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    price: centsToString(row.price_cents),
    description: row.description,
    image_url: row.image_url,
    stock: row.stock,
    // AVG nad prázdnou množinou vrací NULL -> "zatím bez hodnocení",
    // což je jiná informace než 0 hvězdiček
    avg_rating: row.avg_rating === null || row.avg_rating === undefined ? null : Number(row.avg_rating),
    review_count: row.review_count ?? 0,
  };
}

export function serializeCategory(row: any) {
  return { id: row.id, name: row.name, slug: row.slug };
}

export function serializeVariant(row: any, productPriceCents: number) {
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    price: centsToString(
      row.price_override_cents !== null ? row.price_override_cents : productPriceCents,
    ),
    stock: row.stock,
  };
}

export function serializeImage(row: any) {
  return {
    id: row.id,
    image: row.image_url,
    alt_text: row.alt_text,
    is_primary: Boolean(row.is_primary),
  };
}

export function serializeReview(row: any) {
  return {
    id: row.id,
    user: row.user_email,
    rating: row.rating,
    comment: row.comment,
    is_approved: Boolean(row.is_approved),
    created_at: row.created_at,
  };
}

export function serializeAddress(row: any) {
  return {
    id: row.id,
    full_name: row.full_name,
    street: row.street,
    city: row.city,
    postal_code: row.postal_code,
    country: row.country,
    phone: row.phone,
    is_default: Boolean(row.is_default),
  };
}

export function serializeUser(row: any) {
  return {
    id: row.id,
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    is_staff: Boolean(row.is_staff),
    is_active: Boolean(row.is_active),
    date_joined: row.date_joined,
  };
}

export function serializeCoupon(row: any) {
  return {
    id: row.id,
    code: row.code,
    discount_type: row.discount_type,
    value: centsToString(row.value_cents),
    is_active: Boolean(row.is_active),
    valid_from: row.valid_from,
    valid_to: row.valid_to,
  };
}

export function serializePayment(row: any) {
  return {
    id: row.id,
    order: row.order_id,
    amount: centsToString(row.amount_cents),
    method: row.method,
    status: row.status,
    provider: row.provider,
    transaction_id: row.transaction_id,
    paid_at: row.paid_at,
  };
}

export function serializeOrder(order: any, items: any[], couponCode: string | null) {
  return {
    id: order.id,
    shipping_address: order.shipping_address_id,
    status: order.status,
    coupon: couponCode,
    subtotal: centsToString(order.subtotal_cents),
    discount_amount: centsToString(order.discount_cents),
    total: centsToString(order.total_cents),
    // Vrací se jen u objednávek hosta - přihlášený ho nemá (a nepotřebuje).
    guest_token: order.guest_token,
    created_at: order.created_at,
    items: items.map((item) => ({
      id: item.id,
      // null = produkt byl mezitím smazán z katalogu; product_name zůstává
      product: item.product_id,
      product_name: item.product_name,
      variant: item.variant_id,
      quantity: item.quantity,
      unit_price: centsToString(item.unit_price_cents),
    })),
  };
}
