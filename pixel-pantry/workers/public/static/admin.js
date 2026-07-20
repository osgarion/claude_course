// ---------- Administrace (admin.html) ----------
//
// Reálné vynucení "jen provozovatel obchodu" je vždycky na serveru
// (requireStaff na každém zapisovacím requestu) - tahle kontrola je čistě
// UX, ať běžný přihlášený zákazník neuvidí prázdné formuláře, které stejně
// nemůže použít.

function initAdmin() {
  const user = getUser();
  if (!user || !user.is_staff) {
    document.getElementById("admin-denied").hidden = false;
    return;
  }
  document.getElementById("admin-content").hidden = false;

  initUserAdmin();
  initProductAdmin();
  initCouponAdmin();
  initOrderAdmin();
  initReviewAdmin();
}

// ---------- Uživatelé ----------

function initUserAdmin() {
  const searchForm = document.getElementById("user-search-form");
  const searchField = document.getElementById("user-search");
  const rowsEl = document.getElementById("user-rows");

  function renderRows(users) {
    rowsEl.innerHTML = users
      .map(
        (u) => `
        <tr>
          <td>${u.email}</td>
          <td>${[u.first_name, u.last_name].filter(Boolean).join(" ")}</td>
          <td><input type="checkbox" data-staff="${u.id}" ${u.is_staff ? "checked" : ""}></td>
          <td><input type="checkbox" data-active="${u.id}" ${u.is_active ? "checked" : ""}></td>
        </tr>`,
      )
      .join("");

    rowsEl.querySelectorAll("[data-staff]").forEach((box) => {
      box.addEventListener("change", () => patchUser(box.dataset.staff, { is_staff: box.checked }, box));
    });
    rowsEl.querySelectorAll("[data-active]").forEach((box) => {
      box.addEventListener("change", () => patchUser(box.dataset.active, { is_active: box.checked }, box));
    });
  }

  async function patchUser(id, payload, box) {
    const response = await apiFetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const data = await response.json();
      // Server odmítl (typicky sebe-zamčení) - vrať checkbox zpět a řekni proč.
      box.checked = !box.checked;
      alert(data.detail || Object.values(data)[0]?.[0] || "Změnu se nepodařilo uložit.");
    }
  }

  function loadUsers(search) {
    const query = search ? `?search=${encodeURIComponent(search)}` : "";
    return apiFetch(`/api/admin/users${query}`)
      .then((r) => r.json())
      .then(renderRows);
  }

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadUsers(searchField.value.trim());
  });

  loadUsers();
}

// ---------- Produkty ----------

function initProductAdmin() {
  const form = document.getElementById("product-form");
  const idField = document.getElementById("product-id");
  const nameField = document.getElementById("product-name");
  const categoryField = document.getElementById("product-category");
  const priceField = document.getElementById("product-price");
  const stockField = document.getElementById("product-stock");
  const descriptionField = document.getElementById("product-description");
  const activeField = document.getElementById("product-active");
  const submitBtn = document.getElementById("product-submit-btn");
  const cancelBtn = document.getElementById("product-cancel-btn");
  const messageEl = document.getElementById("product-message");
  const rowsEl = document.getElementById("product-rows");

  // Obrázky produktu - podsekce viditelná jen při editaci konkrétního produktu
  // (při zakládání ještě produkt neexistuje, není kam obrázek pověsit).
  const imagesSection = document.getElementById("product-images-section");
  const imageRowsEl = document.getElementById("product-image-rows");
  const imageForm = document.getElementById("product-image-form");
  const imageUrlField = document.getElementById("image-url");
  const imageAltField = document.getElementById("image-alt");
  const imagePrimaryField = document.getElementById("image-primary");
  const imageMessageEl = document.getElementById("image-message");

  function renderImages(images) {
    imageRowsEl.innerHTML = images
      .map(
        (img) => `
        <tr>
          <td><a href="${img.image}" target="_blank" rel="noopener">${img.image}</a></td>
          <td>${img.alt_text || ""}</td>
          <td>${img.is_primary ? "★" : ""}</td>
          <td><button type="button" class="btn-secondary" data-image-delete="${img.id}">Smazat</button></td>
        </tr>`,
      )
      .join("");

    imageRowsEl.querySelectorAll("[data-image-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await apiFetch(`/api/products/${idField.value}/images/${btn.dataset.imageDelete}`, { method: "DELETE" });
        loadImages(idField.value);
      });
    });
  }

  function loadImages(productId) {
    return apiFetch(`/api/products/${productId}/images`)
      .then((r) => r.json())
      .then(renderImages);
  }

  imageForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    imageMessageEl.textContent = "";
    const response = await apiFetch(`/api/products/${idField.value}/images`, {
      method: "POST",
      body: JSON.stringify({
        image_url: imageUrlField.value.trim(),
        alt_text: imageAltField.value,
        is_primary: imagePrimaryField.checked,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      imageMessageEl.textContent = data.detail || Object.values(data)[0]?.[0] || "Přidání se nezdařilo.";
      return;
    }
    imageForm.reset();
    loadImages(idField.value);
  });

  function resetForm() {
    form.reset();
    idField.value = "";
    activeField.checked = true;
    submitBtn.textContent = "Založit produkt";
    cancelBtn.hidden = true;
    imagesSection.hidden = true;
  }

  function fillForm(product) {
    idField.value = product.id;
    nameField.value = product.name;
    categoryField.value = product.category ?? "";
    priceField.value = product.price;
    stockField.value = product.stock;
    descriptionField.value = product.description ?? "";
    activeField.checked = product.is_active;
    submitBtn.textContent = "Uložit změny";
    cancelBtn.hidden = false;
    imagesSection.hidden = false;
    imageMessageEl.textContent = "";
    loadImages(product.id);
  }

  function renderRows(products) {
    rowsEl.innerHTML = products
      .map(
        (p) => `
        <tr>
          <td>${p.name}</td>
          <td>${p.price} Kč</td>
          <td>${p.stock}</td>
          <td>${p.is_active ? "ano" : "ne"}</td>
          <td>
            <button type="button" class="btn-secondary" data-edit="${p.id}">Upravit</button>
            <button type="button" class="btn-secondary" data-delete="${p.id}">Smazat</button>
          </td>
        </tr>`,
      )
      .join("");

    rowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const product = products.find((p) => p.id === Number(btn.dataset.edit));
        if (product) fillForm(product);
      });
    });
    rowsEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Opravdu smazat tenhle produkt?")) return;
        await apiFetch(`/api/products/${btn.dataset.delete}`, { method: "DELETE" });
        loadProducts();
      });
    });
  }

  function loadProducts() {
    return apiFetch("/api/products?all=1")
      .then((r) => r.json())
      .then(renderRows);
  }

  function loadCategories() {
    return fetch("/api/categories")
      .then((r) => r.json())
      .then((categories) => {
        categoryField.innerHTML =
          `<option value="">— bez kategorie —</option>` +
          categories.map((cat) => `<option value="${cat.id}">${cat.name}</option>`).join("");
      });
  }

  cancelBtn.addEventListener("click", resetForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageEl.textContent = "";

    const payload = {
      name: nameField.value.trim(),
      category: categoryField.value ? Number(categoryField.value) : null,
      price: priceField.value.trim(),
      stock: Number(stockField.value),
      description: descriptionField.value,
      is_active: activeField.checked,
    };

    const id = idField.value;
    const url = id ? `/api/products/${id}` : "/api/products";
    const method = id ? "PATCH" : "POST";

    const response = await apiFetch(url, { method, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) {
      messageEl.textContent = data.detail || Object.values(data)[0]?.[0] || "Uložení se nezdařilo.";
      return;
    }

    resetForm();
    loadProducts();
  });

  loadCategories();
  loadProducts();
}

// ---------- Kupóny ----------

function initCouponAdmin() {
  const form = document.getElementById("coupon-form");
  const idField = document.getElementById("coupon-id");
  const codeField = document.getElementById("coupon-code");
  const typeField = document.getElementById("coupon-type");
  const valueField = document.getElementById("coupon-value");
  const activeField = document.getElementById("coupon-active");
  const submitBtn = document.getElementById("coupon-submit-btn");
  const cancelBtn = document.getElementById("coupon-cancel-btn");
  const messageEl = document.getElementById("coupon-message");
  const rowsEl = document.getElementById("coupon-rows");

  function resetForm() {
    form.reset();
    idField.value = "";
    activeField.checked = true;
    submitBtn.textContent = "Založit kupón";
    cancelBtn.hidden = true;
  }

  function fillForm(coupon) {
    idField.value = coupon.id;
    codeField.value = coupon.code;
    typeField.value = coupon.discount_type;
    valueField.value = coupon.value;
    activeField.checked = coupon.is_active;
    submitBtn.textContent = "Uložit změny";
    cancelBtn.hidden = false;
  }

  function renderRows(coupons) {
    rowsEl.innerHTML = coupons
      .map(
        (cpn) => `
        <tr>
          <td>${cpn.code}</td>
          <td>${cpn.discount_type === "percent" ? "%" : "Kč"}</td>
          <td>${cpn.value}</td>
          <td>${cpn.is_active ? "ano" : "ne"}</td>
          <td>
            <button type="button" class="btn-secondary" data-edit="${cpn.id}">Upravit</button>
            <button type="button" class="btn-secondary" data-delete="${cpn.id}">Smazat</button>
          </td>
        </tr>`,
      )
      .join("");

    rowsEl.querySelectorAll("[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const coupon = coupons.find((cpn) => cpn.id === Number(btn.dataset.edit));
        if (coupon) fillForm(coupon);
      });
    });
    rowsEl.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("Opravdu smazat tenhle kupón?")) return;
        await apiFetch(`/api/coupons/${btn.dataset.delete}`, { method: "DELETE" });
        loadCoupons();
      });
    });
  }

  function loadCoupons() {
    return apiFetch("/api/coupons")
      .then((r) => r.json())
      .then(renderRows);
  }

  cancelBtn.addEventListener("click", resetForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    messageEl.textContent = "";

    const payload = {
      code: codeField.value.trim(),
      discount_type: typeField.value,
      value: valueField.value.trim(),
      is_active: activeField.checked,
    };

    const id = idField.value;
    const url = id ? `/api/coupons/${id}` : "/api/coupons";
    const method = id ? "PATCH" : "POST";

    const response = await apiFetch(url, { method, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) {
      messageEl.textContent = data.detail || Object.values(data)[0]?.[0] || "Uložení se nezdařilo.";
      return;
    }

    resetForm();
    loadCoupons();
  });

  loadCoupons();
}

// ---------- Objednávky ----------

function initOrderAdmin() {
  const rowsEl = document.getElementById("order-rows");
  const filterForm = document.getElementById("order-filter-form");
  const statusFilter = document.getElementById("order-status-filter");
  const searchField = document.getElementById("order-search");
  const bulkShipBtn = document.getElementById("order-bulk-ship-btn");

  function renderRows(orders) {
    rowsEl.innerHTML = orders
      .map(
        (order) => `
        <tr>
          <td>${order.status === "paid" ? `<input type="checkbox" data-pick="${order.id}">` : ""}</td>
          <td>${order.customer_email}</td>
          <td>${order.status}</td>
          <td>${order.total} Kč</td>
          <td>${new Date(order.created_at).toLocaleDateString("cs")}</td>
          <td>${order.status === "paid" ? `<button type="button" class="btn-secondary" data-ship="${order.id}">Odeslat</button>` : ""}</td>
        </tr>`,
      )
      .join("");

    rowsEl.querySelectorAll("[data-ship]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await apiFetch(`/api/orders/${btn.dataset.ship}/ship`, { method: "POST" });
        loadOrders();
      });
    });
  }

  function loadOrders() {
    const params = new URLSearchParams();
    if (statusFilter.value) params.set("status", statusFilter.value);
    if (searchField.value.trim()) params.set("search", searchField.value.trim());
    const query = params.toString() ? `?${params}` : "";
    return apiFetch(`/api/orders/admin${query}`)
      .then((r) => r.json())
      .then(renderRows);
  }

  filterForm.addEventListener("submit", (event) => {
    event.preventDefault();
    loadOrders();
  });

  bulkShipBtn.addEventListener("click", async () => {
    const ids = Array.from(rowsEl.querySelectorAll("[data-pick]:checked")).map((box) => box.dataset.pick);
    if (ids.length === 0) return;
    await apiFetch("/api/orders/admin/bulk-ship", { method: "POST", body: JSON.stringify({ ids }) });
    loadOrders();
  });

  loadOrders();
}

// ---------- Recenze ----------

function initReviewAdmin() {
  const rowsEl = document.getElementById("review-rows");
  const emptyEl = document.getElementById("review-empty");

  function renderRows(reviews) {
    const pending = reviews.filter((r) => !r.is_approved);
    emptyEl.hidden = pending.length > 0;
    rowsEl.innerHTML = pending
      .map(
        (review) => `
        <tr>
          <td>${review.user}</td>
          <td>${review.rating}/5</td>
          <td>${review.comment}</td>
          <td><button type="button" class="btn-primary" data-approve="${review.id}">Schválit</button></td>
        </tr>`,
      )
      .join("");

    rowsEl.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await apiFetch(`/api/reviews/${btn.dataset.approve}`, {
          method: "PATCH",
          body: JSON.stringify({ is_approved: true }),
        });
        loadReviews();
      });
    });
  }

  // Recenze nejsou pod jedním "všechny" endpointem - projdeme aktivní
  // produkty a pro každý si vyžádáme jeho recenze (staff vidí i neschválené).
  function loadReviews() {
    return apiFetch("/api/products?all=1")
      .then((r) => r.json())
      .then((products) =>
        Promise.all(
          products.map((p) => apiFetch(`/api/products/${p.id}/reviews`).then((r) => r.json())),
        ),
      )
      .then((perProduct) => renderRows(perProduct.flat()));
  }

  loadReviews();
}

document.addEventListener("DOMContentLoaded", initAdmin);
