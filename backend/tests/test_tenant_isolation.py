"""Cross-tenant access control helpers."""

from __future__ import annotations

from app.deps import user_can_access_tenant
from app.models import User


class _FakeQuery:
    def __init__(self, result):
        self._result = result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._result


class _FakeDb:
    def __init__(self, membership_exists: bool):
        self._membership_exists = membership_exists

    def query(self, model):
        return _FakeQuery(object() if self._membership_exists else None)


def test_org_user_only_own_tenant():
    user = User(id=1, email="u@x.com", password_hash="x", role="admin", tenant_id=5)
    db = _FakeDb(False)
    assert user_can_access_tenant(db, user, 5) is True
    assert user_can_access_tenant(db, user, 9) is False


def test_platform_admin_requires_membership():
    user = User(id=2, email="p@x.com", password_hash="x", role="platform_admin", tenant_id=None)
    assert user_can_access_tenant(_FakeDb(True), user, 3) is True
    assert user_can_access_tenant(_FakeDb(False), user, 3) is False
