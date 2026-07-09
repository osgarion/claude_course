// Čekáme, až prohlížeč načte celou strukturu HTML (DOM), než se pokusíme
// najít prvky pomocí document.querySelector — jinak by skript mohl běžet
// dřív, než tlačítka vůbec existují.
document.addEventListener("DOMContentLoaded", () => {

  const cartCountEl = document.getElementById("cart-count");
  const productGrid = document.getElementById("product-grid");

  // počet položek v košíku držíme v jedné proměnné v paměti
  // (zatím nikam neukládáme, po refresh stránky se vynuluje)
  let cartCount = 0;

  const placeholderImage = "https://placehold.co/300x300/6c5ce7/ffffff?text=Produkt";

  function renderProducts(products) {
    if (products.length === 0) {
      productGrid.innerHTML = "<p>Zatím žádné produkty.</p>";
      return;
    }

    productGrid.innerHTML = products
      .map((product) => `
        <article class="product-card">
          <img src="${product.image_url || placeholderImage}" alt="${product.name}">
          <h3>${product.name}</h3>
          <p class="price">${product.price} Kč</p>
          <button class="btn-add-to-cart" data-product-name="${product.name}">Přidat do košíku</button>
        </article>
      `)
      .join("");
  }

  // klik na "Přidat do košíku" řešíme delegovaně na kontejneru gridu,
  // protože karty se vykreslují dynamicky až po načtení z API
  productGrid.addEventListener("click", (event) => {
    const button = event.target.closest(".btn-add-to-cart");
    if (!button) return;

    console.log(`Přidáno do košíku: ${button.dataset.productName}`);

    cartCount += 1;
    cartCountEl.textContent = cartCount;
  });

  fetch("/api/products/")
    .then((response) => response.json())
    .then(renderProducts)
    .catch((error) => {
      console.error("Nepodařilo se načíst produkty:", error);
      productGrid.innerHTML = "<p>Produkty se nepodařilo načíst.</p>";
    });

});
