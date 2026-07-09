// Čekáme, až prohlížeč načte celou strukturu HTML (DOM), než se pokusíme
// najít prvky pomocí document.querySelector — jinak by skript mohl běžet
// dřív, než tlačítka vůbec existují.
document.addEventListener("DOMContentLoaded", () => {

  const cartCountEl = document.getElementById("cart-count");
  const addToCartButtons = document.querySelectorAll(".btn-add-to-cart");

  // počet položek v košíku držíme v jedné proměnné v paměti
  // (zatím nikam neukládáme, po refresh stránky se vynuluje)
  let cartCount = 0;

  addToCartButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const productName = button.dataset.productName;

      console.log(`Přidáno do košíku: ${productName}`);

      cartCount += 1;
      cartCountEl.textContent = cartCount;
    });
  });

  // ---------- Filtr podle kategorií ----------

  const filterButtons = document.querySelectorAll(".filter-btn");
  const productCards = document.querySelectorAll(".product-card");

  filterButtons.forEach((filterButton) => {
    filterButton.addEventListener("click", () => {
      const selectedCategory = filterButton.dataset.category;

      // vizuálně zvýrazníme jen kliknuté tlačítko jako aktivní
      filterButtons.forEach((btn) => btn.classList.remove("active"));
      filterButton.classList.add("active");

      // u každé karty porovnáme její kategorii s vybraným filtrem
      // a podle toho ji buď necháme zobrazenou, nebo skryjeme
      productCards.forEach((card) => {
        const matchesCategory =
          selectedCategory === "vse" || card.dataset.category === selectedCategory;

        card.style.display = matchesCategory ? "" : "none";
      });
    });
  });

});
