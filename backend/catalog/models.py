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
    # DecimalField místo FloatField - u peněz chceme přesnou, ne
    # zaokrouhlenou binární reprezentaci desetinného čísla.
    price = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True)
    image_url = models.URLField(blank=True)
    stock = models.IntegerField(default=0)

    def __str__(self):
        return self.name
