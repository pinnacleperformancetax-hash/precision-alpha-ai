from flask import Flask, request, jsonify
from flask_cors import CORS
import os, requests, json

app = Flask(__name__)
CORS(app, origins=["https://precision-alpha-ai.netlify.app", "http://localhost:3000", "*"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ALPACA_KEY = os.environ.get("ALPACA_KEY", "")
ALPACA_SECRET = os.environ.get("ALPACA_SECRET", "")
ALPACA_DATA_URL = "https://data.alpaca.markets/v2"
ALPACA_BASE_URL = os.environ.get("ALPACA_BASE_URL", "https://paper-api.alpaca.markets/v2")

def alpaca_headers():
    return {
        "APCA-API-KEY-ID": ALPACA_KEY,
        "APCA-API-SECRET-KEY": ALPACA_SECRET,
        "Content-Type": "application/json"
    }

@app.route("/")
def index():
    return jsonify({"status": "Precision Alpha Backend Online"})

@app.route("/api/bars/<symbol>")
def get_bars(symbol):
    try:
        start = request.args.get("start", "")
        end = request.args.get("end", "")
        url = f"{ALPACA_DATA_URL}/stocks/{symbol}/bars?timeframe=1Day&start={start}&end={end}&limit=5"
        res = requests.get(url, headers=alpaca_headers(), timeout=10)
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/quote/<symbol>")
def get_quote(symbol):
    try:
        url = f"{ALPACA_DATA_URL}/stocks/{symbol}/trades/latest"
        res = requests.get(url, headers=alpaca_headers(), timeout=10)
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/account")
def get_account():
    try:
        res = requests.get(f"{ALPACA_BASE_URL}/account", headers=alpaca_headers(), timeout=10)
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/positions")
def get_positions():
    try:
        res = requests.get(f"{ALPACA_BASE_URL}/positions", headers=alpaca_headers(), timeout=10)
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/orders", methods=["GET", "POST"])
def orders():
    try:
        if request.method == "POST":
            body = request.get_json()
            res = requests.post(f"{ALPACA_BASE_URL}/orders", headers=alpaca_headers(), json=body, timeout=10)
        else:
            status = request.args.get("status", "all")
            limit = request.args.get("limit", "50")
            res = requests.get(f"{ALPACA_BASE_URL}/orders?status={status}&limit={limit}", headers=alpaca_headers(), timeout=10)
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/ai/analyze", methods=["POST"])
def ai_analyze():
    try:
        data = request.get_json()
        prompt = data.get("prompt", "")
        max_tokens = data.get("max_tokens", 500)
        res = requests.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": max_tokens,
                "messages": [{"role": "user", "content": prompt}]
            },
            timeout=25
        )
        return jsonify(res.json()), res.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
