from app.state.envelope import ToolEnvelope


def test_envelope_parses_ok_response() -> None:
    raw = {"status": "ok", "data": {"service": "node-tool-service"}}
    envelope = ToolEnvelope.model_validate(raw)
    assert envelope.status == "ok"
    assert envelope.data == {"service": "node-tool-service"}
    assert envelope.error is None


def test_envelope_parses_error_response() -> None:
    raw = {"status": "error", "error": {"type": "unauthorized", "message": "missing header"}}
    envelope = ToolEnvelope.model_validate(raw)
    assert envelope.status == "error"
    assert envelope.error is not None
    assert envelope.error.type == "unauthorized"


def test_envelope_parses_drift_response() -> None:
    raw = {
        "status": "drift",
        "drift": {
            "parser_id": "seek_listing_v1",
            "expected": "10 job cards",
            "observed": "0 matches",
        },
    }
    envelope = ToolEnvelope.model_validate(raw)
    assert envelope.status == "drift"
    assert envelope.drift is not None
    assert envelope.drift.parser_id == "seek_listing_v1"
