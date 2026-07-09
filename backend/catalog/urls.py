from django.urls import path

from .views import (
    AddressDetailAPIView,
    AddressListCreateAPIView,
    CategoryDetailAPIView,
    CategoryListCreateAPIView,
    OrderDetailAPIView,
    OrderListCreateAPIView,
    OrderPayAPIView,
    ProductDetailAPIView,
    ProductListAPIView,
    ReviewListCreateAPIView,
)

urlpatterns = [
    path("products/", ProductListAPIView.as_view(), name="product-list"),
    path("products/<slug:slug>/", ProductDetailAPIView.as_view(), name="product-detail"),
    path(
        "products/<int:product_pk>/reviews/",
        ReviewListCreateAPIView.as_view(),
        name="product-review-list",
    ),
    path("categories/", CategoryListCreateAPIView.as_view(), name="category-list"),
    path(
        "categories/<int:pk>/",
        CategoryDetailAPIView.as_view(),
        name="category-detail",
    ),
    path("addresses/", AddressListCreateAPIView.as_view(), name="address-list"),
    path("addresses/<int:pk>/", AddressDetailAPIView.as_view(), name="address-detail"),
    path("orders/", OrderListCreateAPIView.as_view(), name="order-list"),
    path("orders/<int:pk>/", OrderDetailAPIView.as_view(), name="order-detail"),
    path("orders/<int:pk>/pay/", OrderPayAPIView.as_view(), name="order-pay"),
]
