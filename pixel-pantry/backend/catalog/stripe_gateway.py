"""Tenká vrstva nad Stripe SDK pro platbu kartou (Payment Intent flow).

Aktivní jen když je nastaven settings.STRIPE_SECRET_KEY; views.py bez
klíče používá fake platbu (viz OrderPayAPIView).
"""
from decimal import Decimal

import stripe
from django.conf import settings


def to_minor_units(amount):
    """Decimal v hlavní měnové jednotce -> int v nejmenší (10.50 -> 1050)."""
    return int((amount * 100).quantize(Decimal("1")))


def payment_intent_for(order):
    """Vrátí otevřený PaymentIntent pro objednávku, případně ho založí.

    Id intentu se ukládá na objednávku, aby opakované kliknutí na
    "Zaplatit" nezakládalo nové (a nezanechávalo opuštěné) intenty.
    """
    stripe.api_key = settings.STRIPE_SECRET_KEY
    if order.payment_intent_id:
        intent = stripe.PaymentIntent.retrieve(order.payment_intent_id)
        if intent.status not in ("succeeded", "canceled"):
            return intent
    intent = stripe.PaymentIntent.create(
        amount=to_minor_units(order.total),
        currency=settings.STRIPE_CURRENCY,
        metadata={"order_id": str(order.id)},
        automatic_payment_methods={"enabled": True},
    )
    order.payment_intent_id = intent.id
    order.save(update_fields=["payment_intent_id", "updated_at"])
    return intent


def retrieve_intent(intent_id):
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe.PaymentIntent.retrieve(intent_id)
