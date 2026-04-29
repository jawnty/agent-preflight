# Agent Preflight — vhs demo tape
#
# Render with:
#   brew install vhs
#   cd /path/to/agent-preflight
#   vhs docs/demo.tape
#
# Produces docs/demo.gif. Uses only local fixtures, so no LINEAR_API_KEY
# or network access is required.

Output docs/demo.gif

Set Shell        "zsh"
Set FontSize     14
Set FontFamily   "Menlo"
Set Width        1120
Set Height       680
Set Padding      24
Set Theme        "Dracula"
Set TypingSpeed  35ms

Hide
Type "clear" Enter
Sleep 200ms
Show

# ── Frame 1: a vague ticket scores not_ready ────────────────────────────
Type "# Vague ticket → not_ready"
Enter
Sleep 400ms
Type "node bin/agent-preflight.js check fixtures/vague.md"
Sleep 400ms
Enter
Sleep 3500ms

# ── Frame 2: a well-formed bug ticket scores ready ──────────────────────
Type "clear" Enter
Sleep 200ms
Type "# Well-formed ticket → ready"
Enter
Sleep 400ms
Type "node bin/agent-preflight.js check fixtures/ready-bug.md"
Sleep 400ms
Enter
Sleep 3500ms

# ── Frame 3: upgrade rewrites the weak ticket into agent-ready shape ────
Type "clear" Enter
Sleep 200ms
Type "# Upgrade drafts a normalized rewrite (truncated for the demo)"
Enter
Sleep 400ms
Type "node bin/agent-preflight.js upgrade fixtures/vague.md --dry-run | head -32"
Sleep 400ms
Enter
Sleep 4500ms

# ── Frame 4: artifact-aware — "Build Tetris" is detected as a product_spec ──
Type "clear" Enter
Sleep 200ms
Type "# A high-level build request is detected as a product_spec, not a ticket"
Enter
Sleep 400ms
Type "node bin/agent-preflight.js check fixtures/build-tetris.md"
Sleep 400ms
Enter
Sleep 4000ms

# ── Frame 5: --ignore-state lets you preflight a closed Linear ticket ───
Type "clear" Enter
Sleep 200ms
Type "# --ignore-state: preflight a closed/cancelled ticket (e.g. for post-mortems)"
Enter
Sleep 400ms
Type "# LINEAR_API_KEY=... agent-preflight check ENG-123 --ignore-state"
Sleep 2500ms

Sleep 800ms
