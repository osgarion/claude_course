import { Hono } from "hono";

import { requireStaff } from "../auth/middleware.js";
import { serializeUser } from "../serialize.js";
import type { AppEnv } from "../types.js";

// Správa uživatelů - celý blok jen pro provozovatele (jako kupóny). Slouží
// k přepínání rolí (is_staff) a aktivace/deaktivace účtu, ne k editaci
// profilu nebo hesel. Hesla se sem vědomě nedávají - reset řeší jiný tok.
const adminUsers = new Hono<AppEnv>();

/** Výpis uživatelů + volitelné ?search přes e-mail/jméno/příjmení. */
adminUsers.get("/", requireStaff, async (c) => {
  const search = c.req.query("search")?.trim();
  const statement = search
    ? c.env.DB.prepare(
        `SELECT * FROM users
          WHERE email LIKE ?1 OR first_name LIKE ?1 OR last_name LIKE ?1
          ORDER BY date_joined DESC`,
      ).bind(`%${search}%`)
    : c.env.DB.prepare(`SELECT * FROM users ORDER BY date_joined DESC`);

  const { results } = await statement.all();
  return c.json((results ?? []).map(serializeUser));
});

/** Přepnutí is_staff / is_active. Obě pole volitelná (merge vzor). */
adminUsers.patch("/:id", requireStaff, async (c) => {
  const me = c.get("user")!;
  const id = Number(c.req.param("id"));

  const existing = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<any>();
  if (!existing) return c.json({ detail: "Uživatel nenalezen." }, 404);

  const body = await c.req.json().catch(() => ({}));

  if (body.is_staff !== undefined && typeof body.is_staff !== "boolean") {
    return c.json({ is_staff: ["Musí být boolean."] }, 400);
  }
  if (body.is_active !== undefined && typeof body.is_active !== "boolean") {
    return c.json({ is_active: ["Musí být boolean."] }, 400);
  }

  // Pojistka proti sebe-zamčení: provozovatel si nesmí sám odebrat práva ani
  // se deaktivovat - jinak by se šlo omylem nevratně vyhodit z adminu (a
  // deaktivovaný účet se navíc nepřihlásí). Přes cizí účet klidně, jen ne přes svůj.
  if (id === me.id) {
    if (body.is_staff === false) {
      return c.json({ is_staff: ["Nemůžeš sám sobě odebrat práva provozovatele."] }, 400);
    }
    if (body.is_active === false) {
      return c.json({ is_active: ["Nemůžeš deaktivovat vlastní účet."] }, 400);
    }
  }

  const isStaff = body.is_staff !== undefined ? (body.is_staff ? 1 : 0) : existing.is_staff;
  const isActive = body.is_active !== undefined ? (body.is_active ? 1 : 0) : existing.is_active;

  const updated = await c.env.DB.prepare(
    `UPDATE users SET is_staff = ?, is_active = ? WHERE id = ? RETURNING *`,
  )
    .bind(isStaff, isActive, id)
    .first<any>();
  return c.json(serializeUser(updated));
});

export default adminUsers;
