#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# mlctl — one-shot setup and run script
# Works on macOS and Linux. Run with:  bash setup_and_run.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

PYTHON_MIN="3.11"
PORT=8000

# ── colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()    { echo -e "${GREEN}[mlctl]${NC} $1"; }
warn()    { echo -e "${YELLOW}[mlctl]${NC} $1"; }
error()   { echo -e "${RED}[mlctl] ERROR:${NC} $1"; exit 1; }
divider() { echo -e "${GREEN}────────────────────────────────────────────────${NC}"; }

divider
echo -e "${GREEN}  mlctl — Agentic ML Platform Agent${NC}"
echo -e "  github.com/isouravsengupta/MCP/mlctl"
divider

# ── Step 1: detect OS ─────────────────────────────────────────────────────────
OS="$(uname -s)"
info "Detected OS: $OS"

# ── Step 2: check / install Python ───────────────────────────────────────────
info "Checking Python..."
PYTHON=""
for cmd in python3.13 python3.12 python3.11 python3 python; do
  if command -v "$cmd" &>/dev/null; then
    VER=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')" 2>/dev/null)
    MAJOR=$(echo "$VER" | cut -d. -f1)
    MINOR=$(echo "$VER" | cut -d. -f2)
    if [ "$MAJOR" -ge 3 ] && [ "$MINOR" -ge 11 ]; then
      PYTHON="$cmd"
      info "Found $PYTHON ($VER) ✓"
      break
    fi
  fi
done

if [ -z "$PYTHON" ]; then
  warn "Python 3.11+ not found. Attempting to install via Homebrew..."
  if ! command -v brew &>/dev/null; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
  fi
  brew install python@3.11
  PYTHON=python3.11
  info "Python 3.11 installed ✓"
fi

# ── Step 3: create virtual environment ───────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -d ".venv" ]; then
  info "Creating virtual environment..."
  "$PYTHON" -m venv .venv
  info "Virtual environment created ✓"
else
  info "Virtual environment already exists ✓"
fi

source .venv/bin/activate

# ── Step 4: install Python dependencies ──────────────────────────────────────
info "Installing Python dependencies..."
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
info "Dependencies installed ✓"

# ── Step 5: seed the database ────────────────────────────────────────────────
info "Seeding demo database..."
python db/setup.py
info "Database ready ✓"

# ── Step 6: detect / install Ollama ──────────────────────────────────────────
divider
info "Checking for Ollama (local LLM — no API key needed)..."

OLLAMA_RUNNING=false
OLLAMA_AVAILABLE=false

if command -v ollama &>/dev/null; then
  OLLAMA_AVAILABLE=true
  info "Ollama binary found ✓"
else
  warn "Ollama not installed."
  if [ "$OS" = "Darwin" ]; then
    info "Installing Ollama via Homebrew..."
    if ! command -v brew &>/dev/null; then
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
    fi
    brew install --cask ollama 2>/dev/null || {
      warn "Homebrew cask install failed — trying direct download..."
      curl -fsSL https://ollama.com/download/ollama-darwin.zip -o /tmp/ollama.zip
      unzip -q /tmp/ollama.zip -d /tmp/ollama_pkg
      mv /tmp/ollama_pkg/Ollama.app /Applications/ 2>/dev/null || true
      # also install the CLI
      curl -fsSL https://ollama.com/install.sh | sh
    }
    OLLAMA_AVAILABLE=true
    info "Ollama installed ✓"
  elif [ "$OS" = "Linux" ]; then
    info "Installing Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    OLLAMA_AVAILABLE=true
    info "Ollama installed ✓"
  else
    warn "Automatic Ollama install not supported on this OS."
    warn "Download manually from https://ollama.com and re-run this script."
  fi
fi

# ── Step 7: start Ollama if not running ──────────────────────────────────────
if [ "$OLLAMA_AVAILABLE" = true ]; then
  if curl -s http://localhost:11434/api/tags &>/dev/null; then
    info "Ollama is already running ✓"
    OLLAMA_RUNNING=true
  else
    info "Starting Ollama in the background..."
    ollama serve &>/tmp/ollama.log &
    OLLAMA_PID=$!
    # wait up to 15 seconds for Ollama to be ready
    for i in $(seq 1 15); do
      sleep 1
      if curl -s http://localhost:11434/api/tags &>/dev/null; then
        OLLAMA_RUNNING=true
        info "Ollama started (pid $OLLAMA_PID) ✓"
        break
      fi
    done
    if [ "$OLLAMA_RUNNING" = false ]; then
      warn "Ollama did not start in time — the UI will still work with an OpenAI key."
    fi
  fi

  # pull the model if not already present
  if [ "$OLLAMA_RUNNING" = true ]; then
    if ollama list 2>/dev/null | grep -q "llama3.2"; then
      info "llama3.2 model already present ✓"
    else
      info "Pulling llama3.2 (this may take a few minutes on first run)..."
      ollama pull llama3.2
      info "llama3.2 ready ✓"
    fi
  fi
fi

# ── Step 8: check if port is already in use ───────────────────────────────────
divider
if lsof -i ":$PORT" &>/dev/null; then
  warn "Port $PORT is already in use. Killing existing process..."
  lsof -ti ":$PORT" | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── Step 9: open browser ──────────────────────────────────────────────────────
info "Will open http://localhost:$PORT once the server is ready..."

open_browser() {
  sleep 3
  if [ "$OS" = "Darwin" ]; then
    open "http://localhost:$PORT"
  elif command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT"
  fi
}
open_browser &

# ── Step 10: start the server ────────────────────────────────────────────────
divider
echo ""
info "Starting mlctl server on http://localhost:$PORT"
echo ""
echo -e "  ${GREEN}No API key?${NC}  The UI defaults to Ollama (local, free)."
echo -e "  ${GREEN}Have OpenAI?${NC} Select OpenAI in the UI and paste your key."
echo ""
echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop."
divider

uvicorn web.app:app --port $PORT
