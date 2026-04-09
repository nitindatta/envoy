import os

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client() -> TestClient:
    os.environ.setdefault("INTERNAL_AUTH_SECRET", "test-secret")
    from app.main import create_app

    return TestClient(create_app())


def test_health_endpoint(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["service"] == "job-agent"
    assert body["status"] == "up"
