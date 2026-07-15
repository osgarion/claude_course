from rest_framework import permissions


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Čtení povoleno všem, zápis jen ownerům (is_staff)."""

    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True
        return bool(request.user and request.user.is_staff)


class IsOwnerOfObject(permissions.BasePermission):
    """K objektu (Address/Order/Review) smí jen uživatel, kterému patří.

    Na rozdíl od IsOwnerOrReadOnly, kde "owner" znamená provozovatele
    obchodu (is_staff), tady "owner" znamená zákazníka, jemuž záznam patří.

    Objednávky hostů (bez účtu) mají obj.user_id i request.user.id
    None - bez explicitní kontroly is_authenticated by "None == None"
    omylem pustilo kohokoli anonymního k cizí guest objednávce. Přístup
    hosta ke své objednávce řeší guest_token přímo ve views.py, ne tahle
    třída.
    """

    def has_object_permission(self, request, view, obj):
        if not request.user.is_authenticated:
            return False
        return obj.user_id == request.user.id
