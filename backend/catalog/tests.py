from decimal import Decimal

from django.contrib.auth.models import User
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Address, Category, Order, Product, Review


class SlugGenerationTests(TestCase):
    """Product a Category si samy doplní slug ze jména, pokud není zadaný."""

    def test_product_slug_auto_generated(self):
        product = Product.objects.create(name="Pixel Hrnek", price=Decimal("299.00"))
        self.assertEqual(product.slug, "pixel-hrnek")

    def test_category_slug_auto_generated(self):
        category = Category.objects.create(name="Hrnky a šálky")
        self.assertEqual(category.slug, "hrnky-a-salky")


class StockControlTests(TestCase):
    """Objednávka nesmí projít, pokud by přesáhla dostupný stock."""

    def setUp(self):
        self.user = User.objects.create_user("zakaznik", password="heslo123")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.address = Address.objects.create(
            user=self.user,
            full_name="Jan Novák",
            street="Ulice 1",
            city="Praha",
            postal_code="10000",
            country="Česko",
        )
        self.product = Product.objects.create(name="Triko", price=Decimal("500.00"), stock=2)

    def _order_payload(self, quantity):
        return {
            "shipping_address": self.address.id,
            "items": [{"product": self.product.id, "variant": None, "quantity": quantity}],
        }

    def test_order_exceeding_stock_is_rejected(self):
        response = self.client.post("/api/orders/", self._order_payload(5), format="json")
        self.assertEqual(response.status_code, 400)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 2)

    def test_valid_order_decrements_stock(self):
        response = self.client.post("/api/orders/", self._order_payload(2), format="json")
        self.assertEqual(response.status_code, 201)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 0)


class ConcurrentPurchaseTests(TestCase):
    """Dva pokusy koupit poslední kus - druhý musí selhat, ne oba projít."""

    def setUp(self):
        self.product = Product.objects.create(name="Poslední kus", price=Decimal("100.00"), stock=1)

        self.user_a = User.objects.create_user("zakaznik_a", password="heslo123")
        self.user_b = User.objects.create_user("zakaznik_b", password="heslo123")

        self.address_a = Address.objects.create(
            user=self.user_a, full_name="A", street="X", city="Y", postal_code="1", country="CZ"
        )
        self.address_b = Address.objects.create(
            user=self.user_b, full_name="B", street="X", city="Y", postal_code="1", country="CZ"
        )

    def _order(self, user, address):
        client = APIClient()
        client.force_authenticate(user)
        payload = {
            "shipping_address": address.id,
            "items": [{"product": self.product.id, "variant": None, "quantity": 1}],
        }
        return client.post("/api/orders/", payload, format="json")

    def test_second_buyer_cannot_buy_already_sold_last_item(self):
        first_response = self._order(self.user_a, self.address_a)
        second_response = self._order(self.user_b, self.address_b)

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 400)

        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 0)


class PermissionsTests(TestCase):
    """Cizí uživatel nemá přístup k cizím adresám/objednávkám; recenze bez schválení nejsou veřejné."""

    def setUp(self):
        self.owner_user = User.objects.create_user("owner", password="heslo123", is_staff=True)
        self.user_a = User.objects.create_user("uzivatel_a", password="heslo123")
        self.user_b = User.objects.create_user("uzivatel_b", password="heslo123")
        self.product = Product.objects.create(name="Podložka", price=Decimal("199.00"), stock=5)

        self.address_a = Address.objects.create(
            user=self.user_a, full_name="A", street="X", city="Y", postal_code="1", country="CZ"
        )

    def test_user_cannot_access_foreign_address(self):
        client = APIClient()
        client.force_authenticate(self.user_b)
        response = client.get(f"/api/addresses/{self.address_a.id}/")
        self.assertEqual(response.status_code, 404)

    def test_anonymous_only_sees_approved_reviews(self):
        Review.objects.create(product=self.product, user=self.user_a, rating=5, is_approved=True)
        Review.objects.create(product=self.product, user=self.user_b, rating=1, is_approved=False)

        client = APIClient()
        response = client.get(f"/api/products/{self.product.id}/reviews/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_only_staff_can_create_category(self):
        client = APIClient()
        client.force_authenticate(self.user_a)
        response = client.post("/api/categories/", {"name": "Nová kategorie"}, format="json")
        self.assertEqual(response.status_code, 403)

        client.force_authenticate(self.owner_user)
        response = client.post("/api/categories/", {"name": "Nová kategorie"}, format="json")
        self.assertEqual(response.status_code, 201)


class ReviewUniqueTests(TestCase):
    """Jeden uživatel může produkt recenzovat jen jednou."""

    def setUp(self):
        self.user = User.objects.create_user("recenzent", password="heslo123")
        self.product = Product.objects.create(name="Odznaky", price=Decimal("99.00"), stock=10)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_second_review_from_same_user_is_rejected(self):
        first = self.client.post(
            f"/api/products/{self.product.id}/reviews/",
            {"rating": 5, "comment": "Skvělé"},
            format="json",
        )
        second = self.client.post(
            f"/api/products/{self.product.id}/reviews/",
            {"rating": 3, "comment": "Rozmyslel jsem si to"},
            format="json",
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 400)
        self.assertEqual(Review.objects.filter(product=self.product, user=self.user).count(), 1)
