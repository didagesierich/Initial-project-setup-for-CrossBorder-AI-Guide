/*
 * script.js — Market Entry Risk Report Agent
 * Runs in the browser alongside index.html
 * Requires: const GEMINI_API_KEY defined in config.js (loaded before this script)
 *
 * AGENT FLOW:
 *   Step 1 — Review inputs → ask 2–3 clarifying questions if needed
 *   Step 2 — Generate final Market Entry Risk Report
 *
 * Expected HTML elements:
 *   #productInput       — textarea/input: product description
 *   #originInput        — input: country of origin
 *   #targetInput        — input: target market
 *   #submitBtn          — main action button
 *   #resetBtn           — start over button
 *   #statusBar          — status message area
 *   #agentStateBar      — visible agent phase indicator
 *   #agentStateLabel    — text inside state bar
 *   #agentStateIcon     — emoji/icon inside state bar
 *   #agentStateStep     — step label (e.g. "Step 1 of 2")
 *   #clarifyBlock       — hidden div shown when clarification needed
 *   #clarifyList        — <ol> inside clarifyBlock
 *   #clarifyAnswerInput — textarea for user answers
 *   #resultsArea        — where the final report is rendered
 *   #rawJsonBox         — <pre> for raw JSON toggle
 *   #thinkingLog        — agent activity log container
 *   #toolCallsLog       — inner div for individual log entries
 */

"use strict";

/* ════════════════════════════════
   CONSTANTS
════════════════════════════════ */

const GEMINI_MODEL    = "gemini-2.5-flash";
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models/";
const MAX_TURNS       = 6;

/* ════════════════════════════════
   DOM REFERENCES
   Gracefully falls back to null if element not found.
════════════════════════════════ */

const $ = (id) => document.getElementById(id);

const productInputEl      = $("productInput");
const originInputEl       = $("originInput");
const targetInputEl       = $("targetInput");
const submitBtnEl         = $("submitBtn");
const resetBtnEl          = $("resetBtn");
const statusBarEl         = $("statusBar");
const agentStateBarEl     = $("agentStateBar");
const agentStateLabelEl   = $("agentStateLabel");
const agentStateIconEl    = $("agentStateIcon");
const agentStateStepEl    = $("agentStateStep");
const clarifyBlockEl      = $("clarifyBlock");
const clarifyListEl       = $("clarifyList");
const clarifyAnswerEl     = $("clarifyAnswerInput");
const resultsAreaEl       = $("resultsArea");
const rawJsonBoxEl        = $("rawJsonBox");
const thinkingLogEl       = $("thinkingLog");
const toolCallsLogEl      = $("toolCallsLog");

/* ════════════════════════════════
   APP STATE
════════════════════════════════ */

let isBusy              = false;
let agentStep           = 1;          // 1 = initial, 2 = awaiting clarification answers
let savedInputs         = {};         // { product, origin, target }
let conversationHistory = [];

/* ════════════════════════════════
   API KEY GUARD
════════════════════════════════ */

function checkApiKey() {
  const missing =
    typeof GEMINI_API_KEY === "undefined" ||
    !GEMINI_API_KEY ||
    GEMINI_API_KEY === "PASTE_YOUR_REAL_KEY_HERE";

  if (missing) {
    setStatus(
      "❌ Missing Gemini API key. Open config.js and paste your real key.",
      "error"
    );
    if (submitBtnEl) submitBtnEl.disabled = true;
  }
  return !missing;
}

/* ════════════════════════════════
   AGENT STATE BAR
   Shows the current phase visibly.
════════════════════════════════ */

const AGENT_STATES = {
  reviewing:    { icon: "🔍", label: "Reviewing inputs",             step: "Step 1 of 2" },
  clarifying:   { icon: "💬", label: "Asking clarifying questions",  step: "Step 1 of 2" },
  generating:   { icon: "⚙️",  label: "Generating risk report",       step: "Step 2 of 2" },
  synthesizing: { icon: "🧩", label: "Synthesizing final report",    step: "Step 2 of 2" },
  done:         { icon: "✅", label: "Report ready",                  step: "Complete"    },
};

function setAgentState(name) {
  const s = AGENT_STATES[name];
  if (!s || !agentStateBarEl) return;
  agentStateBarEl.classList.add("visible");
  if (agentStateLabelEl) agentStateLabelEl.textContent = s.label;
  if (agentStateIconEl)  agentStateIconEl.textContent  = s.icon;
  if (agentStateStepEl)  agentStateStepEl.textContent  = s.step;
}

function hideAgentState() {
  if (agentStateBarEl) agentStateBarEl.classList.remove("visible");
}

/* ════════════════════════════════
   STATUS BAR
════════════════════════════════ */

function setStatus(msg, type, spinning) {
  if (!statusBarEl) return;
  statusBarEl.className = "status " + (type || "");
  if (spinning) {
    statusBarEl.innerHTML =
      '<span class="spinner" aria-hidden="true"></span><span>' + escHtml(msg) + "</span>";
  } else {
    statusBarEl.textContent = msg;
  }
}

/* ════════════════════════════════
   BUSY STATE
════════════════════════════════ */

function setBusy(busy) {
  isBusy = busy;
  if (submitBtnEl) submitBtnEl.disabled = busy;
  if (productInputEl) productInputEl.disabled = busy;
  if (originInputEl)  originInputEl.disabled  = busy;
  if (targetInputEl)  targetInputEl.disabled  = busy;
  document.body.style.cursor = busy ? "progress" : "";
}

/* ════════════════════════════════
   AGENT ACTIVITY LOG
   Logs each meaningful step the agent takes.
════════════════════════════════ */

let logCounter = 0;

function logEntry(icon, label, detail, status) {
  if (!toolCallsLogEl) return null;
  const id = "log-" + (++logCounter);
  const el = document.createElement("div");
  el.className = "tool-call" + (status ? " " + status : "");
  el.id = id;
  el.innerHTML =
    '<span class="tool-icon">' + icon + "</span>" +
    "<div>" +
      '<div class="tool-name">' + escHtml(label) + "</div>" +
      (detail ? '<div class="tool-args">' + escHtml(detail) + "</div>" : "") +
    "</div>";
  toolCallsLogEl.appendChild(el);
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (thinkingLogEl) thinkingLogEl.classList.add("visible");
  return id;
}

function updateLogEntry(id, status, resultText) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = "tool-call " + status;
  const nameEl = el.querySelector(".tool-name");
  if (nameEl) nameEl.className = "tool-name " + status;
  if (resultText) {
    let resEl = el.querySelector(".tool-result-preview");
    if (!resEl) {
      resEl = document.createElement("div");
      resEl.className = "tool-result-preview";
      el.querySelector("div").appendChild(resEl);
    }
    resEl.textContent = "→ " + resultText;
  }
}

/* ════════════════════════════════
   SYSTEM PROMPTS
════════════════════════════════ */

function buildReviewPrompt() {
  return (
    "ABSOLUTE RULE — OUTPUT LANGUAGE: Every word of your output MUST be in English. " +
    "Do not use any other language regardless of the user's input language. " +
    "\n\nYou are a Market Entry Risk Assessment Agent. " +
    "Your job is to analyze a product's regulatory and market entry risks when entering a target market from a country of origin. " +
    "\n\nPHASE: Review. Decide if you have enough information to generate the risk report." +
    "\n\nIF critical information is missing (product type unclear, countries missing, regulatory context ambiguous): " +
    "Return ONLY this JSON, nothing else, no markdown: " +
    '{"clarification_needed":true,"questions":["Q1 in English?","Q2 in English?","Q3 in English?"]} ' +
    "Maximum 3 questions. Only ask what is truly necessary." +
    "\n\nIF you have enough information: " +
    "Generate the final risk report directly. " +
    "All values must be in English. No URLs. No markdown. No backticks. Return ONLY valid JSON." +
    "\n\nFINAL REPORT FORMAT: " +
    '{"scenario_type":"","complexity_level":"Low|Medium|High","regulatory_risks":[],"next_steps":[],"summary":""}'
  );
}

function buildGenerationPrompt() {
  return (
    "ABSOLUTE RULE — OUTPUT LANGUAGE: Every word of your output MUST be in English. " +
    "Do not use any other language regardless of the user's input language. " +
    "\n\nYou are a Market Entry Risk Assessment Agent. You now have all the information needed. " +
    "Generate a comprehensive Market Entry Risk Report based on the provided inputs and answers. " +
    "\n\nThe report must cover:" +
    "\n- Specific regulatory risks (e.g. CE marking, import duties, labeling requirements, product standards, data protection)" +
    "\n- Complexity level (Low / Medium / High) with a brief justification" +
    "\n- Concrete next steps the company should take" +
    "\n- A short plain-English summary" +
    "\n\nAll values must be in English. No URLs. No markdown. No backticks. Return ONLY valid JSON." +
    '\n\nFormat: {"scenario_type":"","complexity_level":"Low|Medium|High","regulatory_risks":[],"next_steps":[],"summary":""}'
  );
}

/* ════════════════════════════════
   INPUT VALIDATION
════════════════════════════════ */

function getInputs() {
  return {
    product: (productInputEl?.value || "").trim(),
    origin:  (originInputEl?.value  || "").trim(),
    target:  (targetInputEl?.value  || "").trim(),
  };
}

function validateInputs(inputs) {
  if (!inputs.product) return "Please describe the product.";
  if (!inputs.origin)  return "Please enter the country of origin.";
  if (!inputs.target)  return "Please enter the target market.";
  return null;
}

/* ════════════════════════════════
   SUBMIT ROUTER
════════════════════════════════ */

function handleSubmit() {
  if (isBusy) return;
  if (!checkApiKey()) return;
  if (agentStep === 1) runStep1();
  else if (agentStep === 2) runStep2();
}

/* ════════════════════════════════
   STEP 1 — Review inputs
════════════════════════════════ */

async function runStep1() {
  const inputs = getInputs();
  const validationError = validateInputs(inputs);
  if (validationError) {
    setStatus(validationError, "error");
    return;
  }

  savedInputs = inputs;
  setBusy(true);

  if (toolCallsLogEl) toolCallsLogEl.innerHTML = "";
  if (rawJsonBoxEl)   { rawJsonBoxEl.textContent = ""; rawJsonBoxEl.classList.remove("active"); }
  if (resultsAreaEl)  resultsAreaEl.innerHTML = buildWorkingState();

  setAgentState("reviewing");
  setStatus("Reviewing your inputs…", "loading", true);

  const logId = logEntry("🔍", "Reviewing inputs", inputs.product + " · " + inputs.origin + " → " + inputs.target);

  const userPrompt =
    "[IMPORTANT: Respond in English only.]\n\n" +
    "Product: " + inputs.product + "\n" +
    "Country of origin: " + inputs.origin + "\n" +
    "Target market: " + inputs.target + "\n\n" +
    "Assess market entry risks and regulatory requirements. Respond in English only.";

  conversationHistory = [{ role: "user", parts: [{ text: userPrompt }] }];

  try {
    await runAgentLoop(buildReviewPrompt(), "step1");
    if (logId) updateLogEntry(logId, "done", "Inputs reviewed");
  } catch (err) {
    if (logId) updateLogEntry(logId, "error");
    handleError(err);
  } finally {
    setBusy(false);
  }
}

/* ════════════════════════════════
   STEP 2 — Submit clarification answers
════════════════════════════════ */

async function runStep2() {
  const answers = (clarifyAnswerEl?.value || "").trim();
  if (!answers) {
    setStatus("Please answer the clarification questions before submitting.", "error");
    if (clarifyAnswerEl) clarifyAnswerEl.focus();
    return;
  }

  setBusy(true);
  setAgentState("generating");
  setStatus("Generating risk report…", "loading", true);

  const logId = logEntry("⚙️", "Generating report", "Processing answers + inputs");

  conversationHistory.push({
    role: "user",
    parts: [{
      text:
        "[IMPORTANT: Respond in English only.]\n\n" +
        "Answers to clarification questions:\n\n" + answers +
        "\n\nNow generate the full Market Entry Risk Report in English only."
    }]
  });

  try {
    await runAgentLoop(buildGenerationPrompt(), "step2");
    if (logId) updateLogEntry(logId, "done", "Report generated");
  } catch (err) {
    if (logId) updateLogEntry(logId, "error");
    handleError(err);
  } finally {
    setBusy(false);
  }
}

/* ════════════════════════════════
   CORE AGENT LOOP
   Sends to Gemini, checks for clarification JSON or final report JSON,
   retries once if model skips tool phase in step2.
════════════════════════════════ */

async function runAgentLoop(systemInstruction, phase) {
  let turns            = 0;
  let retriedOnce      = false;

  while (turns < MAX_TURNS) {
    turns++;

    const response  = await callGemini(conversationHistory, systemInstruction);
    const candidate = response?.candidates?.[0];

    if (!candidate) throw new Error("Gemini returned no candidate. Check your API key and quota.");

    const parts     = candidate.content?.parts || [];
    const textParts = parts.filter(p => p.text);

    conversationHistory.push({ role: "model", parts });

    if (textParts.length > 0) {
      const rawText = textParts.map(p => p.text).join("").trim();
      if (rawJsonBoxEl) rawJsonBoxEl.textContent = rawText || "[empty response]";

      const parsed = parseJsonSafely(rawText);

      /* Case A: clarification questions */
      if (
        parsed.clarification_needed === true &&
        Array.isArray(parsed.questions) &&
        parsed.questions.length > 0
      ) {
        setAgentState("clarifying");
        showClarificationUI(parsed.questions);
        return;
      }

      /* Case B: final report */
      if (parsed.scenario_type !== undefined || parsed.regulatory_risks !== undefined) {
        /* Retry once if we're in step2 and model answered without being asked */
        if (phase === "step2" && !retriedOnce && turns === 1) {
          retriedOnce = true;
          conversationHistory.push({
            role: "user",
            parts: [{ text: "Make sure you include all required fields: regulatory_risks, complexity_level, next_steps, and summary. All text must be in English." }]
          });
          setStatus("Refining report…", "loading", true);
          continue;
        }

        setAgentState("done");
        renderReport(parsed);
        setStatus("✓ Market Entry Risk Report ready.", "success");
        if (resetBtnEl) resetBtnEl.style.display = "";
        return;
      }

      /* Case C: unexpected */
      if (rawJsonBoxEl) rawJsonBoxEl.classList.add("active");
      setStatus("Unexpected response format. See raw JSON.", "error");
      if (resultsAreaEl) resultsAreaEl.innerHTML = buildErrorState("Unexpected response. See raw JSON.");
      if (resetBtnEl) resetBtnEl.style.display = "";
      return;
    }

    /* Empty stop */
    if (candidate.finishReason === "STOP") {
      throw new Error("Agent stopped without producing output. Try rephrasing your inputs.");
    }
    break;
  }

  if (turns >= MAX_TURNS) {
    setStatus("Agent reached maximum turns. Try simplifying your inputs.", "error");
    if (resetBtnEl) resetBtnEl.style.display = "";
  }
}

/* ════════════════════════════════
   GEMINI API CALL
════════════════════════════════ */

async function callGemini(contents, systemInstruction) {
  const res = await fetch("/.netlify/functions/gemini", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 2000
      }
    })
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    throw new Error("Gemini API returned a non-JSON response.");
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || "Gemini API error";
    throw new Error(msg);
  }

  return data;
}
      }
    })
  });

  let data = {};
  try {
    data = await res.json();
  } catch (_) {
    throw new Error("Gemini API returned a non-JSON response.");
  }

  if (!res.ok) {
    const msg  = data?.error?.message || "Gemini API error";
    const code = data?.error?.code    ? " (" + data.error.code + ")" : "";
    throw new Error(msg + code);
  }

  return data;
}

/* ════════════════════════════════
   CLARIFICATION UI
════════════════════════════════ */

function showClarificationUI(questions) {
  agentStep = 2;

  if (clarifyListEl) {
    clarifyListEl.innerHTML = questions.map(q => "<li>" + escHtml(q) + "</li>").join("");
  }
  if (clarifyBlockEl) clarifyBlockEl.classList.add("visible");

  if (submitBtnEl) submitBtnEl.textContent = "▶ Submit Answers";

  if (productInputEl) productInputEl.disabled = true;
  if (originInputEl)  originInputEl.disabled  = true;
  if (targetInputEl)  targetInputEl.disabled  = true;

  if (resetBtnEl) resetBtnEl.style.display = "";
  if (resultsAreaEl) resultsAreaEl.innerHTML = buildClarifyState();

  setStatus("Please answer the questions above, then click Submit Answers.", "loading");
  if (clarifyAnswerEl) clarifyAnswerEl.focus();
}

/* ════════════════════════════════
   REPORT RENDERING
════════════════════════════════ */

function renderReport(data) {
  if (!resultsAreaEl) return;

  const complexity = String(data.complexity_level || "").toLowerCase();
  const badgeClass = complexity === "low" ? "low" : complexity === "medium" ? "medium" : "high";
  const scenario   = data.scenario_type || "Market Entry Risk Assessment";
  const summary    = data.summary       || "";

  resultsAreaEl.innerHTML =

    /* Header summary */
    '<div class="result-summary">' +
      '<div>' +
        '<div class="result-summary-title">' + escHtml(scenario) + '</div>' +
        (summary ? '<div class="result-summary-sub">' + escHtml(summary) + '</div>' : "") +
      '</div>' +
      '<span class="badge ' + escHtml(badgeClass) + '">' +
        escHtml(data.complexity_level || "Unknown") +
      '</span>' +
    '</div>' +

    /* Regulatory risks */
    '<div class="result-card">' +
      '<h3>Regulatory risks</h3>' +
      renderList(data.regulatory_risks) +
    '</div>' +

    /* Next steps */
    '<div class="result-card">' +
      '<h3>Next steps</h3>' +
      renderList(data.next_steps) +
    '</div>';
}

function renderList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return '<p style="color:var(--muted);font-size:13px;margin:0">No items returned for this section.</p>';
  }
  return "<ul>" + items.map(i => "<li>" + escHtml(String(i)) + "</li>").join("") + "</ul>";
}

/* ════════════════════════════════
   EMPTY / ERROR STATES
════════════════════════════════ */

function buildWorkingState() {
  return '<div class="empty-state"><div class="empty-state-icon">⚙️</div>Agent is working…</div>';
}

function buildClarifyState() {
  return '<div class="empty-state"><div class="empty-state-icon">💬</div>Answer the questions on the left, then click <strong>Submit Answers</strong>.</div>';
}

function buildErrorState(msg) {
  return '<div class="empty-state" style="color:var(--danger)">' + escHtml(msg) + '</div>';
}

/* ════════════════════════════════
   DEFENSIVE JSON PARSER
   4 tiers: direct → strip fences → bracket scan → fallback
════════════════════════════════ */

function parseJsonSafely(raw) {
  const t = String(raw || "").trim();

  if (!t) {
    return {
      scenario_type: "Empty response",
      regulatory_risks: [],
      complexity_level: "Unknown",
      next_steps: ["The model returned an empty response."],
      summary: ""
    };
  }

  try { return JSON.parse(t); } catch (_) {}

  const stripped = t
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try { return JSON.parse(stripped); } catch (_) {}

  const first = stripped.indexOf("{");
  const last  = stripped.lastIndexOf("}");
  if (first !== -1 && last > first) {
    try { return JSON.parse(stripped.slice(first, last + 1)); } catch (_) {}
  }

  console.warn("parseJsonSafely: could not parse response:", raw);
  return {
    scenario_type: "Parse error",
    regulatory_risks: [],
    complexity_level: "Unknown",
    next_steps: [
      "The agent response could not be parsed as valid JSON.",
      "First 300 chars: " + stripped.slice(0, 300)
    ],
    summary: ""
  };
}

/* ════════════════════════════════
   ERROR HANDLER
════════════════════════════════ */

function handleError(err) {
  console.error("Agent error:", err);
  hideAgentState();
  setStatus("Error: " + (err.message || "Unknown error — check the browser console."), "error");
  if (resultsAreaEl) {
    resultsAreaEl.innerHTML = buildErrorState(
      "The agent encountered an error. Check your API key, then try again."
    );
  }
  if (resetBtnEl) resetBtnEl.style.display = "";
}

/* ════════════════════════════════
   RESET
════════════════════════════════ */

function resetAll() {
  agentStep           = 1;
  savedInputs         = {};
  conversationHistory = [];
  isBusy              = false;

  if (productInputEl) { productInputEl.value = ""; productInputEl.disabled = false; }
  if (originInputEl)  { originInputEl.value  = ""; originInputEl.disabled  = false; }
  if (targetInputEl)  { targetInputEl.value  = ""; targetInputEl.disabled  = false; }

  if (clarifyAnswerEl) clarifyAnswerEl.value = "";
  if (clarifyListEl)   clarifyListEl.innerHTML = "";
  if (clarifyBlockEl)  clarifyBlockEl.classList.remove("visible");

  if (submitBtnEl) {
    submitBtnEl.textContent = "▶ Analyze Market Entry";
    submitBtnEl.disabled = false;
  }
  if (resetBtnEl) resetBtnEl.style.display = "none";

  if (toolCallsLogEl) toolCallsLogEl.innerHTML = "";
  if (thinkingLogEl)  thinkingLogEl.classList.remove("visible");

  if (rawJsonBoxEl) { rawJsonBoxEl.textContent = ""; rawJsonBoxEl.classList.remove("active"); }

  if (resultsAreaEl) {
    resultsAreaEl.innerHTML =
      '<div class="empty-state"><div class="empty-state-icon">🌍</div>Fill in the form and click Analyze Market Entry.</div>';
  }

  hideAgentState();
  setStatus("", "");
  document.body.style.cursor = "";
  if (productInputEl) productInputEl.focus();
}

/* ════════════════════════════════
   UTILITIES
════════════════════════════════ */

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g,  "&amp;")
    .replace(/</g,  "&lt;")
    .replace(/>/g,  "&gt;")
    .replace(/"/g,  "&quot;");
}

function toggleRawJson() {
  if (rawJsonBoxEl) rawJsonBoxEl.classList.toggle("active");
}

/* ════════════════════════════════
   EVENT WIRING
════════════════════════════════ */

document.addEventListener("DOMContentLoaded", () => {
  checkApiKey();

  if (submitBtnEl) submitBtnEl.addEventListener("click", handleSubmit);
  if (resetBtnEl)  resetBtnEl.addEventListener("click", resetAll);

  /* Ctrl/Cmd + Enter to submit */
  document.addEventListener("keydown", (e) => {
    const mod = /mac/i.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    if (mod && e.key === "Enter" && !isBusy) {
      e.preventDefault();
      handleSubmit();
    }
  });

  /* Wire raw JSON toggle if button exists */
  const rawToggleBtn = $("rawJsonToggle");
  if (rawToggleBtn) rawToggleBtn.addEventListener("click", toggleRawJson);

  /* Hide reset button initially */
  if (resetBtnEl) resetBtnEl.style.display = "none";
});
