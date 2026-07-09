// ---------- Košík (localStorage, sdílený mezi index/detail/checkout stránkami) ----------

const CART_KEY = "pixelpantry_cart";

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

function addToCart(item) {
  const cart = getCart();
  const existing = cart.find(
    (line) => line.productId === item.productId && line.variantId === item.variantId
  );
  if (existing) {
    existing.quantity += item.quantity;
  } else {
    cart.push(item);
  }
  saveCart(cart);
}

function cartItemCount() {
  return getCart().reduce((sum, line) => sum + line.quantity, 0);
}

function updateCartBadge() {
  const el = document.getElementById("cart-count");
  if (el) el.textContent = cartItemCount();
}

// Django nastaví csrftoken cookie, jakmile stránka vykreslí {% csrf_token %} -
// pro POST/PUT/DELETE přes fetch ho musíme poslat ručně v hlavičce.
function getCsrfToken() {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

function apiFetch(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const headers = { "Content-Type": "application/json", ...options.headers };
  if (!["GET", "HEAD", "OPTIONS", "TRACE"].includes(method)) {
    headers["X-CSRFToken"] = getCsrfToken();
  }
  return fetch(url, { ...options, headers, credentials: "same-origin" });
}

// ---------- Seznam produktů (index.html) ----------

function initProductList() {
  const productGrid = document.getElementById("product-grid");
  const placeholderImage = "https://placehold.co/300x300/6c5ce7/ffffff?text=Produkt";

  function renderProducts(products) {
    if (products.length === 0) {
      productGrid.innerHTML = "<p>Zatím žádné produkty.</p>";
      return;
    }

    productGrid.innerHTML = products
      .map((product) => `
        <article class="product-card">
          <a href="/produkt/${product.slug}/" class="product-card-link">
            <img src="${product.image_url || placeholderImage}" alt="${product.name}">
            <h3>${product.name}</h3>
          </a>
          <p class="price">${product.price} Kč</p>
          <button
            class="btn-add-to-cart"
            data-product-id="${product.id}"
            data-product-name="${product.name}"
            data-product-price="${product.price}"
            ${product.stock === 0 ? "disabled" : ""}
          >${product.stock === 0 ? "Vyprodáno" : "Přidat do košíku"}</button>
        </article>
      `)
      .join("");
  }

  productGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".btn-add-to-cart");
    if (!button) return;

    addToCart({
      productId: Number(button.dataset.productId),
      variantId: null,
      name: button.dataset.productName,
      price: Number(button.dataset.productPrice),
      quantity: 1,
    });
    updateCartBadge();
  });

  fetch("/api/products/")
    .then((response) => response.json())
    .then(renderProducts)
    .catch((error) => {
      console.error("Nepodařilo se načíst produkty:", error);
      productGrid.innerHTML = "<p>Produkty se nepodařilo načíst.</p>";
    });
}

// ---------- Detail produktu (product_detail.html) ----------

function initProductDetail() {
  const root = document.getElementById("product-detail");
  const slug = document.body.dataset.productSlug;
  const isAuthenticated = document.body.dataset.userAuthenticated === "true";
  const placeholderImage = "https://placehold.co/500x500/6c5ce7/ffffff?text=Produkt";

  let product = null;
  let selectedVariantId = null;

  function currentVariant() {
    return selectedVariantId
      ? product.variants.find((v) => v.id === selectedVariantId)
      : null;
  }

  function currentPrice() {
    return currentVariant() ? currentVariant().price : product.price;
  }

  function currentStock() {
    return currentVariant() ? currentVariant().stock : product.stock;
  }

  function renderReviews() {
    if (product.reviews.length === 0) {
      return "<p>Zatím žádné recenze.</p>";
    }
    return product.reviews
      .map(
        (r) => `
          <article class="review-card">
            <strong>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</strong>
            <span class="review-author">${r.user}</span>
            <p>${r.comment}</p>
          </article>
        `
      )
      .join("");
  }

  function renderReviewFormOrLoginPrompt() {
    if (isAuthenticated) {
      return `
        <form id="review-form" class="review-form">
          <label for="review-rating">Hodnocení</label>
          <select id="review-rating" required>
            <option value="5">5 - výborné</option>
            <option value="4">4 - dobré</option>
            <option value="3">3 - průměrné</option>
            <option value="2">2 - podprůměrné</option>
            <option value="1">1 - špatné</option>
          </select>
          <label for="review-comment">Komentář</label>
          <textarea id="review-comment"></textarea>
          <button type="submit" class="btn-primary">Přidat recenzi</button>
          <p id="review-message"></p>
        </form>
      `;
    }
    return `<p><a href="/accounts/login/?next=${window.location.pathname}">Přihlas se</a>, abys mohl/a přidat recenzi.</p>`;
  }

  function renderProduct() {
    const mainImage = (product.images[0] && product.images[0].image) || product.image_url || placeholderImage;

    root.innerHTML = `
      <div class="product-detail-gallery">
        <img src="${mainImage}" alt="${product.name}">
      </div>
      <div class="product-detail-info">
        <h1>${product.name}</h1>
        ${product.category ? `<p class="category-tag">${product.category.name}</p>` : ""}
        <p class="price" id="detail-price">${currentPrice()} Kč</p>
        <p class="description">${product.description}</p>

        ${
          product.variants.length > 0
            ? `
          <label for="variant-select">Varianta</label>
          <select id="variant-select">
            <option value="">— vyberte —</option>
            ${product.variants
              .map(
                (v) =>
                  `<option value="${v.id}">${v.name} (${v.stock > 0 ? "skladem" : "vyprodáno"})</option>`
              )
              .join("")}
          </select>
        `
            : ""
        }

        <p id="stock-info">${currentStock() > 0 ? `Skladem: ${currentStock()} ks` : "Vyprodáno"}</p>

        <button id="detail-add-to-cart" class="btn-add-to-cart" ${currentStock() === 0 ? "disabled" : ""}>
          Přidat do košíku
        </button>
      </div>

      <section class="reviews-section">
        <h2>Recenze</h2>
        <div id="reviews-list">${renderReviews()}</div>
        ${renderReviewFormOrLoginPrompt()}
      </section>
    `;

    const variantSelect = document.getElementById("variant-select");
    if (variantSelect) {
      variantSelect.addEventListener("change", () => {
        selectedVariantId = variantSelect.value ? Number(variantSelect.value) : null;
        document.getElementById("detail-price").textContent = `${currentPrice()} Kč`;
        document.getElementById("stock-info").textContent =
          currentStock() > 0 ? `Skladem: ${currentStock()} ks` : "Vyprodáno";
        document.getElementById("detail-add-to-cart").disabled = currentStock() === 0;
      });
    }

    document.getElementById("detail-add-to-cart").addEventListener("click", () => {
      if (product.variants.length > 0 && !selectedVariantId) {
        alert("Nejdřív vyber variantu.");
        return;
      }
      addToCart({
        productId: product.id,
        variantId: selectedVariantId,
        name: currentVariant() ? `${product.name} (${currentVariant().name})` : product.name,
        price: currentPrice(),
        quantity: 1,
      });
      updateCartBadge();
    });

    const reviewForm = document.getElementById("review-form");
    if (reviewForm) {
      reviewForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const rating = Number(document.getElementById("review-rating").value);
        const comment = document.getElementById("review-comment").value;
        const messageEl = document.getElementById("review-message");

        apiFetch(`/api/products/${product.id}/reviews/`, {
          method: "POST",
          body: JSON.stringify({ rating, comment }),
        })
          .then((response) => {
            if (!response.ok) throw new Error();
            messageEl.textContent = "Díky! Recenze čeká na schválení.";
            reviewForm.reset();
          })
          .catch(() => {
            messageEl.textContent = "Recenzi se nepodařilo uložit (možná už jsi hodnotil/a tento produkt).";
          });
      });
    }
  }

  fetch(`/api/products/${slug}/`)
    .then((response) => response.json())
    .then((data) => {
      product = data;
      renderProduct();
    })
    .catch(() => {
      root.innerHTML = "<p>Produkt se nepodařilo načíst.</p>";
    });
}

// ---------- Pokladna (checkout.html) ----------

function initCheckout() {
  const summaryEl = document.getElementById("checkout-summary");
  const addressListEl = document.getElementById("address-list");
  const messageEl = document.getElementById("checkout-message");
  const placeOrderBtn = document.getElementById("place-order-btn");
  const newAddressForm = document.getElementById("new-address-form");

  let selectedAddressId = null;

  function renderCartSummary() {
    const cart = getCart();
    if (cart.length === 0) {
      summaryEl.innerHTML = "<p>Košík je prázdný.</p>";
      placeOrderBtn.disabled = true;
      return;
    }
    placeOrderBtn.disabled = false;
    const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0);
    summaryEl.innerHTML = `
      <ul class="checkout-items">
        ${cart.map((line) => `<li>${line.quantity}× ${line.name} — ${line.price * line.quantity} Kč</li>`).join("")}
      </ul>
      <p class="checkout-total">Celkem: ${total} Kč</p>
    `;
  }

  function renderAddresses(addresses) {
    if (!Array.isArray(addresses) || addresses.length === 0) {
      addressListEl.innerHTML = "<p>Zatím nemáš uloženou adresu, přidej ji níže.</p>";
      selectedAddressId = null;
      return;
    }
    addressListEl.innerHTML = addresses
      .map(
        (a, i) => `
        <label class="address-option">
          <input type="radio" name="address" value="${a.id}" ${i === 0 ? "checked" : ""}>
          ${a.full_name}, ${a.street}, ${a.city} ${a.postal_code}, ${a.country}
        </label>
      `
      )
      .join("");
    selectedAddressId = addresses[0].id;

    addressListEl.querySelectorAll("input[name=address]").forEach((input) => {
      input.addEventListener("change", () => {
        selectedAddressId = Number(input.value);
      });
    });
  }

  function loadAddresses() {
    return apiFetch("/api/addresses/")
      .then((response) => {
        if (response.status === 401 || response.status === 403) {
          window.location.href = `/accounts/login/?next=${window.location.pathname}`;
          return [];
        }
        return response.json();
      })
      .then(renderAddresses);
  }

  newAddressForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(newAddressForm).entries());

    apiFetch("/api/addresses/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then((response) => response.json())
      .then(() => {
        newAddressForm.reset();
        return loadAddresses();
      });
  });

  placeOrderBtn.addEventListener("click", () => {
    if (!selectedAddressId) {
      messageEl.textContent = "Vyber nebo přidej doručovací adresu.";
      return;
    }
    const cart = getCart();
    const payload = {
      shipping_address: selectedAddressId,
      items: cart.map((line) => ({
        product: line.productId,
        variant: line.variantId,
        quantity: line.quantity,
      })),
    };

    apiFetch("/api/orders/", {
      method: "POST",
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw data;

        saveCart([]);
        updateCartBadge();
        renderCartSummary();
        placeOrderBtn.disabled = true;

        messageEl.innerHTML = `Objednávka #${data.id} vytvořena. <button id="pay-btn" class="btn-primary">Zaplatit</button>`;
        document.getElementById("pay-btn").addEventListener("click", () => {
          apiFetch(`/api/orders/${data.id}/pay/`, {
            method: "POST",
            body: JSON.stringify({}),
          })
            .then((r) => r.json())
            .then(() => {
              messageEl.textContent = "Zaplaceno, děkujeme za nákup!";
            });
        });
      })
      .catch((error) => {
        messageEl.textContent = typeof error === "object" ? JSON.stringify(error) : String(error);
      });
  });

  renderCartSummary();
  loadAddresses();
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartBadge();

  if (document.getElementById("product-grid")) initProductList();
  if (document.getElementById("product-detail")) initProductDetail();
  if (document.getElementById("checkout-summary")) initCheckout();
});
