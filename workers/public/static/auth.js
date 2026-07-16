// ---------- Přihlášení (token v localStorage) ----------
//
// Django verze používala session cookie + CSRF token. Workers nemají session
// framework, takže tady je token auth: token se posílá v hlavičce
// Authorization. CSRF tím úplně odpadá (není to cookie).
//
// Kompromis: token v localStorage je čitelný přes XSS, na rozdíl od
// HttpOnly cookie. Viz poznámka v CLAUDE.md.

const TOKEN_KEY = "pixelpantry_token";
const USER_KEY = "pixelpantry_user";

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function isAuthenticated() {
  return Boolean(getToken());
}

/** Vykreslí pravou část hlavičky podle toho, jestli je někdo přihlášený. */
function renderNavAuth() {
  const nav = document.getElementById("nav-auth");
  if (!nav) return;

  const user = getUser();
  if (user) {
    const adminLink = user.is_staff ? `<a href="/admin">Admin</a>` : "";
    nav.innerHTML = `${adminLink}<span>Ahoj, ${user.email}</span> <a href="#" id="logout-link">Odhlásit</a>`;
    document.getElementById("logout-link").addEventListener("click", async (event) => {
      event.preventDefault();
      await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      clearAuth();
      window.location.href = "/";
    });
  } else {
    nav.innerHTML = `<a href="/prihlaseni">Přihlásit</a>`;
  }
}

document.addEventListener("DOMContentLoaded", renderNavAuth);
