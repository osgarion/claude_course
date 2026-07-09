from django.urls import path

from .views import CategoryDetailAPIView, CategoryListCreateAPIView, ProductListAPIView

urlpatterns = [
    path("products/", ProductListAPIView.as_view(), name="product-list"),
    path("categories/", CategoryListCreateAPIView.as_view(), name="category-list"),
    path(
        "categories/<int:pk>/",
        CategoryDetailAPIView.as_view(),
        name="category-detail",
    ),
]
