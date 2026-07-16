/**
 * Zakládání, placení a rušení objednávek. Tohle je nejcitlivější kód
 * celé aplikace - D1 nemá interaktivní transakce ani SELECT FOR UPDATE,
 * takže bezpečnost stojí na dvou trikách. Nesahat na ně bez přečtení
 * komentářů níž.
 */
import { discountFor, isValidNow, type Coupon } from "../domain/coupon.js";
import { effectivePriceCents } from "../domain/variant.js";
import type { AuthUser } from "../types.js";

export class OrderError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(JSON.stringify(body));
  }
}

export interface OrderItemInput {
  product: number;
  variant?: number | null;
  quantity: number;
}

export interface AddressInput {
  full_name: string;
  street: string;
  city: string;
  postal_code: string;
  country: string;
  phone?: string;
}

export interface CreateOrderInput {
  items: OrderItemInput[];
  shipping_address?: number;
  shipping_address_input?: AddressInput;
  coupon_code?: string;
}

const nowIso = () => new Date().toISOString();

/** Sloučí řádky mířící na stejný (produkt, varianta), ať sedí kontrola skladu. */
function mergeItems(items: OrderItemInput[]): OrderItemInput[] {
  const merged = new Map<string, OrderItemInput>();
  for (const item of items) {
    const variant = item.variant ?? null;
    const key = `${item.product}:${variant ?? "-"}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      merged.set(key, { product: item.product, variant, quantity: item.quantity });
    }
  }
  return [...merged.values()];
}

async function resolveShippingAddress(
  db: D1Database,
  user: AuthUser | null,
  input: CreateOrderInput,
): Promise<number> {
  const hasExisting = input.shipping_address !== undefined;
  const hasInline = input.shipping_address_input !== undefined;

  if (hasExisting === hasInline) {
    throw new OrderError(400, {
      detail:
        "Zadej buď shipping_address (existující adresu), nebo shipping_address_input (novou adresu), ne obojí ani nic.",
    });
  }

  if (hasExisting) {
    // Anonym nesmí přilepit na objednávku cizí adresu podle jejího ID.
    // (Django tuhle kontrolu dělá jen pro přihlášené, takže tam host může
    // poslat libovolné existující ID adresy - tady je to vědomě zavřené.)
    if (!user) {
      throw new OrderError(400, {
        shipping_address: ["Bez přihlášení použij shipping_address_input."],
      });
    }
    const address = await db
      .prepare(`SELECT id FROM addresses WHERE id = ? AND user_id = ?`)
      .bind(input.shipping_address, user.id)
      .first<{ id: number }>();
    if (!address) {
      throw new OrderError(400, { shipping_address: ["Adresa nenalezena."] });
    }
    return address.id;
  }

  const a = input.shipping_address_input!;
  const inserted = await db
    .prepare(
      `INSERT INTO addresses (user_id, full_name, street, city, postal_code, country, phone)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(
      user?.id ?? null,
      a.full_name,
      a.street,
      a.city,
      a.postal_code,
      a.country,
      a.phone ?? "",
    )
    .first<{ id: number }>();
  return inserted!.id;
}

async function resolveCoupon(db: D1Database, code: string | undefined): Promise<Coupon | null> {
  if (!code) return null;
  const coupon = await db
    .prepare(`SELECT * FROM coupons WHERE code = ?`)
    .bind(code.trim())
    .first<Coupon>();
  if (!coupon || !isValidNow(coupon)) {
    throw new OrderError(400, { coupon_code: ["Neplatný nebo expirovaný slevový kód."] });
  }
  return coupon;
}

export async function createOrder(
  db: D1Database,
  user: AuthUser | null,
  input: CreateOrderInput,
): Promise<string> {
  const items = mergeItems(input.items);
  if (items.length === 0) {
    throw new OrderError(400, { detail: "Objednávka musí obsahovat aspoň jednu položku." });
  }

  const coupon = await resolveCoupon(db, input.coupon_code);
  const shippingAddressId = await resolveShippingAddress(db, user, input);

  // --- Fáze A: načtení cen a předběžná kontrola skladu (jen čtení) ---
  // Předběžná kontrola existuje kvůli hezké hlášce ("dostupno 2, požadováno 5").
  // NENÍ to bezpečnostní prvek - ten je až CHECK constraint ve fázi B.
  const priced: Array<{
    item: OrderItemInput;
    unitPriceCents: number;
    // Snapshot názvu - objednávka je historie, pozdější přejmenování ani
    // smazání produktu ji nesmí přepsat.
    productName: string;
  }> = [];

  for (const item of items) {
    const product = await db
      .prepare(`SELECT id, name, price_cents, stock, is_active FROM products WHERE id = ?`)
      .bind(item.product)
      .first<any>();
    if (!product || !product.is_active) {
      throw new OrderError(400, { detail: `Produkt ${item.product} neexistuje.` });
    }

    let variant: any = null;
    if (item.variant) {
      variant = await db
        .prepare(
          `SELECT id, name, price_override_cents, stock, product_id
             FROM product_variants WHERE id = ?`,
        )
        .bind(item.variant)
        .first<any>();
      // Varianta musí patřit tomu produktu, který přišel v requestu - jinak
      // by šlo koupit levnou variantu k drahému produktu. (Django tohle
      // nekontroluje.)
      if (!variant || variant.product_id !== product.id) {
        throw new OrderError(400, { detail: `Varianta ${item.variant} k tomuto produktu nepatří.` });
      }
    }

    const stock = variant ? variant.stock : product.stock;
    const label = variant ? `${product.name} - ${variant.name}` : product.name;
    if (stock < item.quantity) {
      throw new OrderError(400, {
        detail: `Nedostatek skladem pro '${label}': dostupno ${stock}, požadováno ${item.quantity}.`,
      });
    }

    priced.push({
      item,
      unitPriceCents: effectivePriceCents(product, variant),
      productName: label,
    });
  }

  const subtotalCents = priced.reduce(
    (sum, { item, unitPriceCents }) => sum + unitPriceCents * item.quantity,
    0,
  );
  const discountCents = coupon ? discountFor(coupon, subtotalCents) : 0;
  const totalCents = subtotalCents - discountCents;

  // --- Fáze B: jeden atomický db.batch() ---
  //
  // Odečty skladu jsou NEPODMÍNĚNÉ (`stock = stock - ?`). Kdyby šly do
  // mínusu, sepne CHECK (stock >= 0) ze schématu, D1 vrátí chybu a CELÝ
  // batch (včetně vložené objednávky a položek) se vrátí zpět.
  //
  // Právě proto tu není žádná kompenzační logika: nemůže nastat stav, kdy
  // se odečetly první dvě položky a třetí selhala. A dva souběžné nákupy
  // posledního kusu skončí tak, že jeden projde a druhý spadne celý.
  //
  // Podmíněný `WHERE stock >= ?` by NEFUNGOVAL: UPDATE, který netrefí
  // žádný řádek, není v SQL chyba, takže by batch v klidu commitnul
  // objednávku bez odečtu skladu.
  //
  // ID objednávky generujeme dopředu (UUID), protože v batchi nejde
  // přečíst výsledek předchozího statementu (autoincrement bychom nezjistili).
  const orderId = crypto.randomUUID();
  const guestToken = user ? null : crypto.randomUUID();
  const timestamp = nowIso();

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO orders (id, user_id, shipping_address_id, status, coupon_id,
                             subtotal_cents, discount_cents, total_cents,
                             guest_token, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        orderId,
        user?.id ?? null,
        shippingAddressId,
        coupon?.id ?? null,
        subtotalCents,
        discountCents,
        totalCents,
        guestToken,
        timestamp,
        timestamp,
      ),
  ];

  for (const { item, unitPriceCents, productName } of priced) {
    statements.push(
      item.variant
        ? db
            .prepare(`UPDATE product_variants SET stock = stock - ? WHERE id = ?`)
            .bind(item.quantity, item.variant)
        : db
            .prepare(`UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ?`)
            .bind(item.quantity, timestamp, item.product),
    );
    statements.push(
      db
        .prepare(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, quantity, unit_price_cents)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          orderId,
          item.product,
          item.variant ?? null,
          productName,
          item.quantity,
          unitPriceCents,
        ),
    );
  }

  try {
    await db.batch(statements);
  } catch (error) {
    const message = String(error);
    if (message.includes("CHECK constraint failed")) {
      // Sem se dostaneme jen při skutečném souběhu (mezi fází A a B někdo
      // stihl koupit poslední kus). Konkrétní položku záměrně neřešíme -
      // poctivá odpověď je "někdo tě předběhl, zkus to znovu".
      throw new OrderError(409, {
        detail: "Zboží mezitím někdo koupil, zkus objednávku prosím znovu.",
      });
    }
    throw error;
  }

  return orderId;
}

/**
 * Označí objednávku zaplacenou. Podmíněný UPDATE je zároveň zámek: dvojí
 * volání (dvojklik na "Zaplatit", nebo webhook + confirm_payment race u
 * Stripe) nemůže vytvořit dvě platby, protože druhý pokus trefí 0 řádků a
 * vrátí tu první (idempotentní, ne chyba).
 *
 * Sdílené mezi fake platbou (payOrder), Stripe confirm_payment a Stripe
 * webhookem - všechny tři cesty musí "zaplatit" znamenat totéž.
 */
export async function markOrderPaid(
  db: D1Database,
  order: any,
  provider: string,
  transactionId: string,
  method: string = "card",
): Promise<any> {
  const timestamp = nowIso();

  const claim = await db
    .prepare(`UPDATE orders SET status = 'paid', updated_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(timestamp, order.id)
    .run();

  if (claim.meta.changes === 0) {
    const fresh = await db.prepare(`SELECT status FROM orders WHERE id = ?`).bind(order.id).first<any>();
    if (fresh?.status !== "paid") {
      throw new OrderError(400, {
        detail: `Objednávku ve stavu ${fresh?.status} nelze zaplatit.`,
      });
    }
    // idempotentní: vrať existující platbu, nepřepisuj ji
    return db.prepare(`SELECT * FROM payments WHERE order_id = ?`).bind(order.id).first();
  }

  await db
    .prepare(
      `INSERT INTO payments (order_id, amount_cents, method, status, provider, transaction_id, paid_at)
       VALUES (?, ?, ?, 'completed', ?, ?, ?)
       ON CONFLICT(order_id) DO NOTHING`,
    )
    .bind(order.id, order.total_cents, method, provider, transactionId, timestamp)
    .run();

  return db.prepare(`SELECT * FROM payments WHERE order_id = ?`).bind(order.id).first();
}

/** Fake platba (bez STRIPE_SECRET_KEY) - okamžitě "zaplaceno". */
export async function payOrder(db: D1Database, order: any, method: string): Promise<any> {
  const transactionId = crypto.randomUUID().replace(/-/g, "");
  return markOrderPaid(db, order, "fake", transactionId, method);
}

/**
 * Zrušení + vrácení zboží na sklad.
 *
 * Nejdřív se podmíněným UPDATEm "zabere" přechod stavu a teprve pak se
 * vrací sklad. Kdyby se obojí dalo do jednoho batche, druhé (opakované)
 * zrušení by sice nezměnilo žádnou objednávku, ale sklad by přičetlo
 * ZNOVU. Takhle projde jen ten request, jehož UPDATE trefil řádek.
 *
 * Známé okno: pokud Worker umře mezi zabráním a vrácením skladu, zůstane
 * objednávka zrušená a zboží nevrácené. Selhává to konzervativně (spíš
 * neprodáme, než abychom prodali dvakrát); úplné uzavření chce cron
 * sweeper - etapa 2.
 */
export async function cancelOrder(db: D1Database, order: any): Promise<void> {
  const items = await db
    .prepare(`SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = ?`)
    .bind(order.id)
    .all();

  const claim = await db
    .prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = ?
        WHERE id = ? AND status IN ('pending', 'paid')`,
    )
    .bind(nowIso(), order.id)
    .run();

  if (claim.meta.changes === 0) {
    throw new OrderError(400, {
      detail: `Objednávku ve stavu ${order.status} nelze zrušit.`,
    });
  }

  // product_id/variant_id může být NULL, když byl produkt mezitím smazán
  // z katalogu (položka žije dál díky snapshotu názvu). Vracet sklad není
  // kam, takže takovou položku přeskočíme.
  const restock = (items.results ?? [])
    .filter((item: any) => item.variant_id ?? item.product_id)
    .map((item: any) =>
      item.variant_id
        ? db
            .prepare(`UPDATE product_variants SET stock = stock + ? WHERE id = ?`)
            .bind(item.quantity, item.variant_id)
        : db
            .prepare(`UPDATE products SET stock = stock + ? WHERE id = ?`)
            .bind(item.quantity, item.product_id),
    );

  if (restock.length > 0) await db.batch(restock);
}
