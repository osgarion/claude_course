from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.text import slugify


class Category(models.Model):
    """Kategorie produktů v katalogu eshopu."""

    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, blank=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Product(models.Model):
    """Jeden produkt v katalogu eshopu."""

    name = models.CharField(max_length=255)
    slug = models.SlugField(unique=True, blank=True)
    category = models.ForeignKey(
        Category,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="products",
    )
    # DecimalField místo FloatField - u peněz chceme přesnou, ne
    # zaokrouhlenou binární reprezentaci desetinného čísla.
    price = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    image_url = models.URLField(blank=True)
    stock = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class ProductImage(models.Model):
    """Obrázek produktu (produkt jich může mít víc)."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="products/")
    alt_text = models.CharField(max_length=255, blank=True)
    is_primary = models.BooleanField(default=False)

    def __str__(self):
        return f"Obrázek pro {self.product.name}"


class ProductVariant(models.Model):
    """Varianta produktu (např. barva/velikost) s vlastní cenou a skladem."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=64, unique=True)
    # None = použije se cena z Product, jinak přebije product.price
    price_override = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True
    )
    stock = models.IntegerField(default=0)

    @property
    def price(self):
        return self.price_override if self.price_override is not None else self.product.price

    def __str__(self):
        return f"{self.product.name} - {self.name}"


class Address(models.Model):
    """Doručovací adresa uživatele."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="addresses"
    )
    full_name = models.CharField(max_length=255)
    street = models.CharField(max_length=255)
    city = models.CharField(max_length=255)
    postal_code = models.CharField(max_length=20)
    country = models.CharField(max_length=100)
    phone = models.CharField(max_length=30, blank=True)
    is_default = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.full_name}, {self.city}"


class Order(models.Model):
    """Objednávka zákazníka."""

    STATUS_PENDING = "pending"
    STATUS_PAID = "paid"
    STATUS_SHIPPED = "shipped"
    STATUS_CANCELLED = "cancelled"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Čeká na platbu"),
        (STATUS_PAID, "Zaplaceno"),
        (STATUS_SHIPPED, "Odesláno"),
        (STATUS_CANCELLED, "Zrušeno"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="orders"
    )
    shipping_address = models.ForeignKey(
        Address, on_delete=models.PROTECT, related_name="orders"
    )
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Objednávka #{self.pk}"


class OrderItem(models.Model):
    """Jedna položka v objednávce."""

    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    variant = models.ForeignKey(
        ProductVariant, on_delete=models.PROTECT, null=True, blank=True
    )
    quantity = models.PositiveIntegerField()
    # Snapshot ceny v době objednávky - cena produktu se může časem
    # změnit, ale historická objednávka musí zůstat přesná.
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"{self.quantity}x {self.product.name}"


class Payment(models.Model):
    """Evidence platby k objednávce (bez napojení na reálnou platební bránu)."""

    METHOD_CARD = "card"
    METHOD_BANK_TRANSFER = "bank_transfer"
    METHOD_CASH_ON_DELIVERY = "cash_on_delivery"
    METHOD_CHOICES = [
        (METHOD_CARD, "Platební karta"),
        (METHOD_BANK_TRANSFER, "Bankovní převod"),
        (METHOD_CASH_ON_DELIVERY, "Dobírka"),
    ]

    STATUS_PENDING = "pending"
    STATUS_COMPLETED = "completed"
    STATUS_FAILED = "failed"
    STATUS_CHOICES = [
        (STATUS_PENDING, "Čeká se"),
        (STATUS_COMPLETED, "Dokončeno"),
        (STATUS_FAILED, "Selhalo"),
    ]

    order = models.OneToOneField(Order, on_delete=models.CASCADE, related_name="payment")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    method = models.CharField(max_length=20, choices=METHOD_CHOICES)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=STATUS_PENDING)
    paid_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f"Platba k objednávce #{self.order_id}"


class Review(models.Model):
    """Recenze produktu od zákazníka, čeká na schválení ownerem."""

    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="reviews")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="reviews")
    rating = models.PositiveSmallIntegerField(
        validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    comment = models.TextField(blank=True)
    is_approved = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ("product", "user")

    def __str__(self):
        return f"{self.rating}★ {self.product.name} od {self.user}"
