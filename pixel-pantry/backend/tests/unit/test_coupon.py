"""Coupon.discount_for/is_valid_now: čistá logika na nesavovaných instancích."""
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from catalog.models import Coupon


def _coupon(**kwargs):
    defaults = dict(code="TEST", discount_type=Coupon.DISCOUNT_PERCENT, value=Decimal("10"))
    defaults.update(kwargs)
    return Coupon(**defaults)


def test_percent_discount():
    coupon = _coupon(discount_type=Coupon.DISCOUNT_PERCENT, value=Decimal("10"))
    assert coupon.discount_for(Decimal("200.00")) == Decimal("20.00")


def test_fixed_discount():
    coupon = _coupon(discount_type=Coupon.DISCOUNT_FIXED, value=Decimal("50"))
    assert coupon.discount_for(Decimal("200.00")) == Decimal("50.00")


def test_fixed_discount_capped_at_subtotal():
    coupon = _coupon(discount_type=Coupon.DISCOUNT_FIXED, value=Decimal("500"))
    assert coupon.discount_for(Decimal("200.00")) == Decimal("200.00")


def test_discount_quantized_to_cents():
    coupon = _coupon(discount_type=Coupon.DISCOUNT_PERCENT, value=Decimal("33.333"))
    assert coupon.discount_for(Decimal("10.00")) == Decimal("3.33")


def test_is_valid_now_respects_is_active():
    coupon = _coupon(is_active=False)
    assert coupon.is_valid_now() is False


def test_is_valid_now_respects_validity_window():
    now = timezone.now()
    coupon = _coupon(is_active=True, valid_from=now - timedelta(days=1), valid_to=now + timedelta(days=1))
    assert coupon.is_valid_now() is True

    expired = _coupon(is_active=True, valid_to=now - timedelta(days=1))
    assert expired.is_valid_now() is False

    not_yet = _coupon(is_active=True, valid_from=now + timedelta(days=1))
    assert not_yet.is_valid_now() is False


def test_is_valid_now_true_without_any_window():
    coupon = _coupon(is_active=True)
    assert coupon.is_valid_now() is True
